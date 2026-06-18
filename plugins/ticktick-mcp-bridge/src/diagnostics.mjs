import { loadAuth, redactAuth } from "./auth-store.mjs";
import { fetchAllTasks, fetchProjectData, fetchProjects, workloadSummary } from "./ticktick-data.mjs";
import { ticktickRequest } from "./ticktick-api.mjs";

async function check(name, run) {
  try {
    const value = await run();
    return { name, ok: true, ...value };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      details: error?.details,
    };
  }
}

export async function runDiagnostics(args = {}) {
  const generatedAt = new Date().toISOString();
  const auth = redactAuth(loadAuth());
  const checks = [];
  const counts = {};

  checks.push({
    name: "auth_configured",
    ok: Boolean(auth.hasAccessToken),
    storagePath: auth.storagePath,
    hasClientId: auth.hasClientId,
    hasRefreshToken: auth.hasRefreshToken,
  });

  if (!auth.hasAccessToken) {
    return {
      ok: false,
      generatedAt,
      auth,
      checks,
      counts,
      nextAction: "Configure TickTick auth with ticktick_set_oauth_app + ticktick_get_auth_url + ticktick_exchange_code, or ticktick_set_bearer_token.",
    };
  }

  checks.push(await check("api_project_endpoint", async () => {
    const projects = await ticktickRequest("GET", "/project");
    counts.projectsFromApi = projects.length;
    return { count: projects.length };
  }));

  checks.push(await check("inbox_endpoint", async () => {
    const inbox = await fetchProjectData("inbox");
    counts.inboxOpenTasks = inbox.tasks.filter((task) => task.isOpen).length;
    counts.inboxTasks = inbox.tasks.length;
    return { count: inbox.tasks.length, openCount: counts.inboxOpenTasks };
  }));

  checks.push(await check("normalized_project_list", async () => {
    const projects = await fetchProjects();
    counts.projectsIncludingInbox = projects.length;
    counts.hasInboxPseudoProject = projects.some((project) => project.isInbox);
    return { count: projects.length, hasInboxPseudoProject: counts.hasInboxPseudoProject };
  }));

  if (args.includeTaskCounts !== false) {
    checks.push(await check("all_task_collection", async () => {
      const tasks = await fetchAllTasks();
      const summary = workloadSummary(tasks);
      counts.allTasks = tasks.length;
      counts.openTasks = summary.totalOpen;
      counts.buckets = summary.buckets;
      counts.priorities = summary.priorities;
      counts.projects = summary.projects;
      return { count: tasks.length, openCount: summary.totalOpen };
    }));
  }

  const ok = checks.every((item) => item.ok);
  return {
    ok,
    generatedAt,
    auth,
    checks,
    counts,
    warnings: ok ? [] : ["One or more TickTick bridge checks failed; inspect the failed check details before relying on task operations."],
  };
}
