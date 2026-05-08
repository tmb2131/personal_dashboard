"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "dashboard-active-view";

const VIEWS = [
  { id: "dashboard", label: "Dashboard", href: "#" },
  { id: "today", label: "Today", href: "#today-tasks" },
  { id: "upcoming", label: "Upcoming", href: "#personal-tasks" },
  { id: "projects", label: "Projects", href: "#projects" },
  { id: "trips", label: "Trips", href: "#upcoming-trips" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

function initialView(): ViewId {
  if (typeof window === "undefined") return "dashboard";
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && VIEWS.some((v) => v.id === stored)) return stored as ViewId;
  } catch {
    // ignore storage failures
  }
  return "dashboard";
}

export function DashboardViewChips() {
  const [activeView, setActiveView] = useState<ViewId>(initialView);

  const selectView = (view: ViewId) => {
    setActiveView(view);
    try {
      window.localStorage.setItem(STORAGE_KEY, view);
    } catch {
      // ignore storage failures
    }
  };

  return (
    <nav className="border-t border-border px-4 py-2 sm:px-8" aria-label="Dashboard views">
      <div className="flex gap-1 overflow-x-auto pb-1 sm:inline-flex sm:overflow-visible sm:pb-0">
        {VIEWS.map((view) => (
          <a
            key={view.id}
            href={view.href}
            onClick={() => selectView(view.id)}
            className={cn(
              "shrink-0 rounded-full border border-border px-2.5 py-1 text-[11px] text-fg-muted transition hover:text-fg",
              activeView === view.id && "border-border-strong bg-bg-elevated text-fg shadow-sm",
            )}
          >
            {view.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
