# Personal Dashboard

One calm page that brings together Notion (projects, tasks, travel, life areas), Todoist (recurring/one-off doing), and Google Calendar (Tom + Sriya). Two-way syncs Notion tasks ↔ Todoist tasks so they stay in lockstep.

The plan and architecture decisions live in [`/Users/tombrosens/.claude/plans/i-want-to-build-snuggly-backus.md`](../../.claude/plans/i-want-to-build-snuggly-backus.md). Read that first.

## Stack

- **Next.js 16** App Router · TypeScript · Tailwind v4 · Geist
- **Neon Postgres** + **Drizzle ORM** (synced cache of all three sources)
- **Auth.js v5** with Google + email allowlist
- **Signed webhook routes** for fan-in
- `@notionhq/client` · `@doist/todoist-api-typescript` (v1) · `googleapis`

## What's done (M0–M2 + M5 layout)

- Project scaffold, Drizzle schema, Auth.js with Google + email allowlist.
- Notion sync (To-Dos + Categories) → Postgres.
- Google Calendar sync (Tom + Sriya, 14-day window) → Postgres.
- Todoist sync (tasks + projects) → Postgres.
- Linking model: `task_links` and `category_project_links` tables, plus a heuristic title-match backfill.
- Dashboard read path: today's calendar, unified task list (Notion ⊕ Todoist deduped via links), active projects / upcoming travel / life areas footer, quick-add.

## What's next (M3–M6, deferred to follow-up sessions)

- M3 — sync orchestrator (real propagation rules, conflict resolution, recurring-task instance bumping, full webhook handling beyond the current "naive re-sync" stubs)
- M4 — write actions wired all the way through (the dashboard checkbox currently only updates the local cache; the next webhook tick syncs sources)
- M6 — hardening, PWA polish, backups

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
- **Google Calendar:** uses watch-channels; channel-renewal cron lands in M3.

Without webhooks, use **Run sync now** on the dashboard (or a signed-in `POST` to `/api/sync/run`) periodically to refresh the cache.

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
      webhooks/{notion,todoist}/ — HMAC-verified webhook receivers (M3 will deepen)
  lib/
    auth.ts                  — Auth.js config + allowlist
    db/{index,schema}.ts     — Drizzle
    sync/
      notion.ts              — pulls To-Dos + Categories
      todoist.ts             — pulls tasks + projects
      gcal.ts                — pulls events for configured calendars
      mappings.ts            — Notion ↔ Todoist field translation (single source of truth)
      link-backfill.ts       — heuristic title-match linker
    dashboard-data.ts        — server-side data composition for the page
    utils.ts                 — cn(), date helpers
  proxy.ts                   — auth gate (was middleware.ts; renamed for Next 16)
```
