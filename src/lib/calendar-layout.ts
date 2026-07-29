export type TimedItem<T> = {
  event: T;
  start: Date;
  end: Date;
};

export type LaidOutItem<T> = TimedItem<T> & {
  /** 0-based column within this item's overlap cluster. */
  column: number;
  /** Total columns in that cluster; width is 1/columns. */
  columns: number;
};

/**
 * Assigns side-by-side columns to overlapping calendar events.
 *
 * The dashboard merges two people's calendars, so concurrent events are normal.
 * Without this every event would be drawn full-width at its own offset and the
 * later one would simply cover the earlier.
 *
 * Events are grouped into clusters of transitively-overlapping items; within a
 * cluster each event takes the first column whose previous occupant has already
 * ended. Every event in a cluster shares that cluster's column count so their
 * widths line up.
 */
export function layoutDayEvents<T>(items: TimedItem<T>[]): LaidOutItem<T>[] {
  const sorted = [...items].sort((a, b) => {
    const byStart = a.start.getTime() - b.start.getTime();
    if (byStart !== 0) return byStart;
    // Longer events first so they take the leftmost column.
    return b.end.getTime() - a.end.getTime();
  });

  const out: LaidOutItem<T>[] = [];
  let cluster: LaidOutItem<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const columns = columnEnds.length;
    for (const item of cluster) out.push({ ...item, columns });
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    const start = item.start.getTime();
    // A zero-length event still occupies its slot.
    const end = Math.max(item.end.getTime(), start);

    if (cluster.length > 0 && start >= clusterEnd) flush();

    let column = columnEnds.findIndex((columnEnd) => columnEnd <= start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }

    cluster.push({ ...item, column, columns: 0 });
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length > 0) flush();

  return out;
}

/** True when an event covers a whole day (midnight to midnight), which the
 *  grid shows as a band rather than positioning on the hour scale. */
export function isAllDaySpan(start: Date, end: Date | null): boolean {
  if (!end) return false;
  const midnightStart =
    start.getHours() === 0 && start.getMinutes() === 0 && start.getSeconds() === 0;
  if (!midnightStart) return false;
  return end.getTime() - start.getTime() >= 24 * 3_600_000 - 1000;
}
