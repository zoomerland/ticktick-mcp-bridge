#!/usr/bin/env python3
"""Resident SenseVoiceSmall HTTP provider for the local STT service contract."""

from __future__ import annotations

import base64
import json
import os
import threading
import tempfile
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from sensevoice_runtime import load_model, load_settings, parse_bool, parse_int, transcribe_file


def send_json(handler: BaseHTTPRequestHandler, status: int, body: dict) -> None:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


class SenseVoiceHandler(BaseHTTPRequestHandler):
    server_version = "SenseVoiceSTT/0.1"

    def log_message(self, fmt: str, *args) -> None:
        if self.server.config["log_requests"]:
            super().log_message(fmt, *args)

    def do_GET(self) -> None:
        if self.path != "/health":
            send_json(self, 404, {"error": "not_found"})
            return
        send_json(self, 200, {
            "ok": True,
            "provider": "sensevoice_resident",
            "model": self.server.settings["model_dir"],
            "device": self.server.settings["device"],
            "language": self.server.settings["language"],
            "maxAudioBytes": self.server.config["max_audio_bytes"],
            "loadedAt": self.server.loaded_at,
        })

    def do_POST(self) -> None:
        if self.path != "/transcribe":
            send_json(self, 404, {"error": "not_found"})
            return

        token = self.server.config["bearer_token"]
        if token and self.headers.get("Authorization") != f"Bearer {token}":
            send_json(self, 401, {"error": "unauthorized"})
            return

        max_body_bytes = self.server.config["max_audio_bytes"] * 2
        content_length = int(self.headers.get("Content-Length") or "0")
        if content_length > max_body_bytes:
            send_json(self, 413, {
                "error": "request_too_large",
                "maxAudioBytes": self.server.config["max_audio_bytes"],
            })
            return

        try:
            payload = json.loads(self.rfile.read(content_length or 0).decode("utf-8") or "{}")
        except Exception:
            send_json(self, 400, {"error": "bad_request"})
            return

        try:
            audio = base64.b64decode(str(payload.get("audioBase64") or ""), validate=True)
        except Exception:
            send_json(self, 400, {"error": "invalid_audio_base64"})
            return

        if not audio:
            send_json(self, 400, {
                "error": "missing_audio",
                "message": "audioBase64 is required.",
            })
            return
        if len(audio) > self.server.config["max_audio_bytes"]:
            send_json(self, 413, {
                "error": "audio_too_large",
                "maxAudioBytes": self.server.config["max_audio_bytes"],
            })
            return

        suffix = audio_extension(payload.get("mimeType"))
        with tempfile.TemporaryDirectory(prefix="sensevoice-http-") as temp_dir:
            audio_path = Path(temp_dir) / f"audio{suffix}"
            audio_path.write_bytes(audio)
            started = time.perf_counter()
            try:
                with self.server.model_lock:
                    text = transcribe_file(
                        str(audio_path),
                        self.server.model,
                        self.server.postprocess,
                        self.server.settings,
                    )
            except Exception as exc:
                send_json(self, 502, {
                    "error": "stt_transcription_failed",
                    "code": type(exc).__name__,
                })
                return

        if not text.strip():
            send_json(self, 502, {"error": "empty_transcript"})
            return

        send_json(self, 200, {
            "text": text,
            "provider": "sensevoice_resident",
            "audioBytes": len(audio),
            "mimeType": payload.get("mimeType") or "",
            "elapsedMs": round((time.perf_counter() - started) * 1000),
        })


def audio_extension(mime_type) -> str:
    normalized = str(mime_type or "").split(";")[0].strip().lower()
    return {
        "audio/flac": ".flac",
        "audio/mpeg": ".mp3",
        "audio/mp4": ".m4a",
        "audio/ogg": ".ogg",
        "audio/wav": ".wav",
        "audio/webm": ".webm",
    }.get(normalized, ".bin")


class SenseVoiceServer(ThreadingHTTPServer):
    daemon_threads = True


def main() -> int:
    settings = load_settings()
    host = os.environ.get("STT_HOST", "127.0.0.1")
    port = parse_int("STT_PORT", 9876)
    config = {
        "bearer_token": os.environ.get("STT_BEARER_TOKEN", ""),
        "max_audio_bytes": parse_int("STT_MAX_AUDIO_BYTES", 10 * 1024 * 1024),
        "log_requests": parse_bool("STT_LOG_REQUESTS", False),
    }

    print(
        f"Loading SenseVoice model {settings['model_dir']} "
        f"on {settings['device']} with language={settings['language']}...",
        flush=True,
    )
    started = time.perf_counter()
    model, postprocess = load_model(settings)
    loaded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    print(f"SenseVoice model loaded in {time.perf_counter() - started:.1f}s.", flush=True)

    server = SenseVoiceServer((host, port), SenseVoiceHandler)
    server.config = config
    server.settings = settings
    server.model = model
    server.postprocess = postprocess
    server.model_lock = threading.Lock()
    server.loaded_at = loaded_at
    print(f"Resident SenseVoice STT listening on {host}:{port}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
