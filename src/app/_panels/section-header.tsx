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
        "flex items-baseline gap-2 px-5 pt-5 pb-3 text-[11px] tracking-[0.14em] text-fg-subtle",
        className,
      )}
    >
      <span className="uppercase">{eyebrow}</span>
      <span>·</span>
      <span className="uppercase text-fg">{title}</span>
      {count !== undefined && count !== "" && (
        <span className="ml-1.5 tabular-nums text-fg-muted normal-case tracking-normal">{count}</span>
      )}
      {children}
      {source && (
        <span className="ml-auto normal-case tracking-normal text-fg-subtle">{source}</span>
      )}
    </div>
  );
}
