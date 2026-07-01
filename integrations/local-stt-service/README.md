# Local STT Service

Small HTTP service boundary for Telegram voice transcription.

Current providers:

- `mock`: returns `STT_MOCK_TRANSCRIPT` for adapter validation.
- `command`: writes request audio to a temporary file, runs a local executable
  without shell interpolation, and reads a transcript from stdout.

No model artifacts are bundled here. Real STT providers must be added behind the
same `/transcribe` contract after model, license, and runtime validation.

## Endpoints

- `GET /health`
- `POST /transcribe`

`POST /transcribe` accepts JSON:

```json
{
  "audioBase64": "AQID",
  "mimeType": "audio/ogg",
  "duration": 9
}
```

It returns JSON:

```json
{
  "text": "what is next",
  "provider": "mock"
}
```

## Local Checks

```powershell
cd integrations/local-stt-service
npm run check
npm run config-check
npm test
npm run dry-run
```

## Configuration

- `STT_HOST=127.0.0.1`
- `STT_PORT=9876`
- `STT_PROVIDER=mock`
- `STT_MOCK_TRANSCRIPT=what is next`
- `STT_BEARER_TOKEN=replace-with-local-secret`
- `STT_MAX_AUDIO_BYTES=10485760`
- `STT_COMMAND=path-or-executable-name`
- `STT_COMMAND_ARGS=["{audio}"]`
- `STT_COMMAND_TIMEOUT_MS=30000`

Copy `.env.example` to `.env` for local runs if needed. `npm run config-check`
or `node scripts/config-check.mjs` reads `.env` when present, overlays the
current environment, validates startup config, and prints a redacted summary.

On Windows, `scripts/start.ps1` starts the service from this package directory:

```powershell
.\scripts\start.ps1
.\scripts\start.ps1 -NodePath "C:\path\to\node.exe"
```

Keep this service bound to loopback for local use. Do not send private audio to
remote endpoints unless explicitly configured and reviewed.

For `STT_PROVIDER=command`, `STT_COMMAND` is required and `STT_COMMAND_ARGS`
must be a JSON string array containing `{audio}`. The placeholder is replaced
with the temporary audio file path and the process is started with
`shell: false`; put each argument in a separate JSON array item. Stdout may be
JSON such as `{ "text": "synthetic transcript" }` or plain text. The temporary
audio file is removed after each request, including command failures.
