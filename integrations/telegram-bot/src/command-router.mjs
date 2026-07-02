import { authorizeUpdate } from "./authz.mjs";
import { writeCommandBlockedMessage, isWriteCommand } from "./confirmations.mjs";
import { formatBridgeResult } from "./formatters.mjs";
import { loadDailyBrief } from "./secretary/brief.mjs";
import {
  analyzeTaskDraft,
  buildCreateTaskArgs,
  formatTaskCreated,
  formatTaskDraft,
  refineTaskDraft,
} from "./secretary/capture.mjs";
import { buildProactiveReview, loadProactiveInputs } from "./secretary/proactive.mjs";
import {
  clearCheckinState,
  handleCheckinReply,
  loadCheckin,
} from "./secretary/checkin.mjs";
import {
  buildPostponeAllTodayAction,
  buildPostponeRestTodayAction,
  buildPostponeTodayAction,
  formatPostponeResult,
  formatPostponeTodayAction,
  isPostponeAllTomorrowIntent,
  isPostponeRestTomorrowIntent,
  isPostponeTomorrowIntent,
  isScheduleRepairIntent,
  loadScheduleRepair,
} from "./secretary/repair.mjs";
import {
  buildCompleteAction,
  formatCompleteAction,
  formatCompleteCandidates,
  formatTaskCompleted,
} from "./secretary/complete.mjs";
import {
  applyProfileToConfig,
  formatProjectRoutes,
  formatProfile,
  updateCheckinProfile,
  updateProjectRouteProfile,
  updateReminderLeadProfile,
  updateSleepProfile,
} from "./secretary/profile.mjs";
import { loadUpcomingReminders } from "./secretary/reminders.mjs";
import { normalizeCommandName, resolveNaturalIntent } from "./secretary/intents.mjs";
import { formatTaskListForUser, routeLlmText } from "./secretary/llm-agent.mjs";
import {
  downloadVoiceAudio,
  formatVoiceRouted,
  getVoiceMessage,
  transcribeVoiceMessage,
} from "./secretary/voice.mjs";
import { globalSessionStore } from "./session-store.mjs";

const COMMAND_TO_TOOL = {
  diagnostics: { name: "ticktick_diagnostics", args: () => ({ includeTaskCounts: true }) },
  today: { name: "ticktick_today", args: (text) => ({ includeNext7Days: /\b(next7|week|7)\b/i.test(text) }) },
  overdue: { name: "ticktick_overdue", args: (_text, config) => ({ limit: config.telegram.maxResults }) },
  projects: { name: "ticktick_list_projects", args: () => ({}) },
  inbox: {
    name: "ticktick_inbox",
    args: (text, config) => ({
      ...(text ? { search: text } : {}),
      limit: config.telegram.maxResults,
    }),
  },
  search: {
    name: "ticktick_search_tasks",
    args: (text, config) => ({
      query: text,
      limit: config.telegram.maxResults,
      openOnly: true,
    }),
  },
};

export function parseCommand(text) {
  const trimmed = String(text || "").trim();
  const match = trimmed.match(/^\/([^\s@]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!match) return { command: "", argsText: trimmed };
  return { command: normalizeCommandName(match[1]), argsText: (match[2] || "").trim() };
}

export function helpText() {
  return [
    "TickTick secretary is online.",
    "Read-only commands:",
    "/diagnostics",
    "/checkin",
    "/brief",
    "/proactive",
    "/today",
    "/overdue",
    "/projects",
    "/inbox",
    "/search <query>",
    "/add <task text>",
    "/complete <task query>",
    "/postpone-today tomorrow",
    "/postpone-today all tomorrow",
    "/postpone-today rest tomorrow",
    "/profile",
    "/routes",
    "/set-sleep 23-8",
    "/set-checkins 9-21",
    "/set-reminder-lead 30",
    "/set-route keyword=projectId",
    "/reminders",
    "/capture <task text>",
    "/confirm",
    "/cancel",
    "",
    "TickTick writes require /confirm.",
  ].join("\n");
}

function sessionKey(principal) {
  return principal?.userId || principal?.chatId || "local";
}

function storeDraft(session, key, draft) {
  session?.setPendingTaskDraft(key, draft);
  return draft;
}

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAt) {
  return Math.max(0, nowMs() - startedAt);
}

function withTiming(result, timings) {
  return {
    ...result,
    _timings: {
      ...(result?._timings || {}),
      ...timings,
    },
  };
}

function logVoiceTiming(logger, payload) {
  logger?.info?.(JSON.stringify({
    event: "telegram_voice_pipeline_timing",
    ...payload,
  }));
}

export async function routeText(
  text,
  {
    bridge,
    config,
    session = globalSessionStore,
    principal = null,
    llmClient = null,
    allowLlm = true,
  },
) {
  const routeStartedAt = nowMs();
  let { command, argsText } = parseCommand(text);
  let naturalUserText = "";
  const key = sessionKey(principal);

  if (!command && argsText) {
    const pending = session?.getPendingTaskDraft(key);
    const pendingAction = session?.getPendingAction(key);
    if (!pending && !pendingAction) {
      const checkinReply = await handleCheckinReply({
        text: argsText,
        bridge,
        config,
        session,
        key,
      });
      if (checkinReply) return checkinReply;
    }
    if (!pending && isPostponeRestTomorrowIntent(argsText)) {
      const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
      const action = buildPostponeRestTodayAction({ todayData, destination: "tomorrow", config });
      if (action.valid) session?.setPendingAction(key, action);
      return {
        kind: action.valid ? "postpone_draft" : "postpone_review",
        tool: "ticktick_today",
        text: formatPostponeTodayAction(action),
      };
    }
    if (!pending && isPostponeAllTomorrowIntent(argsText)) {
      const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
      const action = buildPostponeAllTodayAction({ todayData, destination: "tomorrow", config });
      if (action.valid) session?.setPendingAction(key, action);
      return {
        kind: action.valid ? "postpone_draft" : "postpone_review",
        tool: "ticktick_today",
        text: formatPostponeTodayAction(action),
      };
    }
    if (!pending && isPostponeTomorrowIntent(argsText)) {
      const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
      const action = buildPostponeTodayAction({ todayData, destination: "tomorrow", config });
      if (action.valid) session?.setPendingAction(key, action);
      return {
        kind: action.valid ? "postpone_draft" : "postpone_review",
        tool: "ticktick_today",
        text: formatPostponeTodayAction(action),
      };
    }
    if (!pending && isScheduleRepairIntent(argsText)) {
      return {
        kind: "schedule_repair",
        text: await loadScheduleRepair({ bridge, config, userText: argsText }),
      };
    }
    const naturalIntent = resolveNaturalIntent(argsText, { hasPending: Boolean(pending || pendingAction) });
    if (naturalIntent && naturalIntent.command !== "proactive") {
      naturalUserText = argsText;
      command = naturalIntent.command;
      argsText = naturalIntent.argsText;
    } else if (!pending && !pendingAction && allowLlm && config.llm?.enabled) {
      const llmResult = await routeLlmText(argsText, {
        bridge,
        config,
        llmClient,
        executeCommand: (nextText) => routeText(nextText, {
          bridge,
          config,
          session,
          principal,
          llmClient: null,
          allowLlm: false,
        }),
      });
      if (llmResult) return withTiming(llmResult, { routeTotalMs: elapsedMs(routeStartedAt) });
    }
    if (!command && naturalIntent) {
      naturalUserText = argsText;
      command = naturalIntent.command;
      argsText = naturalIntent.argsText;
    }
    if (!command) {
      const profile = session?.getProfile(key);
      const draft = pending
        ? refineTaskDraft(pending, argsText, config, profile)
        : analyzeTaskDraft(argsText, config, profile);
      return {
        kind: "task_draft",
        text: formatTaskDraft(storeDraft(session, key, draft)),
      };
    }
  }

  if (!command || command === "start" || command === "help") {
    return { kind: "local", text: helpText() };
  }

  if (command === "profile") {
    return {
      kind: "profile",
      text: formatProfile(session?.getProfile(key), config),
    };
  }

  if (command === "routes") {
    return {
      kind: "profile",
      text: formatProjectRoutes(session?.getProfile(key), config),
    };
  }

  if (command === "set-sleep") {
    const result = updateSleepProfile(session, key, argsText);
    return {
      kind: result.ok ? "profile_updated" : "invalid",
      text: result.text,
    };
  }

  if (command === "set-checkins") {
    const result = updateCheckinProfile(session, key, argsText);
    return {
      kind: result.ok ? "profile_updated" : "invalid",
      text: result.text,
    };
  }

  if (command === "set-reminder-lead") {
    const result = updateReminderLeadProfile(session, key, argsText);
    return {
      kind: result.ok ? "profile_updated" : "invalid",
      text: result.text,
    };
  }

  if (command === "set-route") {
    const result = updateProjectRouteProfile(session, key, argsText);
    return {
      kind: result.ok ? "profile_updated" : "invalid",
      text: result.text,
    };
  }

  if (command === "capture") {
    if (!argsText) return { kind: "invalid", text: "Usage: /capture <task text>" };
    const draft = analyzeTaskDraft(argsText, config, session?.getProfile(key));
    return {
      kind: "task_draft",
      text: formatTaskDraft(storeDraft(session, key, draft)),
    };
  }

  if (command === "add") {
    if (!argsText) return { kind: "invalid", text: "Usage: /add <task text>" };
    const draft = analyzeTaskDraft(argsText, config, session?.getProfile(key));
    return {
      kind: "task_draft",
      text: formatTaskDraft(storeDraft(session, key, draft)),
    };
  }

  if (command === "cancel") {
    const pending = session?.clearPending(key);
    const checkin = clearCheckinState(session, key);
    return {
      kind: "cancelled",
      text: pending?.taskDraft || pending?.action || pending?.checkin || checkin
        ? "Pending action cancelled."
        : "No pending action.",
    };
  }

  if (command === "confirm") {
    if (!config.telegram.confirmWrites) {
      return {
        kind: "writes_disabled",
        text: "TickTick writes are disabled by TELEGRAM_CONFIRM_WRITES=false. Pending action was not executed. Send /cancel to clear it.",
      };
    }

    const action = session?.getPendingAction(key);
    if (action?.type === "complete_task") {
      const completed = await bridge.callTool("ticktick_complete_task_safe", {
        projectId: action.projectId,
        taskId: action.taskId,
      });
      session?.clearPendingAction(key);
      return {
        kind: "completed_task",
        tool: "ticktick_complete_task_safe",
        text: formatTaskCompleted(completed),
      };
    }
    if (action?.type === "postpone_tasks") {
      const results = [];
      for (const update of action.updates) {
        results.push(await bridge.callTool("ticktick_update_task", {
          taskId: update.taskId,
          projectId: update.projectId,
          dueDate: update.dueDate,
          isAllDay: update.isAllDay,
          timeZone: update.timeZone,
        }));
      }
      session?.clearPendingAction(key);
      return {
        kind: "postponed_tasks",
        tool: "ticktick_update_task",
        text: formatPostponeResult(results.map((result, index) => ({
          ...result,
          taskId: action.updates[index]?.taskId,
        }))),
      };
    }

    const draft = session?.getPendingTaskDraft(key);
    if (!draft) return { kind: "invalid", text: "No pending task draft to confirm." };
    if (!draft.canCreateNow) {
      return {
        kind: "invalid",
        text: `Cannot create yet.\n\n${formatTaskDraft(draft)}`,
      };
    }
    const created = await bridge.callTool("ticktick_create_task", buildCreateTaskArgs(draft, config));
    session?.clearPendingTaskDraft(key);
    return {
      kind: "created_task",
      tool: "ticktick_create_task",
      text: formatTaskCreated(created),
    };
  }

  if (command === "complete") {
    if (!argsText) return { kind: "invalid", text: "Usage: /complete <task query>" };
    const candidates = await bridge.callTool("ticktick_find_task_candidates", {
      query: argsText,
      openOnly: true,
      allowBestMatch: false,
      limit: config.telegram.maxResults,
    });
    const action = buildCompleteAction(candidates, argsText);
    if (!action) {
      return {
        kind: "complete_candidates",
        tool: "ticktick_find_task_candidates",
        text: formatCompleteCandidates(candidates, argsText),
      };
    }
    session?.setPendingAction(key, action);
    return {
      kind: "complete_draft",
      tool: "ticktick_find_task_candidates",
      text: formatCompleteAction(action),
    };
  }

  if (command === "postpone-today") {
    if (!argsText) return { kind: "invalid", text: "Usage: /postpone-today tomorrow, /postpone-today all tomorrow, or /postpone-today rest tomorrow" };
    const todayData = await bridge.callTool("ticktick_today", { includeNext7Days: false });
    const tokens = argsText.split(/\s+/).filter(Boolean);
    const mode = tokens[0]?.toLowerCase();
    const allMode = mode === "all";
    const restMode = mode === "rest";
    const destination = allMode || restMode ? tokens.slice(1).join(" ") : argsText;
    const action = allMode
      ? buildPostponeAllTodayAction({ todayData, destination, config })
      : restMode
        ? buildPostponeRestTodayAction({ todayData, destination, config })
        : buildPostponeTodayAction({ todayData, destination: argsText, config });
    if (!action.valid) {
      return {
        kind: "postpone_review",
        tool: "ticktick_today",
        text: formatPostponeTodayAction(action),
      };
    }
    session?.setPendingAction(key, action);
    return {
      kind: "postpone_draft",
      tool: "ticktick_today",
      text: formatPostponeTodayAction(action),
    };
  }

  if (isWriteCommand(command)) {
    return { kind: "blocked_write", text: writeCommandBlockedMessage(command) };
  }

  if (command === "brief" || command === "plan") {
    return {
      kind: "bridge",
      command,
      tool: "secretary_daily_brief",
      text: await loadDailyBrief({ bridge, config }),
    };
  }

  if (command === "checkin") {
    const checkin = await loadCheckin({
      bridge,
      config,
      session,
      key,
    });
    return {
      kind: "bridge",
      command,
      tool: "secretary_checkin",
      text: checkin.text,
    };
  }

  if (command === "proactive") {
    const effectiveConfig = applyProfileToConfig(config, session?.getProfile(key));
    const inputs = await loadProactiveInputs({ bridge, config });
    return {
      kind: "bridge",
      command,
      tool: "secretary_proactive_review",
      text: buildProactiveReview(inputs, effectiveConfig).text,
    };
  }

  if (command === "reminders") {
    const reminder = await loadUpcomingReminders({
      bridge,
      config,
      profile: session?.getProfile(key),
    });
    return {
      kind: "bridge",
      command,
      tool: "secretary_upcoming_reminders",
      text: reminder.text,
    };
  }

  const spec = COMMAND_TO_TOOL[command];
  if (!spec) {
    return { kind: "unknown", text: `Unknown command: /${command}\n\n${helpText()}` };
  }
  if (command === "search" && !argsText) {
    return { kind: "invalid", text: "Usage: /search <query>" };
  }

  const bridgeStartedAt = nowMs();
  const data = await bridge.callTool(spec.name, spec.args(argsText, config));
  const formattedText = formatBridgeResult(command, data, config);
  const userText = naturalUserText
    ? (formatTaskListForUser({ tool: spec.name, text: formattedText }, naturalUserText) || formattedText)
    : formattedText;
  return {
    kind: "bridge",
    command,
    tool: spec.name,
    text: userText,
    _timings: {
      bridgeMs: elapsedMs(bridgeStartedAt),
      routeTotalMs: elapsedMs(routeStartedAt),
    },
  };
}

export async function handleUpdate(
  update,
  { bridge, config, llmClient = null, rateLimiter, session = globalSessionStore, telegram = null, voiceFetchImpl = fetch, logger = null },
) {
  const updateStartedAt = nowMs();
  const auth = authorizeUpdate(update, config);
  const chatId = auth.principal.chatId || update.message?.chat?.id;
  if (!auth.ok) {
    return { chatId, text: "Access denied.", authorized: false, reason: auth.reason };
  }

  const limit = rateLimiter?.check(auth.principal.userId);
  if (limit && !limit.ok) {
    return {
      chatId,
      text: `Rate limit reached. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.`,
      authorized: true,
      rateLimited: true,
    };
  }

  const text = update.message?.text || update.edited_message?.text || "";
  const voice = getVoiceMessage(update);
  if (voice) {
    let audio = null;
    const timings = {};
    if (config.telegram.voiceProvider === "http" && config.telegram.voiceDownloadEnabled) {
      const download = await downloadVoiceAudio({ voice, config, telegram });
      Object.assign(timings, download.timings || {});
      if (!download.ok) {
        logVoiceTiming(logger, {
          status: "download_failed",
          updateId: update.update_id,
          reason: download.reason,
          provider: config.telegram.voiceProvider,
          voiceDurationSec: voice.duration ?? null,
          voiceFileSize: voice.fileSize ?? null,
          voiceMimeType: voice.mimeType || null,
          timings: {
            ...timings,
            totalMs: elapsedMs(updateStartedAt),
          },
        });
        return {
          chatId,
          kind: "voice_received",
          text: [
            "Voice message received.",
            `duration: ${voice.duration ?? "unknown"}s`,
            download.text,
            "No transcript was created.",
          ].join("\n"),
          authorized: true,
        };
      }
      audio = download.audio;
    }

    const transcription = await transcribeVoiceMessage({ voice, config, audio, fetchImpl: voiceFetchImpl });
    Object.assign(timings, transcription.timings || {});
    if (transcription.ok) {
      const routeStartedAt = nowMs();
      const routed = await routeText(transcription.transcript, {
        bridge,
        config,
        session,
        llmClient,
        principal: auth.principal,
      });
      timings.routeMs = elapsedMs(routeStartedAt);
      Object.assign(timings, routed._timings || {});
      timings.totalMs = elapsedMs(updateStartedAt);
      logVoiceTiming(logger, {
        status: "ok",
        updateId: update.update_id,
        provider: transcription.provider,
        routedKind: routed.kind,
        routedBy: routed.routedBy || null,
        narratedBy: routed.narratedBy || null,
        voiceDurationSec: voice.duration ?? null,
        voiceFileSize: voice.fileSize ?? null,
        voiceMimeType: voice.mimeType || null,
        audioBytes: transcription.audioBytes || timings.audioBytes || null,
        timings,
      });
      return {
        chatId,
        kind: `voice_${routed.kind}`,
        text: formatVoiceRouted(transcription, routed),
        authorized: true,
      };
    }
    timings.totalMs = elapsedMs(updateStartedAt);
    logVoiceTiming(logger, {
      status: "stt_failed",
      updateId: update.update_id,
      reason: transcription.reason,
      provider: config.telegram.voiceProvider,
      voiceDurationSec: voice.duration ?? null,
      voiceFileSize: voice.fileSize ?? null,
      voiceMimeType: voice.mimeType || null,
      audioBytes: timings.audioBytes || null,
      timings,
    });
    return {
      chatId,
      kind: "voice_received",
      text: transcription.text,
      authorized: true,
    };
  }
  if (!text) return { chatId, text: "Send a text command first.", authorized: true };
  return {
    chatId,
    ...(await routeText(text, {
      bridge,
      config,
      session,
      llmClient,
      principal: auth.principal,
    })),
    authorized: true,
  };
}
