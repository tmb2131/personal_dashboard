import { google, type calendar_v3 } from "googleapis";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db, schema } from "@/lib/db";
import { parseDateOnlyLocal } from "@/lib/date-utils";
import { logAudit } from "@/lib/sync/audit";

export type AccessTokenSource = () => Promise<string | undefined>;
const WATCH_RENEW_MARGIN_MS = 48 * 60 * 60 * 1000;
const WATCH_ENSURE_LEASE_MS = 30 * 1000;
let watchEnsureLeaseUntil = 0;

function calendarIds(): string[] {
  return (process.env.GCAL_CALENDAR_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function gcalSyncSourceKey(calendarId: string) {
  return `gcal:${calendarId}`;
}

function calendarClientFromAccessToken(accessToken: string): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

export function getCalendarClientFromAccessToken(accessToken: string): calendar_v3.Calendar {
  return calendarClientFromAccessToken(accessToken);
}

/** OAuth2 client using long-lived refresh token (cron + watch without user session). */
export function getOAuth2WithRefreshToken() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

export async function getCalendarClientFromRefresh(): Promise<calendar_v3.Calendar | null> {
  const auth = getOAuth2WithRefreshToken();
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}

function isRefreshCredentialError(err: unknown) {
  const e = err as {
    code?: number;
    message?: string;
    response?: { data?: { error?: string; error_description?: string } };
  };
  const apiErr = e.response?.data?.error;
  return (
    e.code === 401 ||
    apiErr === "invalid_grant" ||
    apiErr === "invalid_client" ||
    e.message?.toLowerCase().includes("invalid_grant") === true
  );
}

function windowRange(now: Date) {
  const timeMin = new Date(now);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 14);
  timeMax.setHours(23, 59, 59, 999);
  return { timeMin, timeMax };
}

function parseAllDayDateLocal(value: string): Date | null {
  return parseDateOnlyLocal(value);
}

function eventToRow(
  calendarId: string,
  e: calendar_v3.Schema$Event,
  now: Date,
):
  | {
      id: string;
      calendarId: string;
      eventId: string;
      summary: string | null;
      location: string | null;
      start: Date | null;
      end: Date | null;
      allDay: boolean;
      attendees: unknown[];
      status: string | null;
      htmlLink: string | null;
      raw: unknown;
      updatedAt: Date;
    }
  | null {
  if (!e.id || (!e.start?.dateTime && !e.start?.date)) return null;
  const allDay = !e.start?.dateTime;
  const start = e.start?.dateTime
    ? new Date(e.start.dateTime)
    : e.start?.date
      ? parseAllDayDateLocal(e.start.date)
      : null;
  const end = e.end?.dateTime
    ? new Date(e.end.dateTime)
    : e.end?.date
      ? parseAllDayDateLocal(e.end.date)
      : null;
  return {
    id: `${calendarId}::${e.id}`,
    calendarId,
    eventId: e.id,
    summary: e.summary ?? null,
    location: e.location ?? null,
    start,
    end,
    allDay,
    attendees: (e.attendees ?? []) as unknown[],
    status: e.status ?? null,
    htmlLink: e.htmlLink ?? null,
    raw: e as unknown,
    updatedAt: now,
  };
}

async function upsertEventRows(
  rows: NonNullable<ReturnType<typeof eventToRow>>[],
) {
  if (!rows.length) return;
  await db
    .insert(schema.gcalEvents)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.gcalEvents.id,
      set: {
        summary: sql`excluded.summary`,
        location: sql`excluded.location`,
        start: sql`excluded.start`,
        end: sql`excluded.end`,
        allDay: sql`excluded.all_day`,
        attendees: sql`excluded.attendees`,
        status: sql`excluded.status`,
        htmlLink: sql`excluded.html_link`,
        raw: sql`excluded.raw`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

async function persistNextSyncToken(sourceKey: string, nextSyncToken: string | null | undefined) {
  if (!nextSyncToken) return;
  const now = new Date();
  await db
    .insert(schema.syncState)
    .values({
      source: sourceKey,
      cursor: nextSyncToken,
      lastIncrementalAt: now,
    })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { cursor: nextSyncToken, lastIncrementalAt: now },
    });
}

/** Full window sync + capture `nextSyncToken` for incremental updates. */
async function syncCalendarWindow(
  cal: calendar_v3.Calendar,
  calendarId: string,
  now: Date,
) {
  const { timeMin, timeMax } = windowRange(now);
  const sourceKey = gcalSyncSourceKey(calendarId);
  let pageToken: string | undefined;
  let total = 0;
  let lastNextSyncToken: string | null | undefined;

  do {
    const resp = await cal.events.list({
      calendarId,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 250,
      pageToken,
    });
    if (resp.data.items?.length) {
      const rows = resp.data.items
        .map((e) => eventToRow(calendarId, e, now))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      await upsertEventRows(rows);
      total += rows.length;
    }
    lastNextSyncToken = resp.data.nextSyncToken;
    pageToken = resp.data.nextPageToken ?? undefined;
  } while (pageToken);

  if (lastNextSyncToken) await persistNextSyncToken(sourceKey, lastNextSyncToken);

  await db
    .insert(schema.syncState)
    .values({
      source: sourceKey,
      lastFullSyncAt: now,
    })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: { lastFullSyncAt: now },
    });

  return total;
}

function isSyncTokenGone(err: unknown) {
  const e = err as { code?: number; errors?: { reason?: string }[] };
  return e?.code === 410 || e?.errors?.some((x) => x.reason === "syncTokenInvalid" || x.reason === "required");
}

async function deleteEventRow(calendarId: string, eventId: string) {
  const id = `${calendarId}::${eventId}`;
  await db.delete(schema.gcalEvents).where(eq(schema.gcalEvents.id, id));
}

/**
 * Incremental sync using stored sync token; falls back to window sync on 410.
 */
export async function syncGcalIncrementalForCalendar(
  cal: calendar_v3.Calendar,
  calendarId: string,
  now = new Date(),
) {
  const sourceKey = gcalSyncSourceKey(calendarId);
  const [row] = await db
    .select()
    .from(schema.syncState)
    .where(eq(schema.syncState.source, sourceKey));
  const syncToken = row?.cursor;

  if (!syncToken) {
    const n = await syncCalendarWindow(cal, calendarId, now);
    return { mode: "full" as const, upserted: n };
  }

  try {
    let pageToken: string | undefined;
    let upserted = 0;
    let lastToken: string | null | undefined;
    let first = true;
    do {
      const resp = await cal.events.list({
        calendarId,
        ...(first ? { syncToken } : {}),
        singleEvents: true,
        maxResults: 250,
        pageToken,
      });
      first = false;
      const items = resp.data.items ?? [];
      for (const e of items) {
        if (!e.id) continue;
        if (e.status === "cancelled") {
          await deleteEventRow(calendarId, e.id);
        } else {
          const r = eventToRow(calendarId, e, now);
          if (r) {
            await upsertEventRows([r]);
            upserted++;
          }
        }
      }
      lastToken = resp.data.nextSyncToken;
      pageToken = resp.data.nextPageToken ?? undefined;
    } while (pageToken);

    if (lastToken) await persistNextSyncToken(sourceKey, lastToken);

    await db
      .insert(schema.syncState)
      .values({ source: sourceKey, lastIncrementalAt: now })
      .onConflictDoUpdate({
        target: schema.syncState.source,
        set: { lastIncrementalAt: now },
      });

    return { mode: "incremental" as const, upserted };
  } catch (e) {
    if (isRefreshCredentialError(e)) {
      await logAudit({
        source: "gcal",
        op: "incremental_auth_error",
        payload: { calendarId },
        error: (e as Error).message,
      });
      throw e;
    }
    if (!isSyncTokenGone(e)) throw e;
    await db
      .update(schema.syncState)
      .set({ cursor: null })
      .where(eq(schema.syncState.source, sourceKey));
    const n = await syncCalendarWindow(cal, calendarId, now);
    await logAudit({
      source: "gcal",
      op: "sync_token_reset",
      payload: { calendarId },
    });
    return { mode: "full_after_410" as const, upserted: n };
  }
}

export async function syncGcalIncrementalAll(
  cal: calendar_v3.Calendar,
  now = new Date(),
) {
  const calendars = calendarIds();
  const results = await Promise.all(
    calendars.map(async (calendarId) => ({
      calendarId,
      ...(await syncGcalIncrementalForCalendar(cal, calendarId, now)),
    })),
  );
  const changedCalendars = results.filter((r) => r.upserted > 0).map((r) => r.calendarId);
  return {
    calendars: calendars.length,
    changed: changedCalendars.length > 0,
    changedCalendars,
    results,
  };
}

export async function syncGcal(getAccessToken: AccessTokenSource) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error("No Google access token available");
  const cal = calendarClientFromAccessToken(accessToken);

  const now = new Date();
  let total = 0;
  for (const calendarId of calendarIds()) {
    total += await syncCalendarWindow(cal, calendarId, now);
  }

  return { events: total, calendars: calendarIds().length };
}

/** Register push notifications for one calendar (watch channel). */
export async function registerGcalWatch(cal: calendar_v3.Calendar, calendarId: string) {
  const baseUrl = process.env.APP_URL ?? process.env.VERCEL_URL;
  if (!baseUrl) throw new Error("APP_URL or VERCEL_URL required for calendar watch");
  const address = baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`;
  const channelId = crypto.randomUUID();
  const resp = await cal.events.watch({
    calendarId,
    requestBody: {
      id: channelId,
      type: "web_hook",
      address: `${address.replace(/\/$/u, "")}/api/webhooks/gcal`,
    },
  });

  const d = resp.data;
  const expMs = d.expiration ? Number(d.expiration) : 0;
  const sourceKey = gcalSyncSourceKey(calendarId);
  const expires = expMs ? new Date(expMs) : null;

  await db
    .insert(schema.syncState)
    .values({
      source: sourceKey,
      channelId: d.id ?? channelId,
      resourceId: d.resourceId ?? null,
      channelExpiresAt: expires,
    })
    .onConflictDoUpdate({
      target: schema.syncState.source,
      set: {
        channelId: d.id ?? channelId,
        resourceId: d.resourceId ?? null,
        channelExpiresAt: expires,
      },
    });

  await logAudit({
    source: "gcal",
    op: "watch_registered",
    payload: { calendarId, channelId: d.id, expires: expires?.toISOString() },
  });

  return { channelId: d.id, resourceId: d.resourceId, expiration: expires };
}

/** Stop an existing watch channel before replacing it. */
export async function stopGcalWatch(cal: calendar_v3.Calendar, channelId: string, resourceId: string) {
  await cal.channels.stop({
    requestBody: { id: channelId, resourceId },
  });
}

export async function renewGcalWatchesIfNeeded() {
  return ensureGcalWatchesHealthy();
}

export async function ensureGcalWatchesHealthy() {
  const nowMs = Date.now();
  if (watchEnsureLeaseUntil > nowMs) {
    return { renewed: 0, skipped: calendarIds().length, skippedByLease: true };
  }
  watchEnsureLeaseUntil = nowMs + WATCH_ENSURE_LEASE_MS;
  try {
    const cal = await getCalendarClientFromRefresh();
    if (!cal) {
      await logAudit({ source: "gcal", op: "watch_health_skip", error: "no oauth refresh" });
      return { renewed: 0, skipped: calendarIds().length, skippedByLease: false };
    }

    const soon = Date.now() + WATCH_RENEW_MARGIN_MS;
    let renewed = 0;

    for (const calendarId of calendarIds()) {
      const sourceKey = gcalSyncSourceKey(calendarId);
      const [row] = await db
        .select()
        .from(schema.syncState)
        .where(eq(schema.syncState.source, sourceKey));
      const exp = row?.channelExpiresAt?.getTime() ?? 0;
      if (exp > soon && row?.channelId && row?.resourceId) {
        continue;
      }

      if (row?.channelId && row?.resourceId) {
        try {
          await stopGcalWatch(cal, row.channelId, row.resourceId);
        } catch {
          /* channel may already be gone */
        }
      }

      await registerGcalWatch(cal, calendarId);
      renewed++;
    }

    return { renewed, skipped: calendarIds().length - renewed, skippedByLease: false };
  } catch (e) {
    if (isRefreshCredentialError(e)) {
      await logAudit({
        source: "gcal",
        op: "watch_health_auth_error",
        error: (e as Error).message,
      });
    }
    throw e;
  } finally {
    watchEnsureLeaseUntil = 0;
  }
}
