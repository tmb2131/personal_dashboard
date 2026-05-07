import { cn } from "@/lib/utils";

export function SectionHeader({
  eyebrow,
  title,
  count,
  source,
  className,
  children,
}: {
  eyebrow: string;
  title: string;
  count?: string | number;
  source?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-5 pb-3 text-[11px] tracking-[0.14em] text-fg-subtle sm:px-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="uppercase">{eyebrow}</span>
        <span>·</span>
        <span className="uppercase text-fg">{title}</span>
        {count !== undefined && count !== "" && (
          <span className="ml-1.5 tabular-nums text-fg-muted normal-case tracking-normal">{count}</span>
        )}
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-3 normal-case tracking-normal">
        {children}
        {source && <span className="text-fg-subtle">{source}</span>}
      </div>
    </div>
  );
}
