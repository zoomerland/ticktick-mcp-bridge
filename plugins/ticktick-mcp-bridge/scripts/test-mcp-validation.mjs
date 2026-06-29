import assert from "node:assert/strict";
import { handleRpc, validateSchema } from "../src/mcp-handler.mjs";
import { toolMap } from "../src/tools.mjs";

async function callTool(name, args) {
  return handleRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
}

function toolText(response) {
  return response.result.content[0].text;
}

function toolJson(response) {
  return JSON.parse(toolText(response));
}

async function assertToolError(name, args, expectedText) {
  const response = await callTool(name, args);
  assert.equal(response.result.isError, true);
  assert.match(toolText(response), expectedText);
  const payload = toolJson(response);
  assert.match(payload.diagnosticId, /^diag_/);
  assert.equal(payload.tool, name);
  assert.equal(payload.category, "invalid_tool_arguments");
  assert.match(payload.nextStep, /developer/i);
}

await assertToolError("ticktick_update_task", { taskId: "task-1" }, /projectId is required/);
await assertToolError("ticktick_update_task", { taskId: "task-1", projectId: "project-1", priority: 999 }, /priority must be one of/);
await assertToolError("ticktick_update_task", { taskId: "task-1", projectId: "project-1", tags: "not-array" }, /tags must be array/);
await assertToolError("ticktick_update_task", { taskId: "task-1", projectId: "project-1", items: "not-array" }, /items must be array/);
await assertToolError("ticktick_update_task", { taskId: "task-1", projectId: "project-1", dueDate: "not-a-date" }, /dueDate must be a valid TickTick date-time/);
await assertToolError("ticktick_update_task", {
  taskId: "task-1",
  projectId: "project-1",
  startDate: "2026-07-01T11:00:00+0300",
  dueDate: "2026-07-01T10:00:00+0300",
}, /startDate must be earlier than or equal to dueDate/);

await assertToolError("ticktick_create_task", { title: "No project" }, /projectId is required/);

const updateTaskSchema = toolMap.ticktick_update_task.inputSchema;
assert.deepEqual(validateSchema(updateTaskSchema, {
  taskId: "task-1",
  projectId: "project-1",
  startDate: null,
  dueDate: null,
}), []);
assert.match(validateSchema(updateTaskSchema, {
  taskId: "task-1",
  projectId: "project-1",
  dueDate: 123,
}).join("\n"), /dueDate must be string or null/);

console.log("MCP validation regression tests passed.");
