 "use client";

import { useState } from "react";
import { formatTimeWithSuffix } from "@/lib/utils";
import type { DayGroupedEvents } from "@/lib/dashboard-data";
import { SectionCollapseControls } from "./section-collapse-controls";
import { SectionHeader } from "./section-header";
import { useSectionVisibility } from "./section-visibility-context";

const GCAL_DAY_URL = "https://calendar.google.com/calendar/u/0/r/day";

const OWNER_DOT = {
  thomas: "#D98783",
  sriya: "#DCC35A",
} as const;

function locationFor(e: DayGroupedEvents["events"][number]): string {
  if (e.location) return e.location;
  // Fall back to conferencing hint embedded in summary
  return "";
}

export function Next3Days({ groups }: { groups: DayGroupedEvents[] }) {
  const { collapsed, hidden } = useSectionVisibility("next-3-days");
  const canSwipe = groups.length > 1;
  const swipeHintKey = "next3days-swipe-hint-dismissed";
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [showSwipeHint, setShowSwipeHint] = useState(() => {
    if (!canSwipe || typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(swipeHintKey) !== "1";
    } catch {
      return false;
    }
  });
  const total = groups.reduce((n, g) => n + g.events.length, 0);
  const selectedGroup = groups[selectedIndex] ?? groups[0];

  const dismissSwipeHint = () => {
    if (!showSwipeHint) return;
    setShowSwipeHint(false);
    try {
      window.localStorage.setItem(swipeHintKey, "1");
    } catch {
      // ignore storage failures
    }
  };

  const goToNext = () => {
    setSelectedIndex((idx) => Math.min(idx + 1, groups.length - 1));
    dismissSwipeHint();
  };

  const goToPrev = () => {
    setSelectedIndex((idx) => Math.max(idx - 1, 0));
    dismissSwipeHint();
  };

  const renderDayCard = (g: DayGroupedEvents) => (
    <div
      key={g.bucket.key}
      className="rounded-md border border-border bg-bg-elevated px-2.5 py-2 transition-[box-shadow,border-color] duration-200 ease-out motion-reduce:duration-0 hover:border-border-strong hover:shadow-sm sm:px-3 sm:py-2.5"
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13px] font-medium">{g.bucket.label}</span>
        <span className="font-serif italic text-[11px] text-fg-muted">{g.bucket.monthLabel}</span>
        <span className="ml-auto text-[10px] tabular-nums text-fg-subtle">{g.events.length}</span>
      </div>

      {g.events.length === 0 ? (
        <div className="flex items-baseline gap-2 text-[11px]">
          <span className="font-serif italic text-fg-muted">Clear day.</span>
          <a
            href={GCAL_DAY_URL}
            target="_blank"
            rel="noreferrer"
            className="text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-fg"
          >
            Open Google Calendar →
          </a>
        </div>
      ) : (
        <ul className="space-y-1">
          {g.events.map((e) => {
            const start = e.start ? new Date(e.start) : null;
            const loc = locationFor(e);
            const href = e.meetingUrl ?? e.htmlLink;
            const title = e.meetingUrl
              ? `Join meeting · ${e.summary ?? ""}`
              : e.htmlLink
              ? `Open in Google Calendar · ${e.summary ?? ""}`
              : e.summary ?? "";
            const summaryNode = href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                title={title}
                className="min-w-0 flex-1 break-words underline-offset-2 hover:underline"
              >
                {e.summary ?? "(no title)"}
                {e.meetingUrl && (
                  <span aria-hidden className="ml-1 text-[10px] text-accent">↗</span>
                )}
              </a>
            ) : (
              <span className="min-w-0 flex-1 break-words">{e.summary ?? "(no title)"}</span>
            );
            return (
              <li key={e.id} className="flex items-baseline gap-1.5 text-[12px]">
                <span className="w-9 shrink-0 tabular-nums text-fg-muted">
                  {start ? formatTimeWithSuffix(start) : ""}
                </span>
                {summaryNode}
                {loc && (
                  <span className="hidden max-w-[8rem] shrink-0 truncate text-[10px] text-fg-subtle xl:inline">
                    {loc}
                  </span>
                )}
                {e.owner !== "other" && (
                  <span className="flex shrink-0 items-center gap-1.5">
                    {(e.owner === "thomas" || e.owner === "both") && (
                      <span
                        aria-label="thomas.brosens@gmail.com"
                        title="thomas.brosens@gmail.com"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: OWNER_DOT.thomas }}
                      />
                    )}
                    {(e.owner === "sriya" || e.owner === "both") && (
                      <span
                        aria-label="sriya.sundaresan@gmail.com"
                        title="sriya.sundaresan@gmail.com"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: OWNER_DOT.sriya }}
                      />
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );

  if (hidden) return null;

  return (
    <section id="next-3-days" className="border-t border-border scroll-mt-6">
      <SectionHeader
        eyebrow="Next 3 Days"
        title=""
        count={total}
        source="google cal"
        sourceKey="gcal"
      >
        <SectionCollapseControls
          sectionId="next-3-days"
          bodyId="next-3-days-body"
          label="Next 3 Days"
        />
      </SectionHeader>

      {!collapsed && (
      <div id="next-3-days-body" className="px-4 pb-4 sm:px-5">
        <div className="md:hidden">
          <div className="mb-2.5 flex gap-1.5 overflow-x-auto pb-1">
            {groups.map((g, idx) => (
              <button
                key={g.bucket.key}
                type="button"
                onClick={() => {
                  setSelectedIndex(idx);
                  dismissSwipeHint();
                }}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
                  idx === selectedIndex
                    ? "border-border-strong bg-bg-elevated text-fg"
                    : "border-border bg-bg text-fg-muted"
                }`}
              >
                {g.bucket.label} · {g.events.length}
              </button>
            ))}
          </div>
          <div
            style={{ touchAction: "pan-y" }}
            onTouchStart={(e) => {
              if (!canSwipe) return;
              setTouchStartX(e.touches[0]?.clientX ?? null);
            }}
            onTouchEnd={(e) => {
              if (!canSwipe || touchStartX == null) return;
              const endX = e.changedTouches[0]?.clientX ?? touchStartX;
              const delta = endX - touchStartX;
              if (Math.abs(delta) >= 40) {
                if (delta < 0) goToNext();
                else goToPrev();
              }
              setTouchStartX(null);
            }}
          >
            {showSwipeHint ? (
              <div className="mb-1 text-[10px] text-fg-subtle transition-opacity">Swipe left/right for next day</div>
            ) : null}
            {selectedGroup ? renderDayCard(selectedGroup) : null}
          </div>
        </div>

        <div className="hidden pb-1 md:block">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">{groups.map((g) => renderDayCard(g))}</div>
        </div>
      </div>
      )}
    </section>
  );
}
