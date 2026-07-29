"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn, isEditableTarget } from "@/lib/utils";
import { quickAddAction } from "../actions";

type NotionProjectOption = { id: string; title: string };
type Notice = { text: string; tone: "ok" | "warn" };

const NOTICE_TIMEOUT_MS = 4_000;

export function AddTaskRow({
  notionProjectPicklist,
  autoOpen = false,
}: {
  notionProjectPicklist: NotionProjectOption[];
  autoOpen?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<NotionProjectOption | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const noticeTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const flashNotice = (next: Notice) => {
    if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
    setNotice(next);
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, NOTICE_TIMEOUT_MS);
  };

  const mentionQuery = useMemo(() => {
    const at = value.lastIndexOf("@");
    if (at < 0) return null;
    const before = at === 0 ? " " : value[at - 1];
    if (before !== " ") return null;
    const token = value.slice(at + 1);
    if (token.includes(" ")) return null;
    return token.toLowerCase();
  }, [value]);

  const filteredProjects = useMemo(() => {
    if (mentionQuery == null) return [];
    const q = mentionQuery.trim();
    return notionProjectPicklist
      .filter((p) => !q || p.title.toLowerCase().includes(q))
      .slice(0, 7);
  }, [mentionQuery, notionProjectPicklist]);

  const suggestionsOpen = !suggestionsDismissed && filteredProjects.length > 0;

  // Keep the highlight in range as the query narrows the list.
  const [seenQuery, setSeenQuery] = useState(mentionQuery);
  if (mentionQuery !== seenQuery) {
    setSeenQuery(mentionQuery);
    setHighlightIndex(-1);
  }

  const activateInput = () => {
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  useEffect(() => {
    const onShortcut = (ev: Event) => {
      const detail = (ev as CustomEvent<{ type?: string }>).detail;
      if (!detail?.type) return;
      if (detail.type === "new-task" || detail.type === "quick-add") {
        activateInput();
      }
    };
    window.addEventListener("dashboard-shortcut", onShortcut);
    return () => window.removeEventListener("dashboard-shortcut", onShortcut);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isEditableTarget(e.target)) return;
      if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        activateInput();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const chooseProject = (project: NotionProjectOption) => {
    const at = value.lastIndexOf("@");
    if (at < 0) return;
    const next = `${value.slice(0, at)}@{${project.title}} `;
    setValue(next);
    setSelectedProject(project);
    setHighlightIndex(-1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => activateInput()}
        className="flex w-full items-center gap-2 rounded-lg px-5 py-2.5 text-left text-[12px] text-fg-subtle transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg-elevated/50 hover:text-fg"
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
          const result = await quickAddAction(v, {
            notionProjectPageId: selectedProject?.id ?? null,
            notionProjectTitle: selectedProject?.title ?? null,
          });
          if (result.ok) {
            // Stay open with a cleared input so the confirmation is visible and
            // consecutive adds are quick; Escape closes.
            setValue("");
            setError(null);
            setSelectedProject(null);
            setHighlightIndex(-1);
            setSuggestionsDismissed(false);
            if (result.warning) {
              flashNotice({ text: result.warning, tone: "warn" });
            } else if (result.summary) {
              flashNotice({ text: result.summary, tone: "ok" });
            }
            inputRef.current?.focus();
            router.refresh();
          } else {
            setError(result.error);
          }
        });
      }}
      className="relative flex items-center gap-2 px-5 py-2.5"
    >
      <span className="text-[14px] leading-none text-fg-subtle">+</span>
      <input
        autoFocus
        ref={inputRef}
        value={value}
        onChange={(e) => {
          const next = e.target.value;
          if (selectedProject && !next.includes(`@{${selectedProject.title}}`)) {
            setSelectedProject(null);
          }
          setSuggestionsDismissed(false);
          setValue(next);
        }}
        onKeyDown={(e) => {
          if (suggestionsOpen) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const delta = e.key === "ArrowDown" ? 1 : -1;
              setHighlightIndex((prev) => {
                const count = filteredProjects.length;
                if (prev === -1) return delta === 1 ? 0 : count - 1;
                return (prev + delta + count) % count;
              });
              return;
            }
            if (e.key === "Enter" && highlightIndex >= 0) {
              // Must not fall through to submit while picking a project.
              e.preventDefault();
              chooseProject(filteredProjects[highlightIndex]);
              return;
            }
            if (e.key === "Escape") {
              // First Escape dismisses the list, second closes the form.
              e.preventDefault();
              setSuggestionsDismissed(true);
              setHighlightIndex(-1);
              return;
            }
          }
          if (e.key === "Escape") {
            setOpen(false);
            setValue("");
            setError(null);
            setNotice(null);
            setSelectedProject(null);
            setHighlightIndex(-1);
            setSuggestionsDismissed(false);
          }
        }}
        placeholder="New task… (⇧N, or @ to link a Notion project)"
        disabled={pending}
        spellCheck={false}
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] placeholder:text-fg-subtle"
      />
      {error && <span className="shrink-0 text-[11px] text-danger">{error}</span>}
      {!error && notice && (
        <span
          aria-live="polite"
          className={cn(
            "shrink-0 truncate text-[11px]",
            notice.tone === "warn" ? "text-danger" : "text-fg-subtle",
          )}
        >
          {notice.text}
        </span>
      )}
      {suggestionsOpen && (
        <div
          role="listbox"
          aria-label="Notion projects"
          className="absolute top-full right-4 left-4 z-10 mt-1 max-h-56 overflow-y-auto rounded border border-border bg-bg-elevated p-1 shadow-sm sm:right-auto sm:left-9 sm:w-[24rem]"
        >
          {filteredProjects.map((project, index) => (
            <button
              key={project.id}
              type="button"
              role="option"
              aria-selected={index === highlightIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                chooseProject(project);
              }}
              onMouseEnter={() => setHighlightIndex(index)}
              className={cn(
                "block w-full rounded px-2 py-1.5 text-left text-[12px] text-fg transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg",
                index === highlightIndex && "bg-bg",
              )}
            >
              {project.title}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
