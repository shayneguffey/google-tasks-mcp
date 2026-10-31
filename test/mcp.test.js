import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { handleMessage } from "../lib/mcp.js";
import { _resetTokenCache } from "../lib/google.js";
import handler from "../api/mcp.js";

process.env.GOOGLE_CLIENT_ID = "cid";
process.env.GOOGLE_CLIENT_SECRET = "csecret";
process.env.GOOGLE_REFRESH_TOKEN = "rtoken";
process.env.MCP_SECRET = "s3cret";

let calls;
function mockFetch(routes) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push({ url: u, method: opts.method || "GET", body: opts.body });
    if (u.host === "oauth2.googleapis.com") {
      return Response.json({ access_token: "atoken", expires_in: 3600 });
    }
    const key = `${opts.method || "GET"} ${u.pathname}`;
    const r = routes[key];
    if (!r) return Response.json({ error: { message: `no mock for ${key}` } }, { status: 404 });
    return r === 204 ? new Response(null, { status: 204 }) : Response.json(r);
  };
}

const call = (name, args) =>
  handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

beforeEach(() => _resetTokenCache());

test("initialize negotiates protocol version", async () => {
  const r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.ok(r.result.capabilities.tools);
  const r2 = await handleMessage({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(r2.result.protocolVersion, "2025-11-25");
});

test("notifications get no response", async () => {
  assert.equal(await handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("tools/list exposes all tools with annotations", async () => {
  const r = await handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ["list_task_lists", "list_tasks", "create_task", "update_task", "complete_task", "delete_task"]);
  assert.equal(r.result.tools.find((t) => t.name === "delete_task").annotations.destructiveHint, true);
});

test("list_tasks maps filters and slims output", async () => {
  mockFetch({
    "GET /tasks/v1/lists/%40default/tasks": {
      items: [{ id: "t1", title: "Buy milk", status: "needsAction", due: "2026-11-02T00:00:00.000Z", etag: "x", kind: "tasks#task" }],
    },
  });
  const r = await call("list_tasks", { due_before: "2026-11-30" });
  assert.deepEqual(r.result.structuredContent.tasks[0], {
    id: "t1", title: "Buy milk", status: "needsAction", due: "2026-11-02",
    notes: undefined, parent: undefined, completed: undefined, updated: undefined, links: undefined, webViewLink: undefined,
  });
  const q = calls[1].url.searchParams;
  assert.equal(q.get("dueMax"), "2026-11-30T00:00:00.000Z");
  assert.equal(q.get("showCompleted"), "false");
  assert.equal(calls[0].url.host, "oauth2.googleapis.com");
});

test("create_task sends due date in RFC 3339", async () => {
  mockFetch({ "POST /tasks/v1/lists/%40default/tasks": { id: "t2", title: "Call mom", status: "needsAction" } });
  const r = await call("create_task", { title: "Call mom", due: "2026-11-05" });
  assert.equal(r.result.structuredContent.task.id, "t2");
  assert.deepEqual(JSON.parse(calls[1].body), { title: "Call mom", due: "2026-11-05T00:00:00.000Z" });
});

test("update_task reopening clears completed", async () => {
  mockFetch({ "PATCH /tasks/v1/lists/%40default/tasks/t1": { id: "t1", status: "needsAction" } });
  await call("update_task", { task_id: "t1", status: "needsAction", notes: "" });
  assert.deepEqual(JSON.parse(calls[1].body), { status: "needsAction", completed: null, notes: null });
});

test("delete_task handles 204", async () => {
  mockFetch({ "DELETE /tasks/v1/lists/L1/tasks/t1": 204 });
  const r = await call("delete_task", { task_id: "t1", tasklist_id: "L1" });
  assert.deepEqual(r.result.structuredContent, { deleted: "t1" });
});

test("API errors come back as tool errors", async () => {
  mockFetch({});
  const r = await call("complete_task", { task_id: "nope" });
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /404/);
});

test("bad due date is a tool error", async () => {
  mockFetch({});
  const r = await call("create_task", { title: "x", due: "next tuesday" });
  assert.equal(r.result.isError, true);
});

function fakeRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (c) => ((res.statusCode = c), res);
  res.setHeader = (k, v) => (res.headers[k] = v);
  res.send = (b) => ((res.body = b), res);
  res.json = (b) => ((res.body = b), res);
  res.end = () => res;
  return res;
}

test("HTTP handler rejects wrong secret with 404", async () => {
  const res = fakeRes();
  await handler({ method: "POST", query: { secret: "wrong" }, body: {} }, res);
  assert.equal(res.statusCode, 404);
});

test("HTTP handler: GET is 405, notification is 202, request is 200", async () => {
  let res = fakeRes();
  await handler({ method: "GET", query: { secret: "s3cret" } }, res);
  assert.equal(res.statusCode, 405);

  res = fakeRes();
  await handler({ method: "POST", query: { secret: "s3cret" }, body: { jsonrpc: "2.0", method: "notifications/initialized" } }, res);
  assert.equal(res.statusCode, 202);

  res = fakeRes();
  await handler({ method: "POST", query: { secret: "s3cret" }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { jsonrpc: "2.0", id: 7, result: {} });
});
