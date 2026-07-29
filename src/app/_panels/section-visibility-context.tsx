"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import { jsonCodec, usePersistedState } from "./use-persisted-state";

const COLLAPSED_STORAGE_KEY = "personal-dashboard-section-collapsed";
const HIDDEN_STORAGE_KEY = "personal-dashboard-section-hidden";

export type CollapsibleSectionId = "next-3-days" | "life-areas";

type SectionMeta = { id: CollapsibleSectionId; label: string };

export const COLLAPSIBLE_SECTIONS: readonly SectionMeta[] = [
  { id: "next-3-days", label: "Next 3 Days" },
  { id: "life-areas", label: "Life Areas" },
];

type FlagMap = Partial<Record<CollapsibleSectionId, boolean>>;

const EMPTY_FLAGS: FlagMap = {};

type SectionVisibilityContextValue = {
  collapsed: FlagMap;
  hidden: FlagMap;
  toggleCollapsed: (id: CollapsibleSectionId) => void;
  toggleHidden: (id: CollapsibleSectionId) => void;
  unhide: (id: CollapsibleSectionId) => void;
  unhideAll: () => void;
};

const SectionVisibilityContext =
  createContext<SectionVisibilityContextValue | null>(null);

function isFlagMap(value: unknown): value is FlagMap {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).every(
    ([k, v]) => COLLAPSIBLE_SECTIONS.some((m) => m.id === k) && v === true,
  );
}

// Only `true` entries are persisted, so a cleared flag disappears rather than
// lingering as `false`.
const flagMapCodec = jsonCodec(isFlagMap);

export function SectionVisibilityProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedStored] = usePersistedState<FlagMap>(
    COLLAPSED_STORAGE_KEY,
    EMPTY_FLAGS,
    flagMapCodec,
  );
  const [hidden, setHiddenStored] = usePersistedState<FlagMap>(
    HIDDEN_STORAGE_KEY,
    EMPTY_FLAGS,
    flagMapCodec,
  );

  const toggleCollapsed = useCallback(
    (id: CollapsibleSectionId) => {
      const next: FlagMap = { ...collapsed };
      if (collapsed[id]) delete next[id];
      else next[id] = true;
      setCollapsedStored(next);
    },
    [collapsed, setCollapsedStored],
  );

  const toggleHidden = useCallback(
    (id: CollapsibleSectionId) => {
      const next: FlagMap = { ...hidden };
      if (hidden[id]) delete next[id];
      else next[id] = true;
      setHiddenStored(next);
    },
    [hidden, setHiddenStored],
  );

  const unhide = useCallback(
    (id: CollapsibleSectionId) => {
      if (!hidden[id]) return;
      const next: FlagMap = { ...hidden };
      delete next[id];
      setHiddenStored(next);
    },
    [hidden, setHiddenStored],
  );

  const unhideAll = useCallback(() => {
    if (Object.keys(hidden).length === 0) return;
    setHiddenStored(EMPTY_FLAGS);
  }, [hidden, setHiddenStored]);

  const value = useMemo<SectionVisibilityContextValue>(
    () => ({ collapsed, hidden, toggleCollapsed, toggleHidden, unhide, unhideAll }),
    [collapsed, hidden, toggleCollapsed, toggleHidden, unhide, unhideAll],
  );

  return (
    <SectionVisibilityContext.Provider value={value}>
      {children}
    </SectionVisibilityContext.Provider>
  );
}

function useSectionVisibilityContext(): SectionVisibilityContextValue {
  const ctx = useContext(SectionVisibilityContext);
  if (!ctx)
    throw new Error(
      "useSectionVisibility requires SectionVisibilityProvider",
    );
  return ctx;
}

export function useSectionVisibility(id: CollapsibleSectionId) {
  const ctx = useSectionVisibilityContext();
  return {
    collapsed: Boolean(ctx.collapsed[id]),
    hidden: Boolean(ctx.hidden[id]),
    toggleCollapsed: () => ctx.toggleCollapsed(id),
    toggleHidden: () => ctx.toggleHidden(id),
  };
}

export function useHiddenSections() {
  const ctx = useSectionVisibilityContext();
  const hiddenSections = useMemo(
    () => COLLAPSIBLE_SECTIONS.filter((s) => ctx.hidden[s.id]),
    [ctx.hidden],
  );
  return {
    hiddenSections,
    unhide: ctx.unhide,
    unhideAll: ctx.unhideAll,
  };
}
