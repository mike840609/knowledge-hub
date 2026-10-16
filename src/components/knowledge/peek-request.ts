/**
 * Asking for the side-peek drawer, the way the share dialog and the move dialog are asked for: any
 * surface — a row's menu — dispatches this, and the one dialog the knowledge layout mounts answers.
 * Its own module so the runner that dispatches and the dialog that listens do not import each other.
 */
export const PEEK_REQUEST_EVENT = "kh:request-peek";

export type PeekRequest = {
  documentId: string;
  sourceId: string;
};

export function requestPeek(request: PeekRequest): void {
  window.dispatchEvent(new CustomEvent<PeekRequest>(PEEK_REQUEST_EVENT, { detail: request }));
}
