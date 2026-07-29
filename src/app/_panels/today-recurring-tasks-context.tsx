"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { flagCodec, usePersistedState } from "./use-persisted-state";

const INLINE_STORAGE_KEY = "personal-dashboard-show-recurring-today-tasks";
const SECTION_STORAGE_KEY = "personal-dashboard-show-today-recurring-section";

type TodayRecurringTasksContextValue = {
  showRecurringTodayTasks: boolean;
  setShowRecurringTodayTasks: (show: boolean) => void;
  showTodayRecurringSection: boolean;
  setShowTodayRecurringSection: (show: boolean) => void;
};

const TodayRecurringTasksContext = createContext<TodayRecurringTasksContextValue | null>(null);

export function TodayRecurringTasksProvider({ children }: { children: ReactNode }) {
  const [showRecurringTodayTasks, setShowRecurringTodayTasks] = usePersistedState(
    INLINE_STORAGE_KEY,
    false,
    flagCodec,
  );
  const [showTodayRecurringSection, setShowTodayRecurringSection] = usePersistedState(
    SECTION_STORAGE_KEY,
    true,
    flagCodec,
  );

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
