// Vercel function serving the MCP endpoint at /mcp/<MCP_SECRET>
// (rewritten to /api/mcp?secret=... by vercel.json).

import { timingSafeEqual } from "node:crypto";
import { handleMessage } from "../lib/mcp.js";

function secretMatches(given) {
  const expected = process.env.MCP_SECRET;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (!secretMatches(req.query.secret)) {
    res.status(404).send("Not found");
    return;
  }

  if (req.method !== "POST") {
    // No server-initiated SSE stream and no sessions to delete.
    res.setHeader("Allow", "POST");
    res.status(405).send("Method not allowed");
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      return;
    }
  }

  const batch = Array.isArray(body);
  const responses = (await Promise.all((batch ? body : [body]).map(handleMessage))).filter(Boolean);

  if (responses.length === 0) {
    res.status(202).end();
    return;
  }
  res.status(200).json(batch ? responses : responses[0]);
}
