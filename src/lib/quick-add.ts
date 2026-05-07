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
