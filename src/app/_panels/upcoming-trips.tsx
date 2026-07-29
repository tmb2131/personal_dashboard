"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  createTripAction,
  setProjectStatusAction,
  setTripDatesAction,
} from "@/app/actions";
import type { Project } from "@/lib/dashboard-data";
import { formatDateOnlyLocal, parseDateOnlyLocal } from "@/lib/date-utils";
import { cn } from "@/lib/utils";
import { EmptyState } from "./empty-state";
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

function tripDatesRangeError(startVal: string, endVal: string): string | null {
  const s = startVal.trim();
  const e = endVal.trim();
  if (e && !s) return "Start date required when an end date is set";
  if (!s || !e) return null;
  const ds = parseDateOnlyLocal(s);
  const de = parseDateOnlyLocal(e);
  if (!ds || !de) return null;
  if (de.getTime() < ds.getTime()) return "End date must be on or after start date";
  return null;
}

function AddTripRow({ autoOpen = false }: { autoOpen?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [title, setTitle] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rangeErr = tripDatesRangeError(dateStart, dateEnd);

  const reset = () => {
    setTitle("");
    setDateStart("");
    setDateEnd("");
    setError(null);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await createTripAction({
        title: title.trim(),
        dateStart: dateStart.trim() || null,
        dateEnd: dateEnd.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      reset();
      setOpen(false);
      router.refresh();
    });
  };

  const submitDisabled =
    pending ||
    !title.trim() ||
    Boolean(rangeErr) ||
    (Boolean(dateEnd.trim()) && !dateStart.trim());

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-[12px] text-fg-subtle hover:text-fg"
      >
        <span className="text-[14px] leading-none">+</span>
        Add trip
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-1.5 px-5 py-2.5">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            reset();
            setOpen(false);
          }
        }}
        placeholder="Trip name"
        disabled={pending}
        className="h-8 w-full rounded border border-border bg-bg px-2 text-[13px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="w-12 shrink-0">Start</span>
          <input
            type="date"
            value={dateStart}
            onChange={(e) => setDateStart(e.target.value)}
            disabled={pending}
            className="h-7 rounded border border-border bg-bg px-2 text-[11px] text-fg"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[11px] text-fg-muted">
          <span className="w-12 shrink-0">End</span>
          <input
            type="date"
            value={dateEnd}
            onChange={(e) => setDateEnd(e.target.value)}
            disabled={pending}
            className="h-7 rounded border border-border bg-bg px-2 text-[11px] text-fg"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => {
            reset();
            setOpen(false);
          }}
          disabled={pending}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {(error || rangeErr) && (
        <div className="text-[11px] text-danger">{error ?? rangeErr}</div>
      )}
    </form>
  );
}

function TripDatesEditor({ trip }: { trip: Project }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [startVal, setStartVal] = useState("");
  const [endVal, setEndVal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dur = durationDays(trip.dateStart, trip.dateEnd);

  const rangeErr = tripDatesRangeError(startVal, endVal);

  const openEdit = () => {
    setStartVal(trip.dateStart ? formatDateOnlyLocal(trip.dateStart) : "");
    setEndVal(trip.dateEnd ? formatDateOnlyLocal(trip.dateEnd) : "");
    setError(null);
    setEditing(true);
  };

  const submitDisabled =
    pending ||
    Boolean(rangeErr) ||
    (Boolean(endVal.trim()) && !startVal.trim());

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const localErr = tripDatesRangeError(startVal, endVal);
    if (localErr) return;
    setError(null);
    startTransition(async () => {
      const result = await setTripDatesAction({
        notionPageId: trip.id,
        dateStart: startVal.trim() || null,
        dateEnd: endVal.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
      router.refresh();
    });
  };

  if (editing) {
    return (
      <form
        onSubmit={handleSubmit}
        className="mt-1 flex flex-wrap items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="date"
          value={startVal}
          onChange={(e) => setStartVal(e.target.value)}
          disabled={pending}
          className="h-7 rounded border border-border bg-bg px-2 text-[11px] text-fg"
        />
        <input
          type="date"
          value={endVal}
          onChange={(e) => setEndVal(e.target.value)}
          disabled={pending}
          className="h-7 rounded border border-border bg-bg px-2 text-[11px] text-fg"
        />
        <button
          type="submit"
          disabled={submitDisabled}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => {
            setEditing(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] text-fg-muted hover:text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        {(error || rangeErr) && (
          <span className="w-full text-[11px] text-danger">{error ?? rangeErr}</span>
        )}
      </form>
    );
  }

  return (
    <div className="mt-1" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={openEdit}
        className="flex flex-wrap items-baseline gap-2 text-left text-[12px] tabular-nums text-fg-muted transition-colors duration-200 ease-out hover:text-fg motion-reduce:duration-0"
      >
        {trip.dateStart ? (
          <>
            <span>{formatDayMonth(trip.dateStart)}</span>
            {trip.dateEnd && (
              <>
                <span>→</span>
                <span>{formatDayMonth(trip.dateEnd)}</span>
              </>
            )}
            {dur != null && <span>· {dur}d</span>}
          </>
        ) : (
          <span className="text-fg-subtle">+ Add dates</span>
        )}
      </button>
    </div>
  );
}

function TripRow({ trip, now }: { trip: Project; now: Date }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [statusOverride, setStatusOverride] = useState<boolean | null>(null);
  const [statusPending, startStatusTransition] = useTransition();
  const { setNodeRef: setDroppableRef, isOver, active } = useDroppable({
    id: `trip-${trip.id}`,
    data: { targetParentPageId: trip.id },
  });
  const isActiveDrag = Boolean(active);

  const days = trip.dateStart ? Math.max(0, daysUntil(trip.dateStart, now)) : null;
  const isBooked = statusOverride ?? (trip.status === "Done");

  const handleStatusChange = (nextBooked: boolean) => {
    if (nextBooked === isBooked) return;
    const previous = isBooked;
    setStatusOverride(nextBooked);
    startStatusTransition(async () => {
      const result = await setProjectStatusAction({
        notionPageId: trip.id,
        status: nextBooked ? "Done" : "Not started",
      });
      if (!result.ok) {
        setStatusOverride(previous);
        return;
      }
      setStatusOverride(null);
      router.refresh();
    });
  };
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
    <li
      ref={setDroppableRef}
      className={cn(
        "rounded-lg px-5 py-3 transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated/50",
        isActiveDrag && "ring-1 ring-border-strong/40",
        isOver && "bg-accent-soft ring-1 ring-accent",
      )}
    >
      <div className="flex w-full items-start gap-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-12 shrink-0 text-right transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted"
          aria-expanded={expanded}
        >
          <div className="text-[26px] font-medium leading-none tabular-nums">
            {days ?? "—"}
          </div>
          <div className="mt-1 text-[10px] tracking-[0.14em] text-fg-subtle">DAYS</div>
        </button>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex w-full items-baseline gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex min-w-0 flex-1 items-baseline text-left transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted"
              aria-expanded={expanded}
            >
              <span className="min-w-0 truncate text-[14px] font-medium">{trip.title}</span>
            </button>
            <TripStatusBadge
              booked={isBooked}
              disabled={statusPending}
              onChange={handleStatusChange}
            />
          </div>

          <TripDatesEditor trip={trip} />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="block w-full text-left transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg-muted"
            aria-expanded={expanded}
          >
            {nextStep ? (
              <div className="truncate text-[12px] text-fg-muted">
                <span className="text-fg-subtle">→</span> {nextStep}
              </div>
            ) : (
              <div className="text-[12px] text-fg-subtle">No next step</div>
            )}
          </button>
        </div>
      </div>

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
  showAdd = false,
}: {
  trips: Project[];
  now: Date;
  eyebrow?: string;
  sectionId?: string;
  emptyCopy?: string;
  showAdd?: boolean;
}) {
  const isEmpty = trips.length === 0;
  return (
    <section id={sectionId} className="scroll-mt-6 border-t border-border">
      <SectionHeader
        eyebrow={eyebrow}
        title=""
        count={trips.length}
        source="notion"
        sourceKey="notion"
      />

      {showAdd ? <AddTripRow autoOpen={isEmpty} /> : null}

      {isEmpty ? (
        <EmptyState message={`${emptyCopy}.`} />
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

function TripStatusBadge({
  booked,
  disabled,
  onChange,
}: {
  booked: boolean;
  disabled: boolean;
  onChange: (nextBooked: boolean) => void;
}) {
  return (
    <span className="relative inline-flex shrink-0">
      <span
        aria-hidden
        className={cn(
          "pointer-events-none inline-flex items-center rounded bg-pill-bg px-1.5 py-0.5 text-[10px] tracking-[0.14em] text-pill-fg",
          disabled && "opacity-60",
        )}
      >
        {booked ? "BOOKED" : "PLANNING"}
      </span>
      <select
        value={booked ? "booked" : "planning"}
        onChange={(e) => onChange(e.target.value === "booked")}
        disabled={disabled}
        aria-label="Trip status"
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        <option value="planning">PLANNING</option>
        <option value="booked">BOOKED</option>
      </select>
    </span>
  );
}
