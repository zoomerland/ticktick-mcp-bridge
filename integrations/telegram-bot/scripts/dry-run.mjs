import { loadConfig } from "../src/config.mjs";
import { routeText } from "../src/command-router.mjs";

const config = loadConfig({
  TELEGRAM_DRY_RUN: "true",
  TELEGRAM_ALLOWED_USER_IDS: "1001",
  TELEGRAM_CONFIRM_WRITES: "true",
  TELEGRAM_MAX_RESULTS: "3",
  TELEGRAM_REMINDER_LEAD_MINUTES: "30",
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function ticktickDateMinutesFromNow(minutes) {
  const date = new Date(Date.now() + minutes * 60 * 1000);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}T${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:00+0000`;
}

const bridge = {
  async callTool(name, args) {
    if (name === "ticktick_diagnostics") {
      return { ok: true, checks: { auth_configured: true, inbox_endpoint: true } };
    }
    if (name === "ticktick_today") {
      return {
        summary: { overdue: 1, today: 2 },
        tasks: [
          { id: "task-today-1", projectId: "project-work", title: "Review day plan", projectName: "Work", priority: 3, dueBucket: "today" },
          { id: "task-soon-1", projectId: "project-work", title: "Start focused block", projectName: "Work", priority: 5, dueBucket: "today", dueDate: ticktickDateMinutesFromNow(20) },
          { id: "task-overdue-1", projectId: "project-personal", title: "Check Inbox", projectName: "Personal", priority: 0, dueBucket: "overdue" },
        ],
      };
    }
    if (name === "ticktick_list_projects") {
      return [
        { id: "inbox", name: "Inbox", isInbox: true },
        { id: "project-work", name: "Work" },
        { id: "project-personal", name: "Personal" },
        { id: "project-health", name: "Health" },
      ];
    }
    if (name === "ticktick_inbox") {
      return [{ title: "Clarify doctor trip duration", projectName: "Inbox", priority: 0 }];
    }
    if (name === "ticktick_search_tasks") {
      return {
        tasks: [
          { title: `Candidate for ${args.query}`, projectName: "Projects", priority: 0 },
        ],
      };
    }
    if (name === "ticktick_find_task_candidates") {
      return {
        tasks: [
          { id: "task-complete-1", projectId: "project-1", title: "Call doctor", projectName: "Personal" },
        ],
        decision: {
          status: "single_candidate",
          canAct: true,
          taskId: "task-complete-1",
          projectId: "project-1",
        },
      };
    }
    if (name === "ticktick_complete_task_safe") {
      return { acted: true, projectId: args.projectId, taskId: args.taskId };
    }
    if (name === "ticktick_update_task") {
      return { id: args.taskId, updated: true };
    }
    if (name === "ticktick_create_task") {
      return { id: "task-created-1", title: args.title };
    }
    return { tasks: [] };
  },
};

const samples = [
  "/start",
  "/diagnostics",
  "/profile",
  "/set-sleep 22-7",
  "/set-checkins 10-20",
  "/set-reminder-lead 45",
  "/set-route doctor=project-health|Health",
  "/set-route доктор=project-health|Health",
  "/routes",
  "/projects",
  "/profile",
  "что у меня сегодня",
  "что дальше",
  "/сегодня",
  "/brief",
  "/proactive",
  "/reminders",
  "/checkin",
  "I am tired",
  "/cancel",
  "я не успеваю это сделать",
  "move today's lower priority tasks tomorrow",
  "/cancel",
  "оставь главное, перенеси остальное на завтра",
  "/cancel",
  "надо поехать к доктору завтра",
  "/today",
  "/search doctor",
  "/complete doctor",
  "/confirm",
  "/postpone-today tomorrow",
  "/confirm",
  "cancel today's plans",
  "/cancel",
  "/add go to doctor tomorrow",
  "30 minutes",
  "/confirm",
  "/add go to doctor tomorrow",
  "I don't know, from home to clinic",
  "at 09:00",
  "/confirm",
];

for (const sample of samples) {
  const result = await routeText(sample, { bridge, config });
  console.log(`\n> ${sample}\n${result.text}`);
}
