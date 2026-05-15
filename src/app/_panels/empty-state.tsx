import { cn } from "@/lib/utils";

export type EmptyStateCta = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

export function EmptyState({
  message,
  cta,
  className,
  tone = "muted",
}: {
  message: string;
  cta?: EmptyStateCta | null;
  className?: string;
  tone?: "muted" | "positive";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 gap-y-1 px-5 pt-1 pb-3 text-[12px]",
        className,
      )}
    >
      <span
        className={cn(
          "font-serif italic",
          tone === "positive" ? "text-fg" : "text-fg-muted",
        )}
      >
        {message}
      </span>
      {cta && (
        <button
          type="button"
          onClick={cta.onClick}
          disabled={cta.disabled}
          className="text-fg-subtle underline decoration-dotted underline-offset-2 transition-colors duration-200 ease-out motion-reduce:duration-0 hover:text-fg disabled:opacity-50"
        >
          {cta.label}
        </button>
      )}
    </div>
  );
}

export function dispatchShortcut(type: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("dashboard-shortcut", { detail: { type } }));
}
