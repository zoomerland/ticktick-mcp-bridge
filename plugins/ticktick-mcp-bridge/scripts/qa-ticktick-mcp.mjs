#!/usr/bin/env node
const baseUrl = process.env.MCP_BASE_URL || "http://127.0.0.1:8787/mcp";
const bearer = process.env.MCP_BEARER_TOKEN || process.env.APP_SHARED_SECRET || "";
const keepSandbox = process.env.MCP_QA_KEEP_SANDBOX === "1";

let id = 1;
const report = [];

function headers() {
  return {
    "Content-Type": "application/json",
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
  };
}

async function rpc(method, params = {}) {
  const response = await fetch(baseUrl, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method, params }),
  });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (error) {
    json = { parseError: error.message, text: text.slice(0, 500) };
  }
  return { status: response.status, json };
}

function parseToolResponse(response) {
  if (response.status !== 200) return { ok: false, transportStatus: response.status, json: response.json };
  if (response.json?.error) return { ok: false, rpcError: response.json.error };
  if (response.json?.result?.isError) {
    const text = response.json.result.content?.[0]?.text || "";
    try {
      return { ok: false, isError: true, details: JSON.parse(text) };
    } catch {
      return { ok: false, isError: true, details: { text } };
    }
  }
  const text = response.json?.result?.content?.[0]?.text || "{}";
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: true, value: text };
  }
}

function summarize(result) {
  if (result.ok) {
    const value = result.value || {};
    return {
      id: value.id,
      projectId: value.projectId,
      title: value.title,
      kind: value.kind,
      status: value.status,
      items: Array.isArray(value.items) ? value.items.length : undefined,
    };
  }
  const details = result.details || result.rpcError || result.json || {};
  return {
    error: details.error || details.message || details.text || "unknown error",
    details: details.details,
    status: details.details?.status || details.status,
  };
}

async function call(step, tool, args = {}, { expectError = false } = {}) {
  const response = await rpc("tools/call", { name: tool, arguments: args });
  const result = parseToolResponse(response);
  const passed = expectError ? !result.ok : result.ok;
  const row = {
    step,
    tool,
    passed,
    ok: result.ok,
    expectedError: expectError,
    transportStatus: response.status,
    summary: summarize(result),
  };
  report.push(row);
  console.log(JSON.stringify(row));
  if (!passed) throw new Error(`${step} failed`);
  return result;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let sandboxProjectId = null;
  try {
    await call("auth_status", "ticktick_auth_status");
    await call("diagnostics", "ticktick_diagnostics", { includeTaskCounts: false });
    await call("list_projects", "ticktick_list_projects");

    const project = await call("create_project", "ticktick_create_project", {
      name: `MCP QA Sandbox ${stamp}`,
      viewMode: "list",
      kind: "TASK",
    });
    sandboxProjectId = project.value.id;

    const textTask = await call("create_text_task", "ticktick_create_task", {
      projectId: sandboxProjectId,
      title: "MCP QA text task",
      content: "Original content",
      kind: "TEXT",
      tags: ["mcp-qa"],
    });
    const textTaskId = textTask.value.id;

    await call("get_text_task", "ticktick_get_task", { projectId: sandboxProjectId, taskId: textTaskId });
    await call("update_minimal", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: textTaskId,
      title: "MCP QA updated title",
      content: "MCP QA minimal content update",
    });
    await call("update_tags_priority_date", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: textTaskId,
      tags: ["mcp-qa", "test"],
      priority: 3,
      startDate: "2026-07-01T09:00:00+0300",
      dueDate: "2026-07-01T10:00:00+0300",
      timeZone: "Europe/Moscow",
      isAllDay: false,
    });
    const clearDates = await call("update_clear_dates", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: textTaskId,
      startDate: null,
      dueDate: null,
    });
    if (clearDates.value?.startDate || clearDates.value?.dueDate) {
      throw new Error("update_clear_dates did not clear startDate/dueDate");
    }
    await call("update_without_project_validation", "ticktick_update_task", {
      taskId: textTaskId,
      content: "Missing projectId should be rejected before TickTick API",
    }, { expectError: true });
    await call("update_bad_priority_validation", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: textTaskId,
      priority: 999,
    }, { expectError: true });
    await call("update_invalid_date_validation", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: textTaskId,
      dueDate: "not-a-date",
    }, { expectError: true });
    await call("update_text_to_checklist", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: textTaskId,
      kind: "CHECKLIST",
      items: [
        { title: "Item 1", status: 0, sortOrder: 0 },
        { title: "Item 2 completed", status: 1, sortOrder: 65536 },
      ],
    });

    const checklistTask = await call("create_checklist_task", "ticktick_create_task", {
      projectId: sandboxProjectId,
      title: "MCP QA checklist task",
      kind: "CHECKLIST",
      items: [
        { title: "Initial item", status: 0, sortOrder: 0 },
      ],
    });
    const checklistTaskId = checklistTask.value.id;
    const existingItems = Array.isArray(checklistTask.value.items) ? checklistTask.value.items : [];
    await call("update_checklist_items", "ticktick_update_task", {
      projectId: sandboxProjectId,
      taskId: checklistTaskId,
      kind: "CHECKLIST",
      items: [
        ...existingItems.map((item, index) => ({
          id: item.id,
          title: `${item.title || "Existing item"} updated`,
          status: index === 0 ? 1 : Number(item.status || 0),
          sortOrder: item.sortOrder ?? index * 65536,
        })),
        { title: "Added item", status: 0, sortOrder: 131072 },
      ],
    });

    await call("list_tasks_sandbox", "ticktick_list_tasks", { projectId: sandboxProjectId, limit: 10 });
    await call("search_tasks_sandbox", "ticktick_search_tasks", { projectId: sandboxProjectId, search: "MCP QA", limit: 10 });
    await call("filter_tasks_official", "ticktick_filter_tasks_official", { projectIds: [sandboxProjectId], status: [0] });
    await call("complete_task", "ticktick_complete_task", { projectId: sandboxProjectId, taskId: checklistTaskId });
    await sleep(1000);
    await call("list_completed_tasks", "ticktick_list_completed_tasks", { projectIds: [sandboxProjectId] });

    await call("rate_read_1", "ticktick_list_projects");
    await call("rate_read_2", "ticktick_list_projects");
    await call("rate_read_3", "ticktick_list_projects");
    for (let i = 0; i < 3; i += 1) {
      await call(`rate_write_${i + 1}`, "ticktick_update_task", {
        projectId: sandboxProjectId,
        taskId: textTaskId,
        content: `MCP QA rate write ${i + 1}`,
      });
      await sleep(i === 0 ? 1000 : 200);
    }
  } finally {
    if (sandboxProjectId && !keepSandbox) {
      try {
        await call("cleanup_project", "ticktick_delete_project", { projectId: sandboxProjectId });
      } catch (error) {
        console.error(JSON.stringify({ cleanupFailed: true, sandboxProjectId, error: error.message }));
      }
    } else if (sandboxProjectId) {
      console.error(JSON.stringify({ sandboxKept: true, sandboxProjectId }));
    }
    const failed = report.filter((row) => !row.passed);
    console.log(JSON.stringify({
      summary: {
        passed: report.length - failed.length,
        failed: failed.length,
        sandboxProjectId,
        cleanupAttempted: Boolean(sandboxProjectId && !keepSandbox),
      },
    }));
    if (failed.length) process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }));
  process.exitCode = 1;
});
