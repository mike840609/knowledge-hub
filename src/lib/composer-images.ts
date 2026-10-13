/** What a pasted or dropped image is called in the page: its file name without the extension. */
export function imageAlt(file: { name: string }): string {
  const name = file.name.replace(/\.[^.]*$/, "").replace(/\s+/g, " ").trim();
  // A clipboard image has no name of its own; browsers call it "image".
  return name && name.toLowerCase() !== "image" ? name : "Pasted image";
}

/** `![alt](src)`, with the characters that would end the alt early escaped. */
export function imageMarkdown(alt: string, src: string): string {
  return `![${alt.replace(/[\\[\]]/g, "\\$&")}](${src})`;
}

/** Puts `insertion` in place of the selection, as a line of its own when it lands inside one. */
export function insertAtCaret(text: string, start: number, end: number, insertion: string): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after === "" || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const inserted = `${lead}${insertion}${trail}`;
  return { text: `${before}${inserted}${after}`, caret: before.length + lead.length + insertion.length };
}

/**
 * Where the editor loads a page's image from. Only a path is sent to the route: a URL is left as
 * written, for the image policy to judge. With no Source yet (nothing uploaded, nothing saved),
 * there is nowhere to ask.
 */
export function editorImageUrl(sourceId: string | null, src: string): string {
  if (!sourceId || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src.trim())) return src;
  return `/api/sources/${sourceId}/asset?src=${encodeURIComponent(src)}`;
}

/** Why an image was not added, in the reader's words. Nothing was changed in any of these. */
export function imageUploadFailure(status: number, code: string | undefined): string {
  if (code === "IMAGE_TOO_LARGE" || status === 413) return "That image is larger than 10 MiB and was not added.";
  if (code === "IMAGE_STORAGE_UNAVAILABLE" || status === 503) return "Image storage is unavailable right now, so the image was not added. Your text is safe; try again shortly.";
  if (code === "IMAGE_STORAGE_NOT_CONFIGURED") return "This server does not store images.";
  if (status === 400) return "Only PNG, JPEG, GIF, WebP and AVIF images can be added.";
  if (status === 401 || status === 403 || status === 404) return "You cannot add images here.";
  return "The image could not be added. Try again.";
}

export function imageFilesOf(transfer: DataTransfer | null): File[] {
  return Array.from(transfer?.files ?? []).filter((file) => file.type.startsWith("image/"));
}
