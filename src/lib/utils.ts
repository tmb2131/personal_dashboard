import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatRelativeDay(d: Date, now = new Date()): string {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const ms = startOfDay(d).getTime() - startOfDay(now).getTime();
  const days = Math.round(ms / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

const DOT_BY_CATEGORY: Record<string, string> = {
  work: "var(--dot-work)",
  "work (tom)": "var(--dot-work)",
  money: "var(--dot-money)",
  finances: "var(--dot-money)",
  health: "var(--dot-health)",
  travel: "var(--dot-travel)",
  "travel/events": "var(--dot-travel)",
  trips: "var(--dot-travel)",
  learning: "var(--dot-learning)",
  home: "var(--dot-home)",
  family: "var(--dot-family)",
  personal: "var(--dot-personal)",
  "personal (tom)": "var(--dot-personal)",
};

export function categoryDot(name: string | null | undefined): string {
  if (!name) return "var(--dot-default)";
  return DOT_BY_CATEGORY[name.toLowerCase().trim()] ?? "var(--dot-default)";
}

export function shortCategoryLabel(name: string | null | undefined): string {
  if (!name) return "";
  return name.replace(/\s*\([^)]*\)\s*/g, "").split("/")[0].trim().toUpperCase();
}

/** Lowercase category title with collapsed spaces and slash-normalized segments (e.g. `travel/events`). */
export function normalizeCategoryKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const collapsed = name.toLowerCase().trim().replace(/\s+/g, " ");
  return collapsed.replace(/\s*\/\s*/g, "/");
}

export function isTravelEventsCategory(name: string | null | undefined): boolean {
  return normalizeCategoryKey(name) === "travel/events";
}

export type DayBucket = {
  key: string;
  label: string;
  date: Date;
  monthLabel: string;
};

export function bucketKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function makeDayBuckets(now: Date, days = 3): DayBucket[] {
  const out: DayBucket[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const label =
      i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString("en-GB", { weekday: "long" });
    const monthLabel = d
      .toLocaleDateString("en-GB", { day: "numeric", month: "short" })
      .toUpperCase()
      .replace(".", "");
    out.push({ key: bucketKey(d), label, date: d, monthLabel });
  }
  return out;
}

export function formatTimeWithSuffix(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const isPM = h >= 12;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const suffix = isPM ? "p" : "a";
  if (m === 0) return `${h12}${suffix}`;
  return `${h12}:${m.toString().padStart(2, "0")}${suffix}`;
}

export function formatHHMM(d: Date): string {
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function daysBetween(a: Date, b: Date): number {
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}
