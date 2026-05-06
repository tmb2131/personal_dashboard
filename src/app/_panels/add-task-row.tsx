"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { quickAddAction } from "../actions";

export function AddTaskRow() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-2 px-5 py-2.5 text-left text-[12px] text-fg-subtle hover:text-fg"
      >
        <span className="text-[14px] leading-none">+</span>
        Add task
      </button>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        startTransition(async () => {
          const result = await quickAddAction(v);
          if (result.ok) {
            setValue("");
            setError(null);
            setOpen(false);
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      className="flex items-center gap-2 px-5 py-2.5"
    >
      <span className="text-[14px] leading-none text-fg-subtle">+</span>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setValue("");
            setError(null);
          }
        }}
        placeholder="New task… (e.g. 'reply tomorrow 9am @work')"
        disabled={pending}
        spellCheck={false}
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
    </form>
  );
}
