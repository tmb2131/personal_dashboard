"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const INLINE_STORAGE_KEY = "personal-dashboard-show-recurring-today-tasks";
const SECTION_STORAGE_KEY = "personal-dashboard-show-today-recurring-section";

type TodayRecurringTasksContextValue = {
  showRecurringTodayTasks: boolean;
  setShowRecurringTodayTasks: (show: boolean) => void;
  showTodayRecurringSection: boolean;
  setShowTodayRecurringSection: (show: boolean) => void;
};

const TodayRecurringTasksContext = createContext<TodayRecurringTasksContextValue | null>(null);

function readStored(key: string, defaultValue: boolean): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    if (stored == null) return defaultValue;
    return stored === "1";
  } catch {
    return defaultValue;
  }
}

function writeStored(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function TodayRecurringTasksProvider({ children }: { children: ReactNode }) {
  const [showRecurringTodayTasks, setInlineState] = useState(() => readStored(INLINE_STORAGE_KEY, false));
  const [showTodayRecurringSection, setSectionState] = useState(() => readStored(SECTION_STORAGE_KEY, true));

  const setShowRecurringTodayTasks = useCallback((show: boolean) => {
    setInlineState(show);
    writeStored(INLINE_STORAGE_KEY, show);
  }, []);

  const setShowTodayRecurringSection = useCallback((show: boolean) => {
    setSectionState(show);
    writeStored(SECTION_STORAGE_KEY, show);
  }, []);

  const value = useMemo(
    () => ({
      showRecurringTodayTasks,
      setShowRecurringTodayTasks,
      showTodayRecurringSection,
      setShowTodayRecurringSection,
    }),
    [
      showRecurringTodayTasks,
      setShowRecurringTodayTasks,
      showTodayRecurringSection,
      setShowTodayRecurringSection,
    ],
  );

  return (
    <TodayRecurringTasksContext.Provider value={value}>{children}</TodayRecurringTasksContext.Provider>
  );
}

export function useTodayRecurringTasksVisibility(): TodayRecurringTasksContextValue {
  const ctx = useContext(TodayRecurringTasksContext);
  if (!ctx) throw new Error("useTodayRecurringTasksVisibility requires TodayRecurringTasksProvider");
  return ctx;
}
