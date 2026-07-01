#!/usr/bin/env python3
"""SenseVoiceSmall command provider for the local STT service.

The Node service writes Telegram audio to a temporary file and calls this script
with that file path. This script prints only one JSON object to stdout:

    {"text": "...", "provider": "sensevoice"}

Model/runtime logs are redirected to stderr so the command provider can parse
stdout reliably.
"""

from __future__ import annotations

import json
import sys

from sensevoice_runtime import load_model, load_settings, transcribe_file


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: sensevoice_transcribe.py AUDIO_PATH", file=sys.stderr)
        return 2

    audio_path = sys.argv[1]
    settings = load_settings()
    model, postprocess = load_model(settings)
    text = transcribe_file(audio_path, model, postprocess, settings)

    print(json.dumps({
        "text": text,
        "provider": "sensevoice",
        "language": settings["language"],
        "device": settings["device"],
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
