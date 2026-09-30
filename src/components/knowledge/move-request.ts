/**
 * Asking for the move dialog, the way the share dialog and the folder-name dialog are asked for: any
 * surface — a row's menu, the palette — dispatches this, and the one dialog the knowledge layout mounts
 * answers. Its own module so the runner that dispatches and the dialog that listens do not import each
 * other.
 *
 * A document is named by its `documentId`, which is all the palette has for the page being read; the
 * dialog finds its place in the tree from that. A folder is a tree node and is named by that.
 */
export const MOVE_REQUEST_EVENT = "kh:request-move";

export type MoveRequest = {
  sourceId: string;
  /** What the reader calls it: the document's title, the folder's name. */
  label: string;
  node: { type: "document"; documentId: string } | { type: "folder"; nodeId: string };
};

export function requestMove(request: MoveRequest): void {
  window.dispatchEvent(new CustomEvent<MoveRequest>(MOVE_REQUEST_EVENT, { detail: request }));
}

/**
 * Asking the tree to open a folder, which is how a node put inside one is seen where it went rather
 * than hidden in a folder that was collapsed. The tree that has the folder answers; any other ignores it.
 */
export const REVEAL_FOLDER_EVENT = "kh:reveal-folder";

export function requestRevealFolder(folderId: string): void {
  window.dispatchEvent(new CustomEvent<{ folderId: string }>(REVEAL_FOLDER_EVENT, { detail: { folderId } }));
}
