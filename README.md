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

### 1. Google Cloud (≈10 min, all in the browser)

Google renames these screens from time to time, so labels may differ slightly.

1. Create a project: <https://console.cloud.google.com/projectcreate> → name it
   `Claude Tasks` → **Create**. Make sure it's selected in the project picker at the top.
2. Enable the API: <https://console.cloud.google.com/apis/library/tasks.googleapis.com> → **Enable**.
3. Set up the consent screen: <https://console.cloud.google.com/auth/overview> → **Get started** →
   app name `Claude Tasks`, your email as support email → Audience **External** →
   your email as contact → agree → **Create**.
4. **Publish the app:** <https://console.cloud.google.com/auth/audience> → **Publish app** → **Confirm**.
   *Don't skip this:* while the app is in "Testing", Google expires refresh tokens after 7 days.
   Publishing doesn't need verification for personal use — you'll just click through an
   "unverified app" warning.
5. Create a client: <https://console.cloud.google.com/auth/clients> → **Create client** →
   type **Web application** → under **Authorized redirect URIs** add
   `https://developers.google.com/oauthplayground` → **Create**.
   Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and **Client secret**
   (starts with `GOCSPX-`). These are `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### 2. Get your refresh token (OAuth Playground)

1. Open <https://developers.google.com/oauthplayground>.
2. Click the **gear ⚙️** (top right) → check **Use your own OAuth credentials** → paste the
   Client ID and Client secret. Make sure **Access type** is **Offline**.
3. In **Step 1** on the left, type `https://www.googleapis.com/auth/tasks` into
   **Input your own scopes** → **Authorize APIs**.
4. Pick your Google account. On "Google hasn't verified this app" click
   **Advanced → Go to Claude Tasks (unsafe) → Continue**.
5. Back in the Playground, in **Step 2** click **Exchange authorization code for tokens**.
   The page jumps to Step 3 — click the **Step 2** heading to reopen it and copy the
   **Refresh token** (starts with `1//`). This is `GOOGLE_REFRESH_TOKEN`.

Troubleshooting:

- **"Access blocked: Authorization Error … The OAuth client was not found" (401 invalid_client):**
  the Client ID is mistyped or swapped with the secret, or the client was just created —
  wait ~10 minutes and try again.
- **Refresh token box is empty:** you haven't exchanged the code yet, or the exchange failed —
  read the response panel on the right. Authorization codes are single-use and expire in
  minutes; on `invalid_grant`, click **Authorize APIs** again and exchange immediately.

<details>
<summary>Alternative: terminal script instead of the Playground</summary>

Create a **Desktop app** client (instead of Web application) in step 1.5, then on your own
computer run:

```bash
GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy npm run get-token
```

Open the printed URL, approve access, and copy the `GOOGLE_REFRESH_TOKEN=...` line.
</details>

### 3. Deploy to Vercel

1. Import this repo in Vercel (Framework preset: **Other**, no build command).
2. Add environment variables (Production):
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `MCP_SECRET` — a long random string of letters and numbers (40+ characters),
     e.g. from a password generator or `openssl rand -hex 32`
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
- **Connector suddenly stops working:** the refresh token was likely revoked or expired. Check the app is
  still "In production" (step 1.4), get a new token (step 2), update `GOOGLE_REFRESH_TOKEN` in Vercel, and redeploy.
