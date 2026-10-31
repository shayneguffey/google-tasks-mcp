// Stateless MCP (Model Context Protocol) JSON-RPC handler. Implements just
// enough of the Streamable HTTP transport for a tools-only server: every
// request gets a single JSON response, no sessions or SSE streams.

import { tools } from "./tools.js";

const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "google-tasks", title: "Google Tasks", version: "1.0.0" };

const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

// Returns a JSON-RPC response object, or null for notifications.
export async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return fail(msg?.id ?? null, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined || msg.id === null;
  if (isNotification) return null;

  const { id, method, params = {} } = msg;
  switch (method) {
    case "initialize": {
      const requested = params.protocolVersion;
      return ok(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Tools for the user's Google Tasks. Call list_task_lists to find list IDs; most tools default to the primary list.",
      });
    }
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
          name, title, description, inputSchema, annotations,
        })),
      });
    case "tools/call": {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const result = await tool.run(params.arguments || {});
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        });
      } catch (err) {
        // Tool failures are reported in-band so the model can see and react to them.
        return ok(id, { content: [{ type: "text", text: String(err.message || err) }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}
