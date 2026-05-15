"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { DashboardMeta } from "@/lib/dashboard-data";

const DashboardMetaContext = createContext<DashboardMeta | null>(null);

export function DashboardMetaProvider({
  meta,
  children,
}: {
  meta: DashboardMeta;
  children: ReactNode;
}) {
  return <DashboardMetaContext.Provider value={meta}>{children}</DashboardMetaContext.Provider>;
}

export function useDashboardMeta(): DashboardMeta | null {
  return useContext(DashboardMetaContext);
}
