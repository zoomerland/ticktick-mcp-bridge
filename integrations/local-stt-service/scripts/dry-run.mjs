import { loadConfig } from "../src/config.mjs";
import { transcribePayload } from "../src/transcribe.mjs";

const config = loadConfig({
  STT_PROVIDER: "mock",
  STT_MOCK_TRANSCRIPT: "what is next",
  STT_MAX_AUDIO_BYTES: "1024",
});

const result = await transcribePayload({
  audioBase64: Buffer.from([1, 2, 3]).toString("base64"),
  mimeType: "audio/ogg",
  duration: 9,
}, config);

console.log(JSON.stringify({
  status: result.status,
  body: result.body,
}, null, 2));
