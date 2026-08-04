"use client";

import { useMemo } from "react";
import { categoryDot, cn } from "@/lib/utils";
import type { CategoryGroup } from "@/lib/dashboard-data";
import { EmptyState } from "./empty-state";
import { ProjectRow } from "./projects";
import { SectionHeader } from "./section-header";
import { jsonCodec, usePersistedState } from "./use-persisted-state";

const STORAGE_KEY = "dashboard-categories-collapsed";

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");

const collapsedCodec = jsonCodec(isStringArray);

/** Stable identity for persistence — the synthetic buckets have no category id. */
function groupKey(group: CategoryGroup): string {
  return group.id ?? `title:${group.title}`;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      aria-hidden
      className={cn(
        "block shrink-0 transition-transform duration-200 ease-out motion-reduce:duration-0",
        open && "rotate-90",
      )}
    >
      <path
        d="M9 5l7 7-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CategorySection({
  group,
  open,
  onToggle,
}: {
  group: CategoryGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const dot = categoryDot(group.title);
  const projectCount = group.projects.length;

  return (
    <li className="border-t border-border/60 first:border-t-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-5 py-3 text-left transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fg-muted/40"
      >
        <span className="text-fg-subtle">
          <Chevron open={open} />
        </span>
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium">
          {group.title}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
          {projectCount === 0
            ? "—"
            : group.openSubtasks > 0
              ? `${projectCount} · ${group.openSubtasks} open`
              : `${projectCount}`}
        </span>
      </button>

      {open &&
        (projectCount === 0 ? (
          <EmptyState message="No open projects in this category." />
        ) : (
          <ul className="pb-1">
            {group.projects.map((p) => (
              <ProjectRow key={p.id} p={p} />
            ))}
          </ul>
        ))}
    </li>
  );
}

export function Categories({ groups }: { groups: CategoryGroup[] }) {
  // Categories with nothing focused start closed; the rest stay open. Memoised
  // because usePersistedState reads the fallback from a useSyncExternalStore
  // snapshot — a fresh array every render would re-read on every render.
  const defaultCollapsed = useMemo(
    () => groups.filter((g) => !g.projects.some((p) => p.focus === "Yes")).map(groupKey),
    [groups],
  );
  // Collapsed (rather than expanded) ids are stored so a newly created category
  // shows up open by default instead of silently hidden.
  const [collapsed, setCollapsed] = usePersistedState<string[]>(
    STORAGE_KEY,
    defaultCollapsed,
    collapsedCodec,
  );

  const collapsedSet = new Set(collapsed);
  const toggle = (key: string) => {
    setCollapsed(
      collapsedSet.has(key) ? collapsed.filter((k) => k !== key) : [...collapsed, key],
    );
  };

  const totalProjects = groups.reduce((sum, g) => sum + g.projects.length, 0);

  return (
    <section id="categories" className="border-t border-border scroll-mt-6">
      <SectionHeader
        eyebrow="Categories"
        title=""
        count={groups.length}
        source="notion"
        sourceKey="notion"
      />

      {totalProjects === 0 ? (
        <EmptyState message="No projects yet." />
      ) : (
        <ul>
          {groups.map((group) => {
            const key = groupKey(group);
            return (
              <CategorySection
                key={key}
                group={group}
                open={!collapsedSet.has(key)}
                onToggle={() => toggle(key)}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
