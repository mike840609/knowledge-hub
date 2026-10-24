/** Download Markdown as a file; one implementation for recovered drafts and the editor. */
export function downloadMarkdown(title: string, markdown: string): void {
  const name = (title || "recovered-document").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 120);
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}.md`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
