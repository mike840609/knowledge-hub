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

/** A plain click on a link out of the peek leaves it, so the page it opens is not shown beside a stale peek. */
export function leavesPeek(event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; button: number }): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}
