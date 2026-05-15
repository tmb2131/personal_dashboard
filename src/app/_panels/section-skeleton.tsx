import { cn } from "@/lib/utils";

export function SectionSkeleton({
  lines = 4,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <section
      className={cn("border-t border-border", className)}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-baseline justify-between gap-4 px-4 pt-5 pb-3 sm:px-5">
        <div className="flex items-baseline gap-2">
          <div className="h-3 w-16 animate-pulse rounded bg-pill-bg" />
          <span className="text-fg-subtle">·</span>
          <div className="h-3 w-12 animate-pulse rounded bg-pill-bg" />
        </div>
        <div className="h-3 w-10 animate-pulse rounded bg-pill-bg" />
      </div>
      <ul className="space-y-1 px-5 pb-3">
        {Array.from({ length: lines }).map((_, i) => {
          const width = 52 + ((i * 13) % 32);
          return (
            <li key={i} className="flex items-center gap-3 py-1.5">
              <div className="h-[18px] w-[18px] shrink-0 animate-pulse rounded-full bg-pill-bg" />
              <div
                className="h-3 animate-pulse rounded bg-pill-bg"
                style={{ width: `${width}%` }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
