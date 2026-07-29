/** Todoist's own scale: p1 is the most urgent, p4 the least. */
export type QuickAddPriority = 1 | 2 | 3 | 4;

/**
 * Pulls a standalone `p1`-`p4` (or `!1`-`!4`) token out of quick-add text.
 *
 * The token has to stand alone so ordinary words survive: "stop 15 min" and
 * "op1 review" keep their text and report no priority.
 */
export function extractPriority(s: string): {
  text: string;
  priority: QuickAddPriority | null;
} {
  const m = s.match(/(^|\s)(?:p|!)([1-4])(?=\s|$)/i);
  if (!m) return { text: s.trim(), priority: null };

  const text = s.replace(m[0], " ").replace(/\s+/g, " ").trim();
  return { text, priority: Number(m[2]) as QuickAddPriority };
}

/** Quick-add's p1-p4 to the Todoist API's inverted 1-4 scale. */
export function toTodoistApiPriority(priority: QuickAddPriority): number {
  return 5 - priority;
}

export function extractProject(s: string): { text: string; projectName: string | null } {
  const bracket = s.match(/(^|\s)@\{([^}]+)\}/);
  if (bracket) {
    const projectName = bracket[2].trim();
    const text = s.replace(bracket[0], "").trim();
    return { text, projectName: projectName || null };
  }
  const m = s.match(/(^|\s)@([\w-]+)/);
  if (!m) return { text: s.trim(), projectName: null };
  const projectName = m[2].replace(/-/g, " ").trim();
  const text = s.replace(m[0], "").trim();
  return { text, projectName };
}
