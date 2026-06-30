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

async function listTools() {
  const response = await handleRpc({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  return Object.fromEntries(response.result.tools.map((tool) => [tool.name, tool]));
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

const descriptors = await listTools();
const initialize = await handleRpc({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-03-26" },
});
assert.match(initialize.result.instructions, /clear task scheduling/);
assert.match(initialize.result.instructions, /ticktick_raw_request only/);

assert.equal(descriptors.ticktick_search_tasks.annotations.readOnlyHint, true);
assert.equal(descriptors.ticktick_search_tasks.annotations.openWorldHint, true);
assert.equal(descriptors.ticktick_update_task.annotations.readOnlyHint, false);
assert.equal(descriptors.ticktick_update_task.annotations.destructiveHint, false);
assert.equal(descriptors.ticktick_update_task.annotations.openWorldHint, true);
assert.equal(descriptors.ticktick_delete_task.annotations.destructiveHint, true);
assert.equal(descriptors.ticktick_raw_request.annotations.destructiveHint, true);
assert.equal(descriptors.ticktick_auth_status.annotations.openWorldHint, false);
assert.deepEqual(descriptors.ticktick_update_task.outputSchema, {
  type: "object",
  properties: {
    result: {
      description: "Tool-specific JSON result. The text content contains the same data formatted for compatibility.",
    },
  },
  required: ["result"],
  additionalProperties: false,
});

const authStatus = await callTool("ticktick_auth_status", {});
assert.ok(authStatus.result.structuredContent);
assert.deepEqual(Object.keys(authStatus.result.structuredContent), ["result"]);
assert.deepEqual(toolJson(authStatus), JSON.parse(JSON.stringify(authStatus.result.structuredContent.result)));

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
