# Personal Dashboard

One calm page that brings together Notion (projects, tasks, travel, life areas), Todoist (recurring/one-off doing), and Google Calendar (Tom + Sriya). Two-way syncs Notion tasks ↔ Todoist tasks so they stay in lockstep.

The plan and architecture decisions live in [`/Users/tombrosens/.claude/plans/i-want-to-build-snuggly-backus.md`](../../.claude/plans/i-want-to-build-snuggly-backus.md). Read that first.

## Stack

- **Next.js 16** App Router · TypeScript · Tailwind v4 · Geist
- **Neon Postgres** + **Drizzle ORM** (synced cache of all three sources)
- **Auth.js v5** with Google + email allowlist
- **Signed webhook routes** for fan-in
- `@notionhq/client` · `@doist/todoist-api-typescript` (v1) · `googleapis`

## What's done (M0–M6)

- Project scaffold, Drizzle schema, Auth.js with Google + email allowlist.
- Notion sync (To-Dos + Categories) → Postgres (full + incremental page upserts for webhooks).
- Google Calendar sync (Tom + Sriya, 14-day rolling window) → Postgres; optional **incremental sync** via stored `syncToken`, **push watches** + `/api/webhooks/gcal`, and **self-healing watch renewal** from webhook/manual sync traffic (no cron required).
- Todoist sync (tasks + projects) → Postgres (full + targeted task upserts for webhooks).
- Linking model: `task_links` and `category_project_links` tables, plus a heuristic title-match backfill.
- **M3 — Orchestrator:** link-aware mirroring (`lib/sync/orchestrator.ts`), `audit_log`, recurring Todoist instance repair when links bump to a new task id.
- **M4 — Writes:** dashboard task checkbox calls Notion + Todoist APIs and updates `task_links` / local cache (`applyDashboardToggle`).
- **M6:** webhook payload size limits + structured `audit_log`; installable PWA manifest (`src/app/manifest.ts` + `public/icon.svg`); backups documented below.

## Backups (Neon + optional `pg_dump`)

- **Neon:** use the Neon console to enable **point-in-time recovery** (plan-dependent) and use **branches** for ad-hoc snapshots before risky changes.
- **Self-managed dumps:** from a trusted machine with network access to Postgres, run `pg_dump "$DATABASE_URL" > backup.sql` on a schedule; keep the file outside the repo and rotate credentials if a dump leaks.

## Setup (do this once)

### 1. Credentials you need to create

| What | Where | What to grab |
|---|---|---|
| Postgres | [neon.tech](https://neon.tech) → new project | Pooled connection string → `DATABASE_URL` |
| Google OAuth | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client ID (Web app). Authorized redirect: `http://localhost:3000/api/auth/callback/google` (and the Vercel domain). Add scopes `calendar.readonly`. | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Notion integration | [notion.so/my-integrations](https://www.notion.so/my-integrations) → New internal integration. Then **share the Tasks page (or the parent "T&S Personal Home") with the integration** so it can read the To-Dos and Categories collections. | `NOTION_TOKEN` |
| Todoist | Todoist Settings → Integrations → Developer → "Copy API token" | `TODOIST_TOKEN` |
| Auth secret | `openssl rand -base64 32` | `AUTH_SECRET` |

### 2. Configure environment

```bash
cp .env.example .env.local
# fill in the values from step 1
```

Defaults already set in `.env.example`:
- `NOTION_TODOS_DATA_SOURCE_ID` = `e1123787-…` (the To-Dos collection)
- `NOTION_CATEGORIES_DATA_SOURCE_ID` = `69b5b17a-…` (the Categories collection)
- `GCAL_CALENDAR_IDS` = `thomas.brosens@gmail.com,sriya.sundaresan@gmail.com`
- `ALLOWED_EMAIL` = `thomas.brosens@gmail.com`

### 3. Run migrations + start dev

```bash
npm install
npx drizzle-kit push     # creates tables on Neon
npm run dev              # starts on http://localhost:3000
```

Sign in with Google, then click **"Run sync now"** on the empty-state screen (or `curl -X POST http://localhost:3000/api/sync/run` from the terminal — but you must be signed in for it to work, so the button is easier).

### 4. Deploy to Vercel

```bash
vercel link
vercel env add DATABASE_URL production
# …repeat for every entry in .env.example
vercel --prod
```

## Webhooks (do these once Vercel is live, optional for local dev)

- **Notion:** [my-integrations → your integration → Webhooks](https://www.notion.so/my-integrations) → add subscription pointing at `https://<your-domain>/api/webhooks/notion`. Notion will POST a `verification_token` on first ping; the route echoes it. Copy the secret it shows into `NOTION_WEBHOOK_SECRET`.
- **Todoist:** [Todoist App Console](https://developer.todoist.com/appconsole.html) → your app → Webhooks → URL `https://<your-domain>/api/webhooks/todoist`, events `item:*` and `project:*`. Copy the secret into `TODOIST_WEBHOOK_SECRET`.
- **Google Calendar push:** watches call `https://<your-domain>/api/webhooks/gcal`. Channel renewal is automatic/self-healing during webhook and manual sync activity. Requires `GOOGLE_REFRESH_TOKEN` (and `APP_URL` / `VERCEL_URL` for the watch address).

Without webhooks, use **Run sync now** on the dashboard (or a signed-in `POST` to `/api/sync/run`) periodically to refresh the cache.

After changing the Drizzle schema (e.g. new `sync_state.resource_id` column), run `npx drizzle-kit push` against your database.

## Mac app

`desktop/` wraps the **deployed** dashboard in a native window — it runs no server
of its own, so the Vercel deployment stays the single source of truth.

### Why the app doesn't use Google sign-in

Google refuses OAuth inside an embedded browser and detects Electron regardless of
how the user agent and `Sec-CH-UA` client hints are shaped — spoofing both still
gets "This browser or app may not be secure". Rather than fight that, the desktop
app authenticates with its own shared secret via a `desktop` credentials provider
in `src/lib/auth.ts`, and gets an ordinary Auth.js session in return.

This costs nothing in capability: the session is only an access gate. Calendar
reads run off `GOOGLE_REFRESH_TOKEN` server-side, because the session's Google
access token expires about an hour into a 30-day session (see the comment in
`src/app/api/sync/gcal/route.ts`). Browser sign-in is unchanged — Google still
works there.

**Setup — one shared secret, in two places:**

```bash
openssl rand -hex 32
```

1. Server: set `DESKTOP_TOKEN` to that value in `.env.local` **and** in Vercel
   (`vercel env add DESKTOP_TOKEN production`), then redeploy. Without it on the
   server, the provider refuses every token and the app falls back to the
   (Google-blocked) sign-in screen.
2. App: put the same value in `desktopToken` in
   `~/Library/Application Support/Personal Dashboard/config.json`.

Rotate by changing both and restarting the app.

```bash
npm run mac
```

That produces `desktop/dist/mac-arm64/Personal Dashboard.app` (plus a `.dmg`).
Drag the app into `/Applications`:

```bash
cp -R "desktop/dist/mac-arm64/Personal Dashboard.app" /Applications/
```

Behaviour worth knowing:

- **It signs itself in.** No sign-in screen ever appears; it opens on the dashboard.
- **Closing the window doesn't quit** — the app stays in the Dock, ready to click. Cmd+Q really quits.
- It **reloads if the page has been idle for 10+ minutes** or after the Mac wakes, so you never look at stale data.
- Window size and position are remembered; external links open in your real browser.
- Cmd+Shift+H returns to the dashboard, Cmd+R reloads.

It points at `APP_URL` by default. To aim it elsewhere, either set
`DASHBOARD_URL=http://localhost:3000 npm run mac:dev`, or edit `url` in
`~/Library/Application Support/Personal Dashboard/config.json`.

The build is unsigned (ad-hoc). Because you build it locally it isn't quarantined,
so it opens with no Gatekeeper prompt — but the `.dmg` will warn if you send it to
another machine. Rebuild after deploying UI changes only if you changed the icon;
otherwise the app picks up new deploys on its next reload.

## Repo layout

```
src/
  app/
    page.tsx                 — dashboard (RSC)
    actions.ts               — server actions for quick-add + toggle-done
    sign-in/page.tsx
    _panels/                 — TodayCalendar, TaskList, FooterStrip, QuickAdd, Clock
    api/
      auth/[...nextauth]/    — Auth.js handlers
      sync/run/              — manual full-sync trigger
      webhooks/{notion,todoist,gcal}/ — HMAC-verified (Notion/Todoist); GCal push uses Google headers
  lib/
    auth.ts                  — Auth.js config + allowlist
    db/{index,schema}.ts     — Drizzle
    sync/
      notion.ts              — pulls To-Dos + Categories
      todoist.ts             — pulls tasks + projects
      gcal.ts                — Calendar window + incremental + watch helpers + watch health
      orchestrator.ts        — link mirroring, recurring repair, dashboard toggle
      audit.ts               — append-only audit_log writer
      mappings.ts            — Notion ↔ Todoist field translation (single source of truth)
      link-backfill.ts       — heuristic title-match linker
    dashboard-data.ts        — server-side data composition for the page
    utils.ts                 — cn(), date helpers
  proxy.ts                   — auth gate (was middleware.ts; renamed for Next 16)
desktop/
  main.js                    — Electron shell around the deployed app
  offline.html               — shown when the dashboard is unreachable
  scripts/make-icon.sh       — src/app/icon.svg → build/icon.icns
```
