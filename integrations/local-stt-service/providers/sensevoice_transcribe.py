#!/usr/bin/env python3
"""SenseVoiceSmall command provider for the local STT service.

The Node service writes Telegram audio to a temporary file and calls this script
with that file path. This script prints only one JSON object to stdout:

    {"text": "...", "provider": "sensevoice"}

Model/runtime logs are redirected to stderr so the command provider can parse
stdout reliably.
"""

from __future__ import annotations

import contextlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


def parse_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def parse_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    try:
        return int(value)
    except ValueError:
        return default


def extract_text(result) -> str:
    if isinstance(result, list) and result:
        first = result[0]
        if isinstance(first, dict):
            return str(first.get("text", "")).strip()
        if isinstance(first, list) and first:
            nested = first[0]
            if isinstance(nested, dict):
                return str(nested.get("text", "")).strip()
    if isinstance(result, dict):
        return str(result.get("text", "")).strip()
    return ""


def prepare_audio_path(audio_path: str) -> tuple[str, tempfile.TemporaryDirectory | None]:
    if not parse_bool("SENSEVOICE_PRECONVERT", True):
        return audio_path, None

    try:
        import imageio_ffmpeg
    except Exception:
        return audio_path, None

    temp_dir = tempfile.TemporaryDirectory(prefix="sensevoice-audio-")
    output_path = str(Path(temp_dir.name) / "audio.wav")
    command = [
        imageio_ffmpeg.get_ffmpeg_exe(),
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        audio_path,
        "-ac",
        "1",
        "-ar",
        "16000",
        output_path,
    ]
    subprocess.run(command, check=True)
    return output_path, temp_dir


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: sensevoice_transcribe.py AUDIO_PATH", file=sys.stderr)
        return 2

    audio_path = sys.argv[1]
    model_dir = os.environ.get("SENSEVOICE_MODEL", "FunAudioLLM/SenseVoiceSmall")
    device = os.environ.get("SENSEVOICE_DEVICE", "cpu")
    hub = os.environ.get("SENSEVOICE_HUB", "hf")
    language = os.environ.get("SENSEVOICE_LANGUAGE", "auto")
    use_itn = parse_bool("SENSEVOICE_USE_ITN", True)
    enable_vad = parse_bool("SENSEVOICE_ENABLE_VAD", False)
    disable_update = parse_bool("SENSEVOICE_DISABLE_UPDATE", True)
    batch_size = parse_int("SENSEVOICE_BATCH_SIZE", 1)
    batch_size_s = parse_int("SENSEVOICE_BATCH_SIZE_S", 60)
    merge_length_s = parse_int("SENSEVOICE_MERGE_LENGTH_S", 15)
    max_single_segment_time = parse_int("SENSEVOICE_MAX_SINGLE_SEGMENT_MS", 30000)

    prepared_path, temp_dir = prepare_audio_path(audio_path)

    try:
        with contextlib.redirect_stdout(sys.stderr):
            from funasr import AutoModel
            from funasr.utils.postprocess_utils import rich_transcription_postprocess

            model_kwargs = {
                "model": model_dir,
                "device": device,
                "disable_update": disable_update,
            }
            if hub:
                model_kwargs["hub"] = hub
            if enable_vad:
                model_kwargs["vad_model"] = os.environ.get("SENSEVOICE_VAD_MODEL", "fsmn-vad")
                model_kwargs["vad_kwargs"] = {
                    "max_single_segment_time": max_single_segment_time,
                }

            model = AutoModel(**model_kwargs)

            generate_kwargs = {
                "input": prepared_path,
                "cache": {},
                "language": language,
                "use_itn": use_itn,
            }
            if enable_vad:
                generate_kwargs.update({
                    "batch_size_s": batch_size_s,
                    "merge_vad": True,
                    "merge_length_s": merge_length_s,
                })
            else:
                generate_kwargs["batch_size"] = batch_size

            result = model.generate(**generate_kwargs)
            text = rich_transcription_postprocess(extract_text(result))
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()

    print(json.dumps({
        "text": text,
        "provider": "sensevoice",
        "language": language,
        "device": device,
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
