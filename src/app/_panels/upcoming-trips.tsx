"use client";

import { useState } from "react";
import type { Project } from "@/lib/dashboard-data";
import { ProjectSubtaskPlanner } from "./project-subtask-planner";
import { SectionHeader } from "./section-header";

function daysUntil(d: Date, from = new Date()): number {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ms = startOfDay(d) - startOfDay(from);
  return Math.round(ms / 86_400_000);
}

function formatDayMonth(d: Date): string {
  return d
    .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    .replace(".", "");
}

function durationDays(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return days >= 0 ? days : null;
}

function TripRow({ trip, now }: { trip: Project; now: Date }) {
  const [expanded, setExpanded] = useState(false);

  const days = trip.dateStart ? Math.max(0, daysUntil(trip.dateStart, now)) : null;
  const dur = durationDays(trip.dateStart, trip.dateEnd);
  const isBooked = trip.status === "Done";
  const fallbackSubtask = [...trip.subtasks]
    .filter((s) => !s.done)
    .sort((a, b) => {
      if (a.inProgress !== b.inProgress) return a.inProgress ? -1 : 1;
      const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (at !== bt) return at - bt;
      return a.title.localeCompare(b.title);
    })[0];
  const nextStep = trip.keyNextStep ?? fallbackSubtask?.title ?? null;
  const sortedSubtasks = trip.subtasks.filter((s) => !s.done).sort((a, b) => {
    const at = (a.date ?? a.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const bt = (b.date ?? b.deadline)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) return at - bt;
    return a.title.localeCompare(b.title);
  });

  return (
    <li className="px-5 py-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start gap-4 text-left"
        aria-expanded={expanded}
      >
        <div className="w-12 shrink-0 text-right">
          <div className="text-[26px] font-medium leading-none tabular-nums">
            {days ?? "—"}
          </div>
          <div className="mt-1 text-[10px] tracking-[0.14em] text-fg-subtle">
            DAYS
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-medium">{trip.title}</span>
            {isBooked && <Pill>BOOKED</Pill>}
            {!isBooked && <Pill>PLANNING</Pill>}
          </div>
          <div className="mt-1 flex items-baseline gap-2 text-[12px] text-fg-muted tabular-nums">
            {trip.dateStart && <span>{formatDayMonth(trip.dateStart)}</span>}
            {trip.dateEnd && trip.dateStart && (
              <>
                <span>→</span>
                <span>{formatDayMonth(trip.dateEnd)}</span>
              </>
            )}
            {dur != null && <span>· {dur}d</span>}
          </div>
          {nextStep ? (
            <div className="mt-1 truncate text-[12px] text-fg-muted">
              <span className="text-fg-subtle">→</span> {nextStep}
            </div>
          ) : (
            <div className="mt-1 text-[12px] text-fg-subtle">No next step</div>
          )}
        </div>
      </button>

      {expanded && (
        <ProjectSubtaskPlanner parentId={trip.id} subtasks={sortedSubtasks} className="mt-2 ml-16" />
      )}
    </li>
  );
}

export function UpcomingTrips({
  trips,
  now,
  eyebrow = "Upcoming Trips",
  sectionId = "upcoming-trips",
  emptyCopy = "Nothing on the horizon",
}: {
  trips: Project[];
  now: Date;
  eyebrow?: string;
  sectionId?: string;
  emptyCopy?: string;
}) {
  return (
    <section id={sectionId} className="border-t border-border scroll-mt-6">
      <SectionHeader eyebrow={eyebrow} title="" count={trips.length} source="notion" />

      {trips.length === 0 ? (
        <div className="px-5 pb-5 text-[12px] text-fg-subtle">{emptyCopy}</div>
      ) : (
        <ul>
          {trips.map((trip) => (
            <TripRow key={trip.id} trip={trip} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="ml-auto inline-flex items-center rounded bg-pill-bg px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-pill-fg">
      {children}
    </span>
  );
}
