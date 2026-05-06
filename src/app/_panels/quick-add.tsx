"use client";

import { useState, useTransition } from "react";
import { quickAddAction } from "../actions";

export function QuickAdd() {
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();
  const [hint, setHint] = useState<string | null>(null);

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        startTransition(async () => {
          const result = await quickAddAction(v);
          setHint(result.ok ? `Added · ${result.summary ?? ""}` : `Error · ${result.error ?? "unknown"}`);
          if (result.ok) setValue("");
          setTimeout(() => setHint(null), 2500);
        });
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Quick add task… (try: 'reply to investor tomorrow 9am @personal-site')"
        className="h-8 w-[28rem] max-w-full rounded-md border border-border bg-bg-elevated px-2.5 text-[13px] outline-none focus:border-accent"
        disabled={pending}
        spellCheck={false}
      />
      {hint && <span className="text-[11px] text-fg-muted">{hint}</span>}
    </form>
  );
}
