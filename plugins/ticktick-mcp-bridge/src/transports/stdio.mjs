import { fileURLToPath } from "node:url";
import { handleRpc, SERVER_INFO } from "../mcp-handler.mjs";

function writeMessage(stream, message) {
  if (!message) return;
  const body = Buffer.from(JSON.stringify(message), "utf8");
  stream.write(`Content-Length: ${body.length}\r\n\r\n`);
  stream.write(body);
}

function extractMessages(state) {
  const messages = [];

  while (true) {
    const headerEnd = state.buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;

    const header = state.buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      state.buffer = state.buffer.slice(headerEnd + 4);
      continue;
    }

    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (state.buffer.length < bodyEnd) break;

    const body = state.buffer.slice(bodyStart, bodyEnd).toString("utf8");
    state.buffer = state.buffer.slice(bodyEnd);
    messages.push(JSON.parse(body));
  }

  return messages;
}

export function startStdioServer({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const state = { buffer: Buffer.alloc(0) };

  stderr.write(`${SERVER_INFO.name} stdio MCP transport started\n`);

  stdin.on("data", async (chunk) => {
    state.buffer = Buffer.concat([state.buffer, chunk]);
    for (const message of extractMessages(state)) {
      try {
        const response = await handleRpc(message);
        writeMessage(stdout, response);
      } catch (error) {
        writeMessage(stdout, {
          jsonrpc: "2.0",
          id: message?.id ?? null,
          error: {
            code: -32000,
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  });

  stdin.resume();
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startStdioServer();
}
