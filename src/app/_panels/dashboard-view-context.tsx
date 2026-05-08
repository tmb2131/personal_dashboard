"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

const STORAGE_KEY = "dashboard-active-view";

export const VIEWS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "today", label: "Today" },
  { id: "upcoming", label: "Upcoming" },
  { id: "projects", label: "Projects" },
  { id: "trips", label: "Trips" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

const DEFAULT_VIEW: ViewId = "dashboard";

function isViewId(value: unknown): value is ViewId {
  return typeof value === "string" && VIEWS.some((v) => v.id === value);
}

const localListeners = new Set<() => void>();

function subscribe(callback: () => void) {
  localListeners.add(callback);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    localListeners.delete(callback);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): ViewId {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isViewId(stored)) return stored;
  } catch {
    // ignore storage failures
  }
  return DEFAULT_VIEW;
}

function getServerSnapshot(): ViewId {
  return DEFAULT_VIEW;
}

function writeView(view: ViewId) {
  try {
    window.localStorage.setItem(STORAGE_KEY, view);
  } catch {
    // ignore storage failures
  }
  // Notify in-tab subscribers (the storage event only fires cross-tab).
  localListeners.forEach((l) => l());
}

type DashboardViewContextValue = {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
};

const DashboardViewContext = createContext<DashboardViewContextValue | null>(null);

export function DashboardViewProvider({ children }: { children: ReactNode }) {
  const activeView = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setActiveView = useCallback((view: ViewId) => writeView(view), []);
  const value = useMemo(() => ({ activeView, setActiveView }), [activeView, setActiveView]);

  return (
    <DashboardViewContext.Provider value={value}>
      {children}
    </DashboardViewContext.Provider>
  );
}

export function useDashboardView(): DashboardViewContextValue {
  const ctx = useContext(DashboardViewContext);
  if (!ctx) {
    throw new Error("useDashboardView must be used within a DashboardViewProvider");
  }
  return ctx;
}
