"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const COLLAPSED_STORAGE_KEY = "personal-dashboard-section-collapsed";
const HIDDEN_STORAGE_KEY = "personal-dashboard-section-hidden";

export type CollapsibleSectionId = "next-3-days" | "life-areas";

type SectionMeta = { id: CollapsibleSectionId; label: string };

export const COLLAPSIBLE_SECTIONS: readonly SectionMeta[] = [
  { id: "next-3-days", label: "Next 3 Days" },
  { id: "life-areas", label: "Life Areas" },
];

type FlagMap = Partial<Record<CollapsibleSectionId, boolean>>;

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

function readStored(key: string): FlagMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: FlagMap = {};
    for (const meta of COLLAPSIBLE_SECTIONS) {
      const val = (parsed as Record<string, unknown>)[meta.id];
      if (val === true) out[meta.id] = true;
    }
    return out;
  } catch {
    return {};
  }
}

function writeStored(key: string, value: FlagMap) {
  try {
    const trimmed: FlagMap = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === true) trimmed[k as CollapsibleSectionId] = true;
    }
    if (Object.keys(trimmed).length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(trimmed));
    }
  } catch {
    /* ignore */
  }
}

export function SectionVisibilityProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState<FlagMap>(() =>
    readStored(COLLAPSED_STORAGE_KEY),
  );
  const [hidden, setHidden] = useState<FlagMap>(() =>
    readStored(HIDDEN_STORAGE_KEY),
  );

  const toggleCollapsed = useCallback((id: CollapsibleSectionId) => {
    setCollapsed((prev) => {
      const next: FlagMap = { ...prev };
      if (prev[id]) delete next[id];
      else next[id] = true;
      writeStored(COLLAPSED_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const toggleHidden = useCallback((id: CollapsibleSectionId) => {
    setHidden((prev) => {
      const next: FlagMap = { ...prev };
      if (prev[id]) delete next[id];
      else next[id] = true;
      writeStored(HIDDEN_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const unhide = useCallback((id: CollapsibleSectionId) => {
    setHidden((prev) => {
      if (!prev[id]) return prev;
      const next: FlagMap = { ...prev };
      delete next[id];
      writeStored(HIDDEN_STORAGE_KEY, next);
      return next;
    });
  }, []);

  const unhideAll = useCallback(() => {
    setHidden((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      writeStored(HIDDEN_STORAGE_KEY, {});
      return {};
    });
  }, []);

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
