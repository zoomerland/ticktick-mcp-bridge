import { TickTickError } from "./ticktick-api.mjs";
import { toolMap, tools } from "./tools.mjs";
import { chatgptToolSecuritySchemes } from "./chatgpt-oauth.mjs";

export const SERVER_INFO = {
  name: "ticktick-mcp-bridge",
  version: "0.3.1+codex.20260618-163502",
};

export function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

export function rpcError(id, error, code = -32000, data = undefined) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
      ...(data ? { data } : {}),
    },
  };
}

function diagnosticId() {
  return `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|authorization|cookie|password/i.test(key)) {
      result[key] = "[REDACTED]";
    } else if (/title|content|desc|note|description/i.test(key) && typeof item === "string") {
      result[key] = `[REDACTED:${item.length} chars]`;
    } else {
      result[key] = redact(item);
    }
  }
  return result;
}

function logDiagnostic(entry) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: "error",
    event: "mcp_tool_error",
    ...redact(entry),
  }));
}

function errorCategory(error) {
  if (error instanceof TickTickError) {
    const status = Number(error.details?.status || 0);
    if (status === 401 || status === 403) return "ticktick_auth_or_scope";
    if (status === 404) return "ticktick_not_found";
    if (status === 429) return "ticktick_rate_limit";
    if (status >= 500) return "ticktick_upstream";
    return "ticktick_api_error";
  }
  if (error?.name === "SyntaxError") return "invalid_json_or_parse_error";
  return "internal_error";
}

function userErrorPayload({ error, toolName, args, validationErrors }) {
  const id = diagnosticId();
  const category = validationErrors ? "invalid_tool_arguments" : errorCategory(error);
  const payload = {
    error: validationErrors ? "Invalid tool arguments" : "TickTick MCP tool failed",
    diagnosticId: id,
    category,
    tool: toolName,
    message: validationErrors
      ? "The tool input did not match the safe TickTick MCP contract."
      : error instanceof Error ? error.message : String(error),
    details: validationErrors || (error instanceof TickTickError ? error.details : undefined),
    nextStep: "If this came from ChatGPT, send this diagnosticId and the visible error text to the plugin developer. Do not send tokens or Authorization headers.",
  };
  logDiagnostic({
    diagnosticId: id,
    category,
    tool: toolName,
    message: payload.message,
    arguments: args,
    details: payload.details,
    stack: error?.stack?.split("\n").slice(0, 6),
  });
  return payload;
}

export function listToolDescriptors() {
  const securitySchemes = chatgptToolSecuritySchemes();
  return tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
    securitySchemes,
    _meta: { securitySchemes },
  }));
}

function typeOf(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === "array") return Array.isArray(value);
  if (expected === "object") return value !== null && !Array.isArray(value) && typeof value === "object";
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "integer") return Number.isInteger(value);
  return typeof value === expected;
}

function validateSchema(schema = {}, value, path = "arguments") {
  const errors = [];
  if (schema.oneOf) {
    const matches = schema.oneOf.filter((candidate) => validateSchema(candidate, value, path).length === 0);
    if (matches.length !== 1) errors.push(`${path} must match exactly one allowed schema`);
    return errors;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} must be one of: ${schema.enum.join(", ")}`);
  }
  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path} must be ${schema.type}, got ${typeOf(value)}`);
    return errors;
  }
  if (schema.type === "object") {
    const objectValue = value || {};
    for (const field of schema.required || []) {
      if (objectValue[field] === undefined || objectValue[field] === null || objectValue[field] === "") {
        errors.push(`${path}.${field} is required`);
      }
    }
    for (const [field, fieldSchema] of Object.entries(schema.properties || {})) {
      if (objectValue[field] !== undefined) {
        errors.push(...validateSchema(fieldSchema, objectValue[field], `${path}.${field}`));
      }
    }
  }
  if (schema.type === "array" && schema.items) {
    value.forEach((item, index) => {
      errors.push(...validateSchema(schema.items, item, `${path}[${index}]`));
    });
  }
  return errors;
}

export async function handleRpc(message) {
  const { id, method, params } = message;

  if (method === "initialize") {
    return rpcResult(id, {
      protocolVersion: params?.protocolVersion || "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (method === "notifications/initialized") return null;
  if (method === "ping") return rpcResult(id, {});

  if (method === "tools/list") {
    return rpcResult(id, { tools: listToolDescriptors() });
  }

  if (method === "tools/call") {
    const tool = toolMap[params?.name];
    if (!tool) return rpcError(id, `Unknown tool: ${params?.name}`, -32602);

    try {
      const args = params?.arguments || {};
      const validationErrors = validateSchema(tool.inputSchema, args);
      if (validationErrors.length) {
        const payload = userErrorPayload({
          toolName: params?.name,
          args,
          validationErrors,
        });
        return rpcResult(id, {
          isError: true,
          content: [{
            type: "text",
            text: JSON.stringify(payload, null, 2),
          }],
        });
      }
      if (tool.validate) {
        const customErrors = tool.validate(args) || [];
        if (customErrors.length) {
          const payload = userErrorPayload({
            toolName: params?.name,
            args,
            validationErrors: customErrors,
          });
          return rpcResult(id, {
            isError: true,
            content: [{
              type: "text",
              text: JSON.stringify(payload, null, 2),
            }],
          });
        }
      }
      const result = await tool.handler(args);
      return rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(result ?? {}, null, 2) }],
      });
    } catch (error) {
      const payload = userErrorPayload({
        error,
        toolName: params?.name,
        args: params?.arguments || {},
      });
      return rpcResult(id, {
        isError: true,
        content: [{
          type: "text",
          text: JSON.stringify(payload, null, 2),
        }],
      });
    }
  }

  if (id === undefined || id === null) return null;
  return rpcError(id, `Unsupported method: ${method}`, -32601);
}
