const MEETING_HOST_PATTERNS = [
  /https?:\/\/meet\.google\.com\/[^\s<>"']+/i,
  /https?:\/\/[\w.-]*zoom\.us\/(?:j|my|s|w)\/[^\s<>"']+/i,
  /https?:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+/i,
  /https?:\/\/[\w.-]*webex\.com\/(?:meet|join|wbxmjs)\/[^\s<>"']+/i,
  /https?:\/\/[\w.-]*whereby\.com\/[^\s<>"']+/i,
];

function pickFromString(s: string | null | undefined): string | null {
  if (!s) return null;
  for (const re of MEETING_HOST_PATTERNS) {
    const m = s.match(re);
    if (m) return m[0];
  }
  return null;
}

function pickFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;

  if (typeof r.hangoutLink === "string" && r.hangoutLink.trim()) return r.hangoutLink.trim();

  const conf = r.conferenceData;
  if (conf && typeof conf === "object") {
    const entries = (conf as { entryPoints?: unknown[] }).entryPoints;
    if (Array.isArray(entries)) {
      for (const e of entries) {
        if (!e || typeof e !== "object") continue;
        const ep = e as { entryPointType?: unknown; uri?: unknown };
        if (ep.entryPointType === "video" && typeof ep.uri === "string" && ep.uri.trim()) {
          return ep.uri.trim();
        }
      }
    }
  }

  if (typeof r.description === "string") {
    const fromDesc = pickFromString(r.description);
    if (fromDesc) return fromDesc;
  }

  return null;
}

export type MeetingUrlSource = {
  raw?: unknown;
  location?: string | null;
  htmlLink?: string | null;
};

export function extractMeetingUrl(event: MeetingUrlSource): string | null {
  return pickFromRaw(event.raw) ?? pickFromString(event.location);
}

export function extractCalendarHtmlLink(event: { htmlLink?: string | null }): string | null {
  const v = event.htmlLink?.trim();
  return v ? v : null;
}
