import { apiProjectId, fetchAllTasks, filterTasks, sortTasks, taskSearchText, workloadSummary } from "./ticktick-data.mjs";
import { prune, ticktickRequest } from "./ticktick-api.mjs";

const DEFAULT_LIMIT = 20;

export function tokenizeQuery(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function stemToken(token) {
  let value = String(token || "").toLowerCase();
  if (value.length <= 5) return value;
  for (const ending of [
    "иями", "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими",
    "ать", "ить", "ешь", "ешься", "ую", "юю", "ая", "яя", "ое", "ее",
    "ые", "ие", "ый", "ий", "ой", "ам", "ям", "ах", "ях", "а", "я",
    "у", "ю", "е", "ы", "и", "о", "й",
  ]) {
    if (value.endsWith(ending) && value.length - ending.length >= 5) {
      value = value.slice(0, -ending.length);
      break;
    }
  }
  return value;
}

function tokenVariants(token) {
  const stem = stemToken(token);
  const variants = new Set([String(token || "").toLowerCase(), stem]);
  if (stem.startsWith("электр")) {
    variants.add("электр");
    variants.add("электроэнерг");
    variants.add("электричеств");
  }
  if (stem.startsWith("заявл") || stem.startsWith("обращ")) {
    variants.add("заявл");
    variants.add("обращ");
    variants.add("жалоб");
  }
  return [...variants].filter((variant) => variant.length >= 2);
}

function tokenMatchesText(text, token) {
  const lowerText = String(text || "").toLowerCase();
  const variants = tokenVariants(token);
  if (variants.some((variant) => lowerText.includes(variant))) return true;
  return words(lowerText).some((word) => {
    const wordStem = stemToken(word);
    if (wordStem.length < 5) return false;
    return variants.some((variant) => {
      const variantStem = stemToken(variant);
      return variantStem.length >= 5 && (wordStem.includes(variantStem) || variantStem.includes(wordStem));
    });
  });
}

function tokenMatchesList(values, token) {
  return values.some((value) => tokenMatchesText(value, token));
}

export function scoreTaskMatch(task, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  const tokens = tokenizeQuery(query);
  if (!normalizedQuery && tokens.length === 0) {
    return { score: 0, matchedKeywords: [], reasons: ["no query"] };
  }

  let score = 0;
  const matched = new Set();
  const reasons = [];
  const title = String(task.title || "").toLowerCase();
  const content = String(task.content || task.desc || "").toLowerCase();
  const projectName = String(task.projectName || "").toLowerCase();
  const tags = (task.tags || []).map((tag) => String(tag).toLowerCase());
  const checklist = (task.items || []).map((item) => String(item.title || item.content || "").toLowerCase());
  const wholeText = taskSearchText(task);

  if (title === normalizedQuery) {
    score += 100;
    reasons.push("exact title");
  } else if (title.includes(normalizedQuery)) {
    score += 45;
    reasons.push("title contains query");
  }
  if (content.includes(normalizedQuery)) {
    score += 18;
    reasons.push("content contains query");
  }
  if (projectName.includes(normalizedQuery)) {
    score += 10;
    reasons.push("project contains query");
  }
  if (tags.some((tag) => tag.includes(normalizedQuery))) {
    score += 20;
    reasons.push("tag contains query");
  }
  if (checklist.some((item) => item.includes(normalizedQuery))) {
    score += 10;
    reasons.push("checklist contains query");
  }

  for (const token of tokens) {
    if (!tokenMatchesText(wholeText, token)) continue;
    matched.add(token);
    if (tokenMatchesText(title, token)) score += 10;
    else if (tokenMatchesList(tags, token)) score += 8;
    else if (tokenMatchesText(content, token)) score += 4;
    else if (tokenMatchesList(checklist, token)) score += 3;
    else score += 2;
  }

  if (score > 0) {
    if (task.dueBucket === "overdue") score += 2;
    if (task.priority >= 5) score += 2;
  }

  return { score, matchedKeywords: [...matched], reasons };
}

export function rankTaskCandidates(tasks, query) {
  return tasks
    .map((task) => ({ ...task, match: scoreTaskMatch(task, query) }))
    .filter((task) => !query || task.match.score > 0)
    .sort((a, b) => {
      const scoreCompare = b.match.score - a.match.score;
      if (scoreCompare) return scoreCompare;
      return sortTasks([a, b])[0] === a ? -1 : 1;
    });
}

export async function searchTasks(args = {}) {
  const limit = Number(args.limit || DEFAULT_LIMIT);
  const tasks = filterTasks(await fetchAllTasks(args), {
    ...args,
    search: undefined,
    limit: undefined,
  });
  const ranked = args.query || args.search
    ? rankTaskCandidates(tasks, args.query || args.search)
    : sortTasks(tasks).map((task) => ({ ...task, match: { score: 0, matchedKeywords: [], reasons: [] } }));
  return {
    query: args.query || args.search || "",
    filters: {
      projectId: args.projectId,
      bucket: args.bucket,
      tag: args.tag,
      openOnly: args.openOnly !== false,
    },
    count: ranked.length,
    truncated: ranked.length > limit,
    tasks: ranked.slice(0, limit),
  };
}

export async function findTaskCandidates(args = {}) {
  const result = await searchTasks({ ...args, limit: args.limit || 10, openOnly: args.openOnly !== false });
  const candidates = result.tasks;
  const decision = candidateDecision(candidates, {
    allowBestMatch: args.allowBestMatch === true,
    minScore: Number(args.minScore || 45),
    minScoreGap: Number(args.minScoreGap || 25),
  });
  return { ...result, decision };
}

export function candidateDecision(candidates, options = {}) {
  if (candidates.length === 0) {
    return { status: "not_found", canAct: false, reason: "No matching open task was found." };
  }
  if (candidates.length === 1) {
    return { status: "single_candidate", canAct: true, taskId: candidates[0].id, projectId: candidates[0].projectId };
  }
  const [first, second] = candidates;
  const gap = first.match.score - second.match.score;
  if (options.allowBestMatch && first.match.score >= options.minScore && gap >= options.minScoreGap) {
    return {
      status: "best_match",
      canAct: true,
      taskId: first.id,
      projectId: first.projectId,
      reason: `Best match score ${first.match.score} is ${gap} points ahead of the next candidate.`,
    };
  }
  return {
    status: "ambiguous",
    canAct: false,
    reason: "Multiple matching tasks were found. Use the exact task ID or narrow the query.",
  };
}

export async function completeTaskSafe(args = {}) {
  if (args.projectId && args.taskId) {
    return completeById(args.projectId, args.taskId, { dryRun: args.dryRun === true, reason: "exact ids" });
  }
  const candidates = await findTaskCandidates({
    query: args.query || args.search,
    projectId: args.projectId,
    bucket: args.bucket,
    tag: args.tag,
    limit: args.limit || 10,
    allowBestMatch: args.allowBestMatch === true,
    minScore: args.minScore,
    minScoreGap: args.minScoreGap,
  });
  if (!candidates.decision.canAct) {
    return {
      acted: false,
      decision: candidates.decision,
      candidates: candidates.tasks,
    };
  }
  return completeById(candidates.decision.projectId, candidates.decision.taskId, {
    dryRun: args.dryRun === true,
    reason: candidates.decision.status,
    candidates: candidates.tasks,
  });
}

export async function completeById(projectId, taskId, options = {}) {
  const normalizedProjectId = apiProjectId(projectId);
  const result = {
    acted: false,
    dryRun: options.dryRun === true,
    projectId,
    apiProjectId: normalizedProjectId,
    taskId,
    reason: options.reason,
    candidates: options.candidates,
  };
  if (options.dryRun) return result;
  const response = await ticktickRequest("POST", `/project/${encodeURIComponent(normalizedProjectId)}/task/${encodeURIComponent(taskId)}/complete`);
  return { ...result, acted: true, response };
}

export async function moveTask(args = {}) {
  const payload = [officialMoveTaskPayload(args)];
  const response = await ticktickRequest("POST", "/task/move", payload);
  return {
    moved: true,
    ...payload[0],
    response,
  };
}

export function officialMoveTaskPayload(args = {}) {
  const fromProjectId = args.fromProjectId || args.sourceProjectId || args.projectId;
  const toProjectId = args.toProjectId || args.targetProjectId;
  return {
    fromProjectId,
    toProjectId,
    taskId: args.taskId,
  };
}

export function officialTaskFilterPayload(args = {}) {
  return prune({
    projectIds: args.projectIds,
    startDate: args.startDate,
    endDate: args.endDate,
    priority: args.priority,
    tag: args.tag,
    status: args.status,
  });
}

export async function filterTasksOfficial(args = {}) {
  const tasks = await ticktickRequest("POST", "/task/filter", officialTaskFilterPayload(args));
  return args.limit ? tasks.slice(0, Number(args.limit)) : tasks;
}

export function completedTaskPayload(args = {}) {
  return prune({
    projectIds: args.projectIds,
    startDate: args.startDate,
    endDate: args.endDate,
  });
}

export async function listCompletedTasks(args = {}) {
  const tasks = await ticktickRequest("POST", "/task/completed", completedTaskPayload(args));
  return args.limit ? tasks.slice(0, Number(args.limit)) : tasks;
}

export async function listInboxTasks(args = {}) {
  return filterTasks(await fetchAllTasks({ ...args, projectId: "inbox" }), { ...args, limit: args.limit || DEFAULT_LIMIT });
}

export async function listOverdueTasks(args = {}) {
  return filterTasks(await fetchAllTasks(args), { ...args, bucket: "overdue", limit: args.limit || DEFAULT_LIMIT });
}

export async function analyzeWorkload(args = {}) {
  const tasks = filterTasks(await fetchAllTasks(), { openOnly: true, limit: args.limit || 40 });
  return {
    generatedAt: new Date().toISOString(),
    summary: workloadSummary(tasks),
    tasks: args.includeTasks === false ? undefined : tasks,
  };
}
