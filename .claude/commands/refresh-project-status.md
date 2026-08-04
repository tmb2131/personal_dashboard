---
description: Write a one-line status / next step onto Notion projects that don't have one
argument-hint: "[category name] (omit for all categories)"
allowed-tools: mcp__3322d2d4-f4b6-46fa-be60-abfca156520c__notion-query-data-sources, mcp__3322d2d4-f4b6-46fa-be60-abfca156520c__notion-fetch, mcp__3322d2d4-f4b6-46fa-be60-abfca156520c__notion-update-page
---

Fill in the `Key Next Step` property on Notion project rows so the dashboard's
Categories and Projects views show where each project stands.

Target category: **$1** (if blank, do every category except `Travel/Events`).

## Data sources

| | |
|---|---|
| To-Dos | `collection://e1123787-f0bd-4cbe-a6f8-73b5dfe67bd5` |
| Categories | `collection://69b5b17a-c16b-48d8-a19c-a1bd0e394424` |

Tasks, Projects, Travel and Focus are all views of the **single** To-Dos data
source. A row is a *project* when `Parent task` is empty, and a *sub-task* when
it points at another row. Nesting is capped at one level.

## Steps

1. Query the Categories source to resolve the requested category name to its id.
   Skip `Travel/Events` — it has its own Trips view and ~110 rows.

2. Query To-Dos for **project** rows in that category: `Parent task` empty,
   `Status` not `Done`, not archived. Select at least `Task name`, `Status`,
   `Focus`, `Key Next Step`, `Date`, `Deadline`.

3. **Only consider rows where `Key Next Step` is empty.** A non-empty value was
   either written by hand or by a previous run, and must be left alone. Overwrite
   an existing value only if the user explicitly asks for it in this session.

4. For each remaining project, query its sub-tasks (`Parent task` pointing at
   that project) with `Task name`, `Status`, `Date`, `Deadline` — the open ones
   and their dates are what make the line concrete.

5. Draft one line per project:
   - Under ~90 characters, and never more than 200 (the dashboard rejects longer).
   - Name the actual next action and, where it matters, what's blocking it —
     "Book UK passport appt — needs birth certificate first", not "Progress OCI".
   - Don't restate the project title, don't pad with "Currently…" or "Next:".
   - If a project has no open sub-tasks and nothing to go on, say what would
     unblock it (e.g. "Decide whether this is still worth doing") rather than
     inventing detail.

6. **Show the user the full list of project → proposed line and wait for
   confirmation before writing anything.** These are writes to a real Notion
   workspace. Let them edit or drop individual lines.

7. Write the approved lines with `notion-update-page`, one call per project,
   setting the `Key Next Step` rich_text property.

8. Report what was written and what was skipped (and why).

## Getting it back into the dashboard

The Notion webhook picks these up and `syncNotionEntitiesByIds` refreshes the
local cache, so open tabs update within ~30s. If a value doesn't appear, a signed-in
`POST /api/sync/run` forces a full pull.
