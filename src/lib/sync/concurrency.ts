/**
 * Bounded fan-out for the sync passes. Both reconcile phases walk a list of rows
 * and hit an external API per row, so they need a worker pool: unbounded
 * `Promise.all` would burst the Notion/Todoist rate limits, and a plain `for`
 * loop spends the whole function timeout on round trips.
 */
export async function mapBoundedConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}
