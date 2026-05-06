"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

const STORAGE_KEY = "personal-dashboard-show-recurring-today-tasks";

type TodayRecurringTasksContextValue = {
  showRecurringTodayTasks: boolean;
  setShowRecurringTodayTasks: (show: boolean) => void;
};

const TodayRecurringTasksContext = createContext<TodayRecurringTasksContextValue | null>(null);

export function TodayRecurringTasksProvider({ children }: { children: ReactNode }) {
  const [showRecurringTodayTasks, setShowState] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const setShowRecurringTodayTasks = useCallback((show: boolean) => {
    setShowState(show);
    try {
      localStorage.setItem(STORAGE_KEY, show ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ showRecurringTodayTasks, setShowRecurringTodayTasks }),
    [showRecurringTodayTasks, setShowRecurringTodayTasks],
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
