import { google, type calendar_v3 } from "googleapis";
import { db, schema } from "@/lib/db";
import { sql } from "drizzle-orm";

export type AccessTokenSource = () => Promise<string | undefined>;

function calendarClient(accessToken: string): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

function calendarIds(): string[] {
  return (process.env.GCAL_CALENDAR_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function syncGcal(getAccessToken: AccessTokenSource) {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error("No Google access token available");
  const cal = calendarClient(accessToken);

  const now = new Date();
  const timeMin = new Date(now);
  timeMin.setHours(0, 0, 0, 0);
  const timeMax = new Date(now);
  timeMax.setDate(timeMax.getDate() + 14);
  timeMax.setHours(23, 59, 59, 999);

  let total = 0;
  for (const calendarId of calendarIds()) {
    const events: calendar_v3.Schema$Event[] = [];
    let pageToken: string | undefined;
    do {
      const resp: { data: calendar_v3.Schema$Events } = await cal.events.list({
        calendarId,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 250,
        pageToken,
      });
      if (resp.data.items) events.push(...resp.data.items);
      pageToken = resp.data.nextPageToken ?? undefined;
    } while (pageToken);

    if (!events.length) continue;

    const rows = events
      .filter((e) => e.id && (e.start?.dateTime || e.start?.date))
      .map((e) => {
        const allDay = !e.start?.dateTime;
        const start = e.start?.dateTime
          ? new Date(e.start.dateTime)
          : e.start?.date
          ? new Date(e.start.date)
          : null;
        const end = e.end?.dateTime
          ? new Date(e.end.dateTime)
          : e.end?.date
          ? new Date(e.end.date)
          : null;
        return {
          id: `${calendarId}::${e.id}`,
          calendarId,
          eventId: e.id!,
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
      });

    if (rows.length) {
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
      total += rows.length;
    }
  }

  return { events: total, calendars: calendarIds().length };
}
