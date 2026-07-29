"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * localStorage-backed state that is safe to render on the server.
 *
 * Reading localStorage inside a `useState` initialiser looks like it works, but
 * the server renders the fallback while the client's first render returns the
 * stored value — a hydration mismatch. `useSyncExternalStore` has a dedicated
 * server snapshot, so both sides agree and React swaps in the stored value
 * immediately after. It also keeps sibling providers and other tabs in sync.
 *
 * This generalises the pattern already used by dashboard-view-context.
 */
export type Codec<T> = {
  /** Return null for anything unrecognised so the fallback applies. */
  decode: (raw: string) => T | null;
  encode: (value: T) => string;
};

/** Legacy "1"/"0" encoding, kept so stored preferences survive. */
export const flagCodec: Codec<boolean> = {
  decode: (raw) => (raw === "1" ? true : raw === "0" ? false : null),
  encode: (value) => (value ? "1" : "0"),
};

export function jsonCodec<T>(isValid: (value: unknown) => value is T): Codec<T> {
  return {
    decode: (raw) => {
      try {
        const parsed: unknown = JSON.parse(raw);
        return isValid(parsed) ? parsed : null;
      } catch {
        return null;
      }
    },
    encode: (value) => JSON.stringify(value),
  };
}

const listenersByKey = new Map<string, Set<() => void>>();

/** Keeps getSnapshot referentially stable — without it, decoded objects would
 *  be new on every call and re-render forever. */
const snapshotCache = new Map<string, { raw: string | null; value: unknown }>();

function notify(key: string) {
  for (const listener of listenersByKey.get(key) ?? []) listener();
}

function read<T>(key: string, fallback: T, codec: Codec<T>): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return fallback;
  }

  const cached = snapshotCache.get(key);
  if (cached && cached.raw === raw) return cached.value as T;

  const decoded = raw == null ? null : codec.decode(raw);
  const value = decoded ?? fallback;
  snapshotCache.set(key, { raw, value });
  return value;
}

export function usePersistedState<T>(
  key: string,
  fallback: T,
  codec: Codec<T>,
): [T, (next: T) => void] {
  const subscribe = useCallback(
    (callback: () => void) => {
      const set = listenersByKey.get(key) ?? new Set<() => void>();
      set.add(callback);
      listenersByKey.set(key, set);

      const onStorage = (e: StorageEvent) => {
        if (e.key === key) callback();
      };
      window.addEventListener("storage", onStorage);

      return () => {
        set.delete(callback);
        window.removeEventListener("storage", onStorage);
      };
    },
    [key],
  );

  const getSnapshot = useCallback(() => read(key, fallback, codec), [key, fallback, codec]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);

  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setValue = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, codec.encode(next));
      } catch {
        // Storage unavailable (private mode, quota). Cache it so the change
        // still applies for this session.
        snapshotCache.set(key, { raw: null, value: next });
      }
      notify(key);
    },
    [key, codec],
  );

  return [value, setValue];
}
