import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_COMMAND_OUTPUT_BYTES = 1024 * 1024;
const MIME_EXTENSIONS = new Map([
  ["audio/flac", ".flac"],
  ["audio/mpeg", ".mp3"],
  ["audio/mp4", ".m4a"],
  ["audio/ogg", ".ogg"],
  ["audio/wav", ".wav"],
  ["audio/webm", ".webm"],
]);

function decodeAudioBase64(value) {
  if (!value) return Buffer.alloc(0);
  return Buffer.from(String(value), "base64");
}

function audioExtension(mimeType) {
  const normalized = String(mimeType || "").split(";")[0].trim().toLowerCase();
  return MIME_EXTENSIONS.get(normalized) || ".bin";
}

function materializeCommandArgs(args, audioPath) {
  return args.map((arg) => arg.replaceAll("{audio}", audioPath));
}

function parseCommandOutput(stdout) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return {
      ok: false,
      status: 502,
      body: { error: "stt_command_empty_output" },
    };
  }

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed.text === "string") {
      return { ok: true, text: parsed.text };
    }
    return {
      ok: false,
      status: 502,
      body: { error: "stt_command_invalid_output" },
    };
  } catch {
    return { ok: true, text: trimmed };
  }
}

function runCommand(commandConfig, audioPath) {
  const args = materializeCommandArgs(commandConfig.args, audioPath);
  return new Promise((resolve) => {
    const child = spawn(commandConfig.command, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let settled = false;
    let timedOut = false;
    let outputTooLarge = false;
    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    function collect(kind, chunk) {
      const size = chunk.byteLength;
      if (kind === "stdout") stdoutBytes += size;
      if (kind === "stderr") stderrBytes += size;
      if (stdoutBytes + stderrBytes > MAX_COMMAND_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill();
        return;
      }
      if (kind === "stdout") stdout += chunk.toString("utf8");
      if (kind === "stderr") stderr += chunk.toString("utf8");
    }

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, commandConfig.timeoutMs);

    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.on("error", (error) => {
      finish({
        ok: false,
        status: 502,
        body: {
          error: "stt_command_spawn_failed",
          code: error.code || "spawn_failed",
        },
      });
    });
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          status: 504,
          body: { error: "stt_command_timeout" },
        });
        return;
      }
      if (outputTooLarge) {
        finish({
          ok: false,
          status: 502,
          body: { error: "stt_command_output_too_large" },
        });
        return;
      }
      if (code !== 0) {
        finish({
          ok: false,
          status: 502,
          body: {
            error: "stt_command_failed",
            exitCode: code,
            signal,
          },
        });
        return;
      }
      finish({ ok: true, stdout, stderr });
    });
  });
}

async function transcribeWithCommand(payload, config, audio) {
  if (!config.command?.command) {
    return {
      status: 500,
      body: { error: "stt_command_not_configured" },
    };
  }

  const tempDir = await mkdtemp(join(tmpdir(), "local-stt-"));
  const audioPath = join(tempDir, `audio${audioExtension(payload?.mimeType)}`);
  try {
    await writeFile(audioPath, audio);
    const commandResult = await runCommand(config.command, audioPath);
    if (!commandResult.ok) return commandResult;

    const parsed = parseCommandOutput(commandResult.stdout);
    if (!parsed.ok) return parsed;

    return {
      status: 200,
      body: {
        text: parsed.text,
        provider: "command",
        audioBytes: audio.byteLength,
        mimeType: payload?.mimeType || "",
      },
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function transcribePayload(payload, config) {
  const audio = decodeAudioBase64(payload?.audioBase64);
  if (!audio.byteLength) {
    return {
      status: 400,
      body: {
        error: "missing_audio",
        message: "audioBase64 is required.",
      },
    };
  }
  if (audio.byteLength > config.maxAudioBytes) {
    return {
      status: 413,
      body: {
        error: "audio_too_large",
        maxAudioBytes: config.maxAudioBytes,
      },
    };
  }

  if (config.provider === "mock") {
    const transcript = String(config.mockTranscript || "").trim();
    if (!transcript) {
      return {
        status: 501,
        body: {
          error: "mock_transcript_missing",
          message: "Set STT_MOCK_TRANSCRIPT for mock provider dry-runs.",
        },
      };
    }
    return {
      status: 200,
      body: {
        text: transcript,
        provider: "mock",
        audioBytes: audio.byteLength,
        mimeType: payload?.mimeType || "",
      },
    };
  }

  if (config.provider === "command") {
    return transcribeWithCommand(payload, config, audio);
  }

  return {
    status: 501,
    body: {
      error: "provider_not_implemented",
      provider: config.provider,
    },
  };
}
