import { RECOVERY_SUFFIX } from "./recovered-title";

/** Download Markdown as a file; one implementation for recovered drafts and the editor. */
export function downloadMarkdown(title: string, markdown: string, options?: { recovery?: boolean }): void {
  const safe = (title || "recovered-document").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  const encoder = new TextEncoder();
  let name = "";
  let bytes = 0;
  for (const character of safe) {
    bytes += encoder.encode(character).length;
    if (bytes > 180 || name.length + character.length > 120) break;
    name += character;
  }
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name || "recovered-document"}${options?.recovery ? RECOVERY_SUFFIX : ".md"}`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
