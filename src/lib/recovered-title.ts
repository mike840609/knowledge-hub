/** A portable marker for an independent title that cannot safely fit in a file name. */
const marker = /^((?:[ \t]*\r?\n)*)<!-- knowledge-hub-recovery-title:v1:([^\s]+) -->\r?\n/;

export const RECOVERY_SUFFIX = ".kh-recovery.md";

/** Browsers commonly append " (1)" before the last extension for duplicate downloads. */
export function isRecoveryFilename(path: string): boolean {
  return /\.kh-recovery(?: \(\d+\))?\.md$/i.test(path);
}

export function addRecoveredTitle(markdown: string, title: string): string {
  return `<!-- knowledge-hub-recovery-title:v1:${encodeURIComponent(JSON.stringify(title))} -->\n${markdown}`;
}

/** Unrecognised or malformed markers remain untouched as ordinary Markdown. */
export function readRecoveredTitle(markdown: string): { markdown: string; title: string | null } {
  const match = marker.exec(markdown);
  if (!match) return { markdown, title: null };
  try {
    const title: unknown = JSON.parse(decodeURIComponent(match[2]));
    if (typeof title !== "string" || !title.trim() || title.length > 512 || title !== title.trim()) return { markdown, title: null };
    return { markdown: match[1] + markdown.slice(match[0].length), title };
  } catch {
    return { markdown, title: null };
  }
}
