"use client";

import { cn } from "@/lib/utils";
import {
  useSectionVisibility,
  type CollapsibleSectionId,
} from "./section-visibility-context";

export function SectionCollapseControls({
  sectionId,
  bodyId,
  label,
}: {
  sectionId: CollapsibleSectionId;
  bodyId: string;
  label: string;
}) {
  const { collapsed, toggleCollapsed, toggleHidden } =
    useSectionVisibility(sectionId);

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={toggleCollapsed}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={collapsed ? `Expand ${label}` : `Collapse ${label}`}
        title={collapsed ? "Expand" : "Collapse"}
        className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className={cn(
            "h-3 w-3 transition-transform duration-200 ease-out motion-reduce:duration-0",
            collapsed && "-rotate-90",
          )}
        >
          <path
            d="M2.5 4.5 L6 8 L9.5 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        onClick={toggleHidden}
        aria-label={`Hide ${label}`}
        title="Hide section"
        className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true" className="h-3 w-3">
          <path
            d="M3 3 L9 9 M9 3 L3 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </span>
  );
}
