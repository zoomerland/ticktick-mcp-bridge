# Local STT Model Selection

This note tracks the model and runtime direction for Telegram voice
transcription. It is intentionally technical and public-safe: no private audio,
no secrets, no commercial roadmap, and no bundled model artifacts.

## Current Service Boundary

The service already exposes a stable local contract:

- `POST /transcribe`
- input: base64 audio plus optional MIME type and duration
- output: `{ "text": "...", "provider": "..." }`
- current providers: `mock` and `command`

The first real STT providers should be implemented as command wrappers before
we add deeper in-process runtimes. This keeps model experiments isolated from
Telegram bot logic and avoids exposing model servers publicly.

## Product Target Correction

This project targets TickTick, not TikTok. Voice transcription often confuses
those names, so product notes and demos should spell "TickTick" explicitly.

Public storefronts currently identify the global TickTick app with Appest
Limited / TickTick Limited, and the developer API uses the Dida365 developer
surface. Treat the product-facing language assumption as English plus Chinese
for demos, while avoiding unsupported legal claims about corporate domicile.

TickTick also already ships AI-powered voice/audio features in its own mobile
app. Our pitch should therefore be free-form user voice input through Telegram,
understood by a private/local assistant and then routed to TickTick through the
existing backend and MCP/API layer, not merely "voice input for TickTick".

## Target Languages

Minimum product-facing coverage:

- English
- Chinese/Mandarin, with Cantonese as a useful extra if the selected model
  supports it

Personal/private coverage:

- Russian, because the owner's private assistant flow is Russian-heavy
- mixed short utterances with task names, dates, and app-specific vocabulary

Russian is useful for personal operation and internal testing, but it is not
required for the first product-facing demo.

## Hardware Reality

The current local GPU host can be occupied by the local LLM, with VRAM near full
utilization. The first STT gate must therefore work acceptably without assuming
free GPU memory.

Practical consequences:

- prefer CPU/edge-capable command wrappers for the baseline;
- do not keep a resident GPU STT model loaded until the memory budget is known;
- treat GPU STT as a burst optimization only when the LLM is unloaded or enough
  VRAM is demonstrably free;
- keep audio snippets short and queue requests if the local host is busy;
- measure cold start separately from warm inference.

## Candidate Models

### Whisper Large v3 Turbo

Role: broad multilingual quality baseline.

Why it is attractive:

- broad multilingual coverage in one model
- strong ecosystem support through `transformers`, `faster-whisper`, and
  `whisper.cpp`
- good first candidate for English, Russian, and Mandarin smoke tests
- simpler story than maintaining a separate model per language

Risks:

- can hallucinate on silence, noise, or unclear audio
- quality can vary by language, accent, and domain
- not ideal as a resident GPU model when the local LLM already occupies VRAM
- CPU latency must be tested with the actual short Telegram voice notes

Initial runtime path:

- `whisper.cpp` or quantized `faster-whisper` as a CPU-first command wrapper
- GPU `faster-whisper` only as an optional performance gate

### SenseVoiceSmall

Role: China/Asia-focused challenger candidate.

Why it is attractive:

- designed for multilingual speech recognition and speech understanding
- especially relevant for Mandarin, Cantonese, English, Japanese, and Korean
- has small/edge-oriented runtime options in the ecosystem
- includes CPU/edge-oriented GGUF/runtime paths that fit the current VRAM
  constraint better than a resident GPU model

Risks:

- integration and packaging are less standard than Whisper
- we need to verify license, model source, runtime stability, and output
  behavior ourselves
- English/Russian quality must be measured rather than assumed

Initial runtime path:

- command wrapper against a local binary/GGUF or Python runtime
- compare against Whisper on the exact same Telegram voice samples

### NVIDIA Parakeet TDT 0.6B v3

Role: high-quality English and European-language challenger candidate.

Why it is attractive:

- designed for high-throughput speech-to-text
- supports English, Russian, Ukrainian, and many European languages
- includes punctuation/capitalization and timestamp-oriented capabilities

Risks:

- does not cover Chinese/Mandarin, so it cannot be the only product model
- NeMo/Transformers integration may be heavier than Whisper wrappers
- hardware and dependency fit must be tested on the actual local GPU host

Initial runtime path:

- optional benchmark after Whisper and SenseVoice are working

### Distil-Whisper Large v3.5

Role: English-only speed candidate.

Why it is attractive:

- faster English transcription candidate
- useful for comparing cost/latency if English becomes the first public demo

Risks:

- English-only family, so it does not solve Mandarin/Russian coverage
- not a primary model for the multilingual assistant
- still competes for the same local compute budget as the LLM

Initial runtime path:

- optional benchmark, not the first integration target

### GigaAM / Existing Russian OpenVINO Path

Role: Russian private candidate only.

Why it is attractive:

- already known from the previous Russian/NPU dictation work
- may be useful for a Russian-first personal assistant path

Risks:

- not enough for an English/Chinese product-facing story
- should not become the default Telegram secretary STT baseline

## Cloud Reference

OpenAI transcription models can be used as an optional quality reference or
fallback when the user explicitly configures an API key. They should not be a
required dependency for the local baseline.

Candidate reference models:

- `gpt-4o-mini-transcribe`
- `gpt-4o-transcribe`
- `whisper-1`

## Evaluation Gate

Use the same audio set for every candidate:

- short Telegram voice note in English
- short Telegram voice note in Mandarin
- short Telegram voice note in Russian
- noisy/room voice note
- silence or accidental tap
- task-oriented utterance with a date and project/list name
- mixed-language utterance with an app or model name

Measure:

- warm and cold latency
- memory/VRAM/RAM usage
- transcript quality by rough WER/CER plus human review
- date/time preservation
- proper nouns and task vocabulary
- punctuation usefulness for the LLM layer
- behavior on silence/noise
- whether the output is stable enough for downstream tool routing

## First Recommended Path

1. Keep Telegram bot voice handling as the owner of routing.
2. Keep STT as a pure audio-to-text service: it returns a transcript to the
   Telegram backend and does not call the LLM, MCP, or TickTick directly.
3. Add a CPU-first command wrapper for SenseVoiceSmall, preferably through a
   binary/GGUF path if it proves stable.
4. Add a second CPU-first wrapper for Whisper through `whisper.cpp` or
   quantized `faster-whisper`.
5. Run both through `STT_PROVIDER=command` on the same short Telegram voice
   samples.
6. Tunnel only the STT HTTP service privately, the same way as the local LLM.
7. Use GPU acceleration only as a measured optional gate after checking free
   VRAM with the local LLM running.
8. Keep Parakeet and Distil-Whisper as second-wave candidates.

## Non-Goals For The First Gate

- no model fine-tuning
- no public STT endpoint
- no raw audio committed to Git
- no private transcripts in repository files
- no model artifacts inside the repository
- no replacement of the existing Telegram command/router safety gates
