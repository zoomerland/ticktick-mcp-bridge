from __future__ import annotations

import contextlib
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


def load_settings() -> dict:
    return {
        "model_dir": os.environ.get("SENSEVOICE_MODEL", "FunAudioLLM/SenseVoiceSmall"),
        "device": os.environ.get("SENSEVOICE_DEVICE", "cpu"),
        "hub": os.environ.get("SENSEVOICE_HUB", "hf"),
        "language": os.environ.get("SENSEVOICE_LANGUAGE", "auto"),
        "use_itn": parse_bool("SENSEVOICE_USE_ITN", True),
        "enable_vad": parse_bool("SENSEVOICE_ENABLE_VAD", False),
        "disable_update": parse_bool("SENSEVOICE_DISABLE_UPDATE", True),
        "batch_size": parse_int("SENSEVOICE_BATCH_SIZE", 1),
        "batch_size_s": parse_int("SENSEVOICE_BATCH_SIZE_S", 60),
        "merge_length_s": parse_int("SENSEVOICE_MERGE_LENGTH_S", 15),
        "max_single_segment_time": parse_int("SENSEVOICE_MAX_SINGLE_SEGMENT_MS", 30000),
    }


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


def load_model(settings: dict):
    with contextlib.redirect_stdout(sys.stderr):
        from funasr import AutoModel
        from funasr.utils.postprocess_utils import rich_transcription_postprocess

        model_kwargs = {
            "model": settings["model_dir"],
            "device": settings["device"],
            "disable_update": settings["disable_update"],
        }
        if settings["hub"]:
            model_kwargs["hub"] = settings["hub"]
        if settings["enable_vad"]:
            model_kwargs["vad_model"] = os.environ.get("SENSEVOICE_VAD_MODEL", "fsmn-vad")
            model_kwargs["vad_kwargs"] = {
                "max_single_segment_time": settings["max_single_segment_time"],
            }

        return AutoModel(**model_kwargs), rich_transcription_postprocess


def transcribe_file(audio_path: str, model, postprocess, settings: dict) -> str:
    prepared_path, temp_dir = prepare_audio_path(audio_path)

    try:
        with contextlib.redirect_stdout(sys.stderr):
            generate_kwargs = {
                "input": prepared_path,
                "cache": {},
                "language": settings["language"],
                "use_itn": settings["use_itn"],
            }
            if settings["enable_vad"]:
                generate_kwargs.update({
                    "batch_size_s": settings["batch_size_s"],
                    "merge_vad": True,
                    "merge_length_s": settings["merge_length_s"],
                })
            else:
                generate_kwargs["batch_size"] = settings["batch_size"]

            result = model.generate(**generate_kwargs)
            return postprocess(extract_text(result))
    finally:
        if temp_dir is not None:
            temp_dir.cleanup()
