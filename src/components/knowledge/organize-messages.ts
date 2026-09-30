/**
 * What the reader is told when they organize: after an archive, a restore or a rename, and when the
 * server refuses (daily-driver spec §7.1, §7.3). All of it is here so it reads as one voice and so
 * that a change of wording, or of language, is a change to this file and no other.
 *
 * English, like the labels in the registry and the menus. (The composer's "已還原未存的修改。" and the
 * upload encoding error are older Chinese sentences this file does not touch.) Pure functions, no
 * React: the rules about which failure says what are the part worth testing without a browser.
 */

export const UNDO_LABEL = "Undo";

// Typographic quotes, so a title that itself holds straight quotes reads as its own.
const quote = (name: string) => `“${name}”`;

export function archivedDocument(title: string, backlinks: number | null): string {
  const base = `Archived ${quote(title)}.`;
  if (backlinks === null || backlinks <= 0) return base;
  // Links resolve only to active documents, so what pointed here now points at nothing until it is restored.
  return backlinks === 1
    ? `${base} 1 document links here; that link will stop working.`
    : `${base} ${backlinks} documents link here; those links will stop working.`;
}

export const restoredDocument = (title: string) => `Restored ${quote(title)}.`;
export const archivedFolder = (name: string) => `Archived folder ${quote(name)}.`;
export const restoredFolder = (name: string) => `Restored folder ${quote(name)}.`;
export const createdFolder = (name: string) => `Created folder ${quote(name)}.`;
export const renamedFolder = (to: string) => `Renamed to ${quote(to)}.`;

/** Where it went: into a folder, or to the top level, which has no name of its own to say. */
export const movedNode = (name: string, destination: string | null) =>
  destination === null ? `Moved ${quote(name)} to the top level.` : `Moved ${quote(name)} to ${quote(destination)}.`;

/** Said aloud after a keyboard reorder: where the node is now, among the siblings the reader can see. */
export const reorderedNode = (name: string, direction: "up" | "down", index: number, count: number) =>
  `Moved ${quote(name)} ${direction}. Position ${index + 1} of ${count}.`;

export const alreadyAtEdge = (name: string, edge: "first" | "last") => `${quote(name)} is already ${edge}.`;

/** The tree shows a filtered subset, whose neighbours are not the node's real ones. */
export const CLEAR_FILTER_TO_REORDER = "Clear the filter to reorder.";

/** The name field's own rules, said before the request is sent; the server checks the same. */
export function folderNameProblem(raw: string, maxLength: number): string | null {
  const name = raw.trim();
  if (name === "") return "Enter a folder name.";
  if (name.length > maxLength) return `That name is too long: ${maxLength} characters at most.`;
  return null;
}

/**
 * What a refusal means for the reader, by the code the server sent. Anything not listed here keeps the
 * server's own message: a sentence nobody here wrote is still more useful than "something went wrong".
 */
export function organizeFailure(failure: { code: string; message: string }): string {
  switch (failure.code) {
    case "FOLDER_NOT_EMPTY":
      return "This folder still holds documents or folders. Move or archive what's inside first, then archive it.";
    case "INVALID_PARENT":
      return "The destination folder no longer exists, or has been archived.";
    case "TREE_CYCLE":
      return "A folder can't be moved into itself or one of its subfolders.";
    case "CROSS_SOURCE_MOVE":
      return "Items can't be moved to another source.";
    case "SOURCE_MANAGED_READ_ONLY":
    case "HUB_MANAGED_OPERATION_REQUIRED":
      return "This source is managed by sync, so its content can't be changed here.";
    case "SOURCE_ARCHIVED":
      return "This source is archived and can't be changed. Restore it first.";
    case "NOT_FOUND":
      return "That item can't be found. It may have been removed, or you may no longer have access.";
    case "REQUEST_FAILED":
      return "That didn't work. Please try again.";
    default:
      return failure.message;
  }
}
