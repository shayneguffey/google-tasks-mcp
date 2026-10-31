# Google Tasks connector for Claude

A tiny remote [MCP](https://modelcontextprotocol.io) server that lets Claude
(claude.ai, the Claude apps, and Claude Duet) read and manage your Google Tasks.
No dependencies — plain Node on Vercel calling the Google Tasks REST API.

## Tools

| Tool | What it does |
|------|--------------|
| `list_task_lists` | All your task lists |
| `list_tasks` | Tasks in a list (open only by default; filter by due date) |
| `create_task` | New task, optional notes / due date / parent (subtask) |
| `update_task` | Change title, notes, due date, or status |
| `complete_task` | Mark done |
| `delete_task` | Permanently delete (flagged destructive, so Claude asks first) |

## How auth works

This is a **single-user** connector. You authorize Google once and store the
refresh token as a server secret. Claude reaches the server at
`https://<your-app>.vercel.app/mcp/<MCP_SECRET>`; any other path returns 404.
**Anyone with that full URL can read and edit your tasks — treat it like a password.**

## Setup

### 1. Google Cloud (≈5 min)

1. Go to <https://console.cloud.google.com/>, create a project (e.g. "Claude Tasks").
2. **APIs & Services → Library** → enable **Google Tasks API**.
3. **Google Auth Platform → Branding/Audience** (OAuth consent screen): User type **External**,
   fill in app name + your email. Under **Audience**, add yourself as a test user.
4. **Clients → Create client** → type **Desktop app**. Copy the client ID and secret.
5. **Audience → Publish app** ("In production"). *Important:* while the app is in
   "Testing", Google expires refresh tokens after 7 days. Publishing doesn't need
   verification for personal use — you'll just click through an "unverified app" warning.

### 2. Get your refresh token (on your own computer)

```bash
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run get-token
```

Open the printed URL, approve access, and copy the `GOOGLE_REFRESH_TOKEN=...` line
from the terminal.

### 3. Deploy to Vercel

1. Import this repo in Vercel (Framework preset: **Other**, no build command).
2. Add environment variables (Production):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `MCP_SECRET` — a long random string, e.g. `openssl rand -hex 32`
3. Deploy. Make sure **Deployment Protection** doesn't cover your production domain
   (the default "Standard Protection" only protects previews, which is fine).

Sanity check (should print `{"jsonrpc":"2.0","id":1,"result":{}}`):

```bash
curl -s -X POST https://<your-app>.vercel.app/mcp/<MCP_SECRET> \
  -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'
```

### 4. Add it to Claude

claude.ai → **Settings → Connectors → Add custom connector**:

- Name: `Google Tasks`
- URL: `https://<your-app>.vercel.app/mcp/<MCP_SECRET>`

Leave the OAuth fields blank. Claude Duet uses your claude.ai connectors
automatically, so it'll see your tasks right away. Try: *"What's on my task list this week?"*

## Development

```bash
npm test
```

Tests mock Google's APIs, so no credentials are needed.

## Rotating secrets

- **Leaked connector URL:** change `MCP_SECRET` in Vercel, redeploy, and update the connector URL in Claude.
- **Revoke Google access:** <https://myaccount.google.com/permissions> → remove the app, then rerun step 2.
