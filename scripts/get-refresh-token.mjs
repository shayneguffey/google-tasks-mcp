// One-time helper: run on your own computer to get a Google refresh token
// for the Tasks API.
//
//   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/get-refresh-token.mjs
//
// Uses a "Desktop app" OAuth client and the loopback redirect flow.

import http from "node:http";
import { randomBytes } from "node:crypto";

const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret } = process.env;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  const done = (msg) => {
    res.writeHead(200, { "Content-Type": "text/plain" }).end(msg);
    server.close();
  };
  if (url.searchParams.get("state") !== state) return done("State mismatch, try again.");
  if (url.searchParams.get("error")) return done(`Google returned: ${url.searchParams.get("error")}`);

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code: url.searchParams.get("code"),
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    console.error("No refresh token in response:", tokens);
    return done("Failed - see terminal.");
  }
  console.log("\nGOOGLE_REFRESH_TOKEN=" + tokens.refresh_token + "\n");
  console.log("Add this to your Vercel project's environment variables. Keep it secret.");
  done("Done! Return to the terminal for your refresh token.");
});

let redirectUri;
server.listen(0, "127.0.0.1", () => {
  redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/tasks",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  console.log("Open this URL in your browser and approve access:\n\n" + auth + "\n");
});
