export function getVoiceMessage(update) {
  const message = update.message || update.edited_message || null;
  if (!message?.voice) return null;
  return {
    fileId: message.voice.file_id,
    duration: message.voice.duration,
    mimeType: message.voice.mime_type,
    fileSize: message.voice.file_size,
  };
}

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, nowMs() - startedAt);
}

export function formatVoiceUnsupported(voice, config) {
  const lines = [
    "Voice message received.",
    `duration: ${voice.duration ?? "unknown"}s`,
  ];

  if (!config.telegram.voiceEnabled || config.telegram.voiceProvider === "disabled") {
    lines.push("Voice transcription is not enabled yet.");
    lines.push("Send the same instruction as text, or enable a local transcription provider in a later gate.");
    return lines.join("\n");
  }

  lines.push(`Voice provider '${config.telegram.voiceProvider}' is configured, but no transcription adapter is implemented yet.`);
  lines.push("No file was downloaded and no transcript was created.");
  return lines.join("\n");
}

function audioToBase64(audio) {
  const bytes = audio?.bytes;
  if (!bytes) return "";
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8").toString("base64");
  return Buffer.from(bytes).toString("base64");
}

export async function downloadVoiceAudio({ voice, config, telegram }) {
  const startedAt = nowMs();
  if (!config.telegram.voiceDownloadEnabled) {
    return {
      ok: false,
      reason: "voice_download_disabled",
      text: "Telegram voice download is disabled.",
      timings: { voiceDownloadMs: elapsedMs(startedAt) },
    };
  }
  if (!telegram?.getFile || !telegram?.downloadFileBytes) {
    return {
      ok: false,
      reason: "telegram_downloader_missing",
      text: "Telegram downloader is not available in this runtime.",
      timings: { voiceDownloadMs: elapsedMs(startedAt) },
    };
  }
  if (!voice.fileId) {
    return {
      ok: false,
      reason: "missing_file_id",
      text: "Voice file id is missing.",
      timings: { voiceDownloadMs: elapsedMs(startedAt) },
    };
  }
  if (voice.fileSize && voice.fileSize > config.telegram.voiceMaxBytes) {
    return {
      ok: false,
      reason: "voice_file_too_large",
      text: `Voice file is too large for this gate. Limit: ${config.telegram.voiceMaxBytes} bytes.`,
      timings: { voiceDownloadMs: elapsedMs(startedAt) },
    };
  }

  const getFileStartedAt = nowMs();
  const file = await telegram.getFile(voice.fileId);
  const getFileMs = elapsedMs(getFileStartedAt);
  const fileSize = file.file_size || voice.fileSize || 0;
  if (fileSize && fileSize > config.telegram.voiceMaxBytes) {
    return {
      ok: false,
      reason: "voice_file_too_large",
      text: `Voice file is too large for this gate. Limit: ${config.telegram.voiceMaxBytes} bytes.`,
      timings: { telegramGetFileMs: getFileMs, voiceDownloadMs: elapsedMs(startedAt) },
    };
  }
  if (!file.file_path) {
    return {
      ok: false,
      reason: "missing_file_path",
      text: "Telegram did not return a voice file path.",
      timings: { telegramGetFileMs: getFileMs, voiceDownloadMs: elapsedMs(startedAt) },
    };
  }

  const downloadStartedAt = nowMs();
  const bytes = await telegram.downloadFileBytes(file.file_path, {
    maxBytes: config.telegram.voiceMaxBytes,
  });
  const telegramDownloadFileMs = elapsedMs(downloadStartedAt);
  if (bytes.byteLength > config.telegram.voiceMaxBytes) {
    return {
      ok: false,
      reason: "voice_file_too_large",
      text: `Downloaded voice file is too large for this gate. Limit: ${config.telegram.voiceMaxBytes} bytes.`,
      timings: {
        telegramGetFileMs: getFileMs,
        telegramDownloadFileMs,
        voiceDownloadMs: elapsedMs(startedAt),
        audioBytes: bytes.byteLength,
      },
    };
  }

  return {
    ok: true,
    audio: {
      bytes,
      mimeType: voice.mimeType || "audio/ogg",
    },
    timings: {
      telegramGetFileMs: getFileMs,
      telegramDownloadFileMs,
      voiceDownloadMs: elapsedMs(startedAt),
      audioBytes: bytes.byteLength,
    },
  };
}

async function callHttpVoiceProvider({ voice, config, audio, fetchImpl = fetch }) {
  const startedAt = nowMs();
  if (!config.telegram.voiceHttpUrl) {
    return {
      ok: false,
      reason: "missing_http_url",
      text: [
        "Voice message received.",
        `duration: ${voice.duration ?? "unknown"}s`,
        "HTTP voice provider is enabled, but TELEGRAM_VOICE_HTTP_URL is missing.",
        "No file was downloaded and no transcript was created.",
      ].join("\n"),
      timings: { sttHttpMs: elapsedMs(startedAt) },
    };
  }

  if (!audio?.bytes) {
    return {
      ok: false,
      reason: config.telegram.voiceDownloadEnabled ? "audio_payload_required" : "voice_download_disabled",
      text: [
        "Voice message received.",
        `duration: ${voice.duration ?? "unknown"}s`,
        config.telegram.voiceDownloadEnabled
          ? "HTTP voice provider is configured, but this gate has no audio payload."
          : "HTTP voice provider is configured, but Telegram voice download is disabled.",
        "No Telegram voice file was downloaded and no transcript was created.",
      ].join("\n"),
      timings: { sttHttpMs: elapsedMs(startedAt) },
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.telegram.voiceHttpTimeoutMs);
  try {
    const response = await fetchImpl(config.telegram.voiceHttpUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.telegram.voiceHttpToken ? { Authorization: `Bearer ${config.telegram.voiceHttpToken}` } : {}),
      },
      body: JSON.stringify({
        audioBase64: audioToBase64(audio),
        mimeType: audio.mimeType || voice.mimeType || "application/octet-stream",
        duration: voice.duration,
        fileSize: voice.fileSize,
      }),
      signal: controller.signal,
    });
    const body = await response.json();
    const sttHttpMs = elapsedMs(startedAt);
    const sttProviderElapsedMs = Number.isFinite(Number(body.elapsedMs)) ? Number(body.elapsedMs) : null;
    const sttRequestElapsedMs = Number.isFinite(Number(body.requestElapsedMs)) ? Number(body.requestElapsedMs) : null;
    if (!response.ok) {
      return {
        ok: false,
        reason: "http_provider_failed",
        text: [
          "Voice message received.",
          "HTTP voice provider returned an error. Check service logs before retrying.",
        ].join("\n"),
        timings: { sttHttpMs, sttProviderElapsedMs, sttRequestElapsedMs },
      };
    }
    const transcript = String(body.text || body.transcript || "").trim();
    if (!transcript) {
      return {
        ok: false,
        reason: "empty_transcript",
        text: [
          "Voice message received.",
          "HTTP voice provider returned an empty transcript.",
        ].join("\n"),
        timings: { sttHttpMs, sttProviderElapsedMs, sttRequestElapsedMs },
      };
    }
    return {
      ok: true,
      provider: body.provider || "http",
      transcript,
      audioBytes: Number(body.audioBytes || audio.bytes.byteLength || 0),
      sttElapsedMs: sttProviderElapsedMs,
      sttRequestElapsedMs,
      timings: { sttHttpMs, sttProviderElapsedMs, sttRequestElapsedMs },
      text: [
        "Voice transcript accepted.",
        `provider: ${body.provider || "http"}`,
      ].join("\n"),
    };
  } catch {
    return {
      ok: false,
      reason: "http_provider_unreachable",
      text: [
        "Voice message received.",
        "HTTP voice provider is unreachable or timed out.",
      ].join("\n"),
      timings: { sttHttpMs: elapsedMs(startedAt) },
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function transcribeVoiceMessage({ voice, config, audio = null, fetchImpl = fetch }) {
  if (!config.telegram.voiceEnabled || config.telegram.voiceProvider === "disabled") {
    return {
      ok: false,
      reason: "disabled",
      text: formatVoiceUnsupported(voice, config),
    };
  }

  if (config.telegram.voiceProvider === "http") {
    return callHttpVoiceProvider({ voice, config, audio, fetchImpl });
  }

  if (config.telegram.voiceProvider === "mock") {
    const transcript = String(config.telegram.voiceMockTranscript || "").trim();
    if (!transcript) {
      return {
        ok: false,
        reason: "missing_mock_transcript",
        text: [
          "Voice message received.",
          `duration: ${voice.duration ?? "unknown"}s`,
          "Mock voice provider is enabled, but TELEGRAM_VOICE_MOCK_TRANSCRIPT is empty.",
          "No file was downloaded and no transcript was created.",
        ].join("\n"),
      };
    }
    return {
      ok: true,
      provider: "mock",
      transcript,
      text: [
        "Voice transcript accepted.",
        "provider: mock",
        "No Telegram voice file was downloaded in this gate.",
      ].join("\n"),
    };
  }

  return {
    ok: false,
    reason: "unsupported_provider",
    text: formatVoiceUnsupported(voice, config),
  };
}

const SHORT_TRANSCRIPT_ALLOWLIST = new Set([
  "brief",
  "cancel",
  "checkin",
  "help",
  "inbox",
  "plan",
  "profile",
  "projects",
  "reminders",
  "routes",
  "today",
  "overdue",
  "день",
  "инбокс",
  "отмена",
  "план",
  "помощь",
  "профиль",
  "проекты",
  "сегодня",
  "стоп",
]);

export function isLowSignalVoiceTranscript(transcript) {
  const words = String(transcript || "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return true;
  if (words.length > 1) return false;
  const word = words[0];
  if (SHORT_TRANSCRIPT_ALLOWLIST.has(word)) return false;
  return word.length <= 3;
}

export function formatLowSignalVoiceTranscript() {
  return [
    "Voice message received.",
    "The transcript was too short or unclear, so I did not send it to the assistant.",
    "Please repeat it with a few more words.",
  ].join("\n");
}

export function formatVoiceRouted(transcription, routed) {
  return [
    transcription.text,
    "",
    "Routed as text:",
    routed.text,
  ].join("\n");
}
