/**
 * Asking for the folder-name dialog, the way the share dialog is asked for: any surface — a row's menu,
 * the palette, the sidebar — dispatches this, and the one dialog the knowledge layout mounts answers.
 * Its own module so the runner that dispatches and the dialog that listens do not import each other.
 */
export const FOLDER_NAME_REQUEST_EVENT = "kh:request-folder-name";

export type FolderNameRequest =
  /** A new folder: at the top of the Notes source when `parentId` is null, inside that folder otherwise. */
  | { mode: "create"; sourceId: string | null; parentId: string | null; parentLabel: string | null }
  | { mode: "rename"; nodeId: string; name: string };

export function requestFolderName(request: FolderNameRequest): void {
  window.dispatchEvent(new CustomEvent<FolderNameRequest>(FOLDER_NAME_REQUEST_EVENT, { detail: request }));
}
