"use client";

import { useEffect } from "react";
import { isEditableTarget } from "@/lib/utils";

function isVisible(el: HTMLElement): boolean {
  return el.offsetParent !== null;
}

function firstFocusable(section: HTMLElement): HTMLElement | null {
  const target = section.querySelector<HTMLElement>("[data-task-focus-target]");
  if (target && isVisible(target)) return target;
  const fallback = section.querySelector<HTMLElement>(
    "button, [tabindex]:not([tabindex='-1'])",
  );
  return fallback && isVisible(fallback) ? fallback : null;
}

export function TaskSectionShortcut() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (!e.shiftKey) return;
      if (e.key !== "T" && e.key !== "t") return;
      if (isEditableTarget(e.target)) return;

      const sections = Array.from(
        document.querySelectorAll<HTMLElement>("[data-task-section]"),
      ).filter(isVisible);
      if (sections.length === 0) return;

      e.preventDefault();

      const active = document.activeElement as HTMLElement | null;
      const currentSection = active?.closest<HTMLElement>("[data-task-section]") ?? null;
      const currentIndex = currentSection ? sections.indexOf(currentSection) : -1;

      let targetSection: HTMLElement;
      if (currentIndex === -1 || sections.length === 1) {
        targetSection = sections[0];
      } else {
        targetSection = sections[(currentIndex + 1) % sections.length];
      }

      const focusTarget = firstFocusable(targetSection);
      focusTarget?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
