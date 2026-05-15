"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { isEditableTarget } from "@/lib/utils";
import { quickAddAction } from "../actions";

type NotionProjectOption = { id: string; title: string };

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
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement | null>(null);

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
      if (e.ctrlKey && e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
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
            setValue("");
            setError(null);
            setSelectedProject(null);
            setOpen(false);
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
          setValue(next);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            setValue("");
            setError(null);
            setSelectedProject(null);
          }
        }}
        placeholder="New task… (⌃⌘N, or @ to link a Notion project)"
        disabled={pending}
        spellCheck={false}
        className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-subtle"
      />
      {error && <span className="text-[11px] text-red-500">{error}</span>}
      {mentionQuery !== null && filteredProjects.length > 0 && (
        <div className="absolute top-full right-4 left-4 z-10 mt-1 max-h-56 overflow-y-auto rounded border border-border bg-bg-elevated p-1 shadow-sm sm:right-auto sm:left-9 sm:w-[24rem]">
          {filteredProjects.map((project) => (
            <button
              key={project.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                chooseProject(project);
              }}
              className="block w-full rounded px-2 py-1.5 text-left text-[12px] text-fg transition-colors duration-200 ease-out motion-reduce:duration-0 hover:bg-bg"
            >
              {project.title}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
