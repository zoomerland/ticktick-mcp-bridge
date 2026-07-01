import { pathToFileURL } from "node:url";
import { loadConfig } from "../src/config.mjs";
import { handleUpdate } from "../src/command-router.mjs";
import { SessionStore } from "../src/session-store.mjs";

const DEFAULT_UPDATES = 5000;
const DEFAULT_USER_ID = "10";
const DEFAULT_CHAT_ID = "10";

function parseInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function bytesToMiB(value) {
  return Number((value / 1024 / 1024).toFixed(2));
}

function createTask(index, overrides = {}) {
  const bucket = overrides.dueBucket || (index % 5 === 0 ? "overdue" : "today");
  const date = bucket === "overdue" ? "2026-06-23" : "2026-06-24";
  const hour = 9 + (index % 9);
  return {
    id: `task-${index}`,
    taskId: `task-${index}`,
    projectId: overrides.projectId || "project-personal",
    projectName: overrides.projectName || "Stress",
    title: overrides.title || `Stress task ${index}`,
    dueBucket: bucket,
    dueDate: `${date}T${String(hour).padStart(2, "0")}:00:00+0000`,
    priority: overrides.priority ?? (index % 3 === 0 ? 5 : 1),
  };
}

function createBridgeFixture() {
  const todayTasks = Array.from({ length: 30 }, (_, index) => createTask(index));
  const inboxTasks = Array.from({ length: 8 }, (_, index) => createTask(index + 100, {
    dueBucket: "no_due_date",
    projectId: "inbox",
    projectName: "Inbox",
    title: `Inbox stress item ${index}`,
  }));
  const projects = [
    { id: "inbox", name: "Inbox", kind: "TASK", isInbox: true },
    { id: "project-personal", name: "Personal", kind: "TASK" },
    { id: "project-work", name: "Work", kind: "TASK" },
  ];
  const calls = new Map();

  function count(name) {
    calls.set(name, (calls.get(name) || 0) + 1);
  }

  return {
    calls,
    async callTool(name, args = {}) {
      count(name);
      if (/create|update|delete|move|complete/i.test(name)) {
        throw new Error(`Unexpected write tool during resource stress: ${name}`);
      }
      if (name === "ticktick_diagnostics") {
        return { ok: true, checks: { auth_configured: true, stress: true } };
      }
      if (name === "ticktick_today") {
        return {
          tasks: todayTasks,
          summary: { total: todayTasks.length, includeNext7Days: Boolean(args.includeNext7Days) },
        };
      }
      if (name === "ticktick_overdue") {
        return { tasks: todayTasks.filter((task) => task.dueBucket === "overdue") };
      }
      if (name === "ticktick_inbox") {
        return { tasks: inboxTasks.slice(0, Number(args.limit || 10)) };
      }
      if (name === "ticktick_search_tasks") {
        return { tasks: todayTasks.slice(0, Number(args.limit || 10)) };
      }
      if (name === "ticktick_find_task_candidates") {
        return {
          query: args.query,
          candidates: todayTasks.slice(0, 3),
          decision: { canAct: false, reason: "stress keeps completion read-only" },
        };
      }
      if (name === "ticktick_list_projects") {
        return { projects };
      }
      throw new Error(`Unexpected tool during resource stress: ${name}`);
    },
  };
}

function createConfig() {
  return loadConfig({
    TELEGRAM_DRY_RUN: "true",
    TELEGRAM_ALLOWED_USER_IDS: DEFAULT_USER_ID,
    TELEGRAM_CONFIRM_WRITES: "false",
    TELEGRAM_REQUIRE_PROJECT_FOR_CREATION: "true",
    TELEGRAM_MAX_RESULTS: "10",
    BOT_RATE_LIMIT_MAX_COMMANDS: "1000000",
  });
}

function commandPlan(index) {
  const commands = [
    "/diagnostics",
    "/today",
    "/brief",
    "/reminders",
    "/inbox",
    "/projects",
    "/overdue",
    "/search stress",
    "/checkin",
    "I am on track",
    "/add stress task today",
    "/cancel",
    "/profile",
    "/routes",
  ];
  return commands[index % commands.length];
}

function createUpdate(index, text) {
  return {
    update_id: index + 1,
    message: {
      message_id: index + 1,
      date: 1782260000 + index,
      text,
      from: {
        id: Number(DEFAULT_USER_ID),
        is_bot: false,
        username: "stress_user",
      },
      chat: {
        id: Number(DEFAULT_CHAT_ID),
        type: "private",
      },
    },
  };
}

function memorySample(label) {
  const memory = process.memoryUsage();
  return {
    label,
    rssMiB: bytesToMiB(memory.rss),
    heapUsedMiB: bytesToMiB(memory.heapUsed),
    heapTotalMiB: bytesToMiB(memory.heapTotal),
    externalMiB: bytesToMiB(memory.external),
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function summarizeKinds(kinds) {
  return Object.fromEntries([...kinds.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

export async function runResourceStress({ env = process.env } = {}) {
  const updates = parseInteger(env.STRESS_UPDATES, DEFAULT_UPDATES);
  const sampleEvery = Math.max(1, Math.floor(updates / 20));
  const config = createConfig();
  const bridge = createBridgeFixture();
  const session = new SessionStore();
  const latencies = [];
  const kinds = new Map();
  const sent = { count: 0, bytes: 0 };
  const samples = [memorySample("before")];

  if (global.gc) global.gc();
  const memoryAfterGcBefore = memorySample("after-initial-gc");
  const cpuBefore = process.cpuUsage();
  const wallBefore = performance.now();

  for (let index = 0; index < updates; index += 1) {
    const text = commandPlan(index);
    const started = performance.now();
    const reply = await handleUpdate(createUpdate(index, text), {
      bridge,
      config,
      session,
      telegram: null,
    });
    const elapsed = performance.now() - started;
    latencies.push(elapsed);
    kinds.set(reply.kind || "reply", (kinds.get(reply.kind || "reply") || 0) + 1);
    if (reply.chatId && reply.text) {
      sent.count += 1;
      sent.bytes += Buffer.byteLength(reply.text, "utf8");
    }
    if ((index + 1) % sampleEvery === 0) {
      samples.push(memorySample(`after-${index + 1}`));
    }
  }

  const wallMs = performance.now() - wallBefore;
  const cpu = process.cpuUsage(cpuBefore);
  if (global.gc) global.gc();
  const memoryAfterGcAfter = memorySample("after-final-gc");
  samples.push(memorySample("after"));

  const cpuMs = (cpu.user + cpu.system) / 1000;
  const rssValues = samples.map((sample) => sample.rssMiB);
  const heapValues = samples.map((sample) => sample.heapUsedMiB);

  return {
    updates,
    dryRun: config.dryRun,
    writesAllowed: config.telegram.confirmWrites,
    wallMs: Number(wallMs.toFixed(2)),
    updatesPerSecond: Number((updates / (wallMs / 1000)).toFixed(2)),
    cpuMs: Number(cpuMs.toFixed(2)),
    cpuPercentSingleCore: Number(((cpuMs / wallMs) * 100).toFixed(2)),
    latencyMs: {
      min: Number(Math.min(...latencies).toFixed(3)),
      mean: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3)),
      p50: Number(percentile(latencies, 50).toFixed(3)),
      p95: Number(percentile(latencies, 95).toFixed(3)),
      p99: Number(percentile(latencies, 99).toFixed(3)),
      max: Number(Math.max(...latencies).toFixed(3)),
    },
    memoryMiB: {
      before: memoryAfterGcBefore,
      afterFinalGc: memoryAfterGcAfter,
      maxRss: Number(Math.max(...rssValues).toFixed(2)),
      maxHeapUsed: Number(Math.max(...heapValues).toFixed(2)),
      rssDeltaFinalGc: Number((memoryAfterGcAfter.rssMiB - memoryAfterGcBefore.rssMiB).toFixed(2)),
      heapDeltaFinalGc: Number((memoryAfterGcAfter.heapUsedMiB - memoryAfterGcBefore.heapUsedMiB).toFixed(2)),
    },
    replyKinds: summarizeKinds(kinds),
    sent,
    bridgeCalls: summarizeKinds(bridge.calls),
    sessionSummary: {
      sessions: session.sessions.size,
      hasPendingAfterStress: [...session.sessions.values()].some((value) => (
        value.pendingAction || value.pendingTaskDraft || value.pendingCheckin
      )),
    },
  };
}

export async function main() {
  const result = await runResourceStress();
  console.log(JSON.stringify(result, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error("Resource stress failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
}
