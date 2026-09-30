/**
 * An unsaved composer draft, kept in this tab's sessionStorage (composer spec
 * §5). A draft is never a revision: it lives only in the browser, and any
 * failure to read or write it means "no draft", never an error.
 */
/**
 * `title` is the title a new document was started from (a broken link's): such a document is not the
 * blank one, and a draft left by that one must not stand in for it, nor its draft for the blank one's.
 */
export type DraftKey = { kind: "edit"; documentId: string } | { kind: "new"; workspaceId: string; title?: string };
export type Draft = { title: string; markdown: string; baseRevisionId: string | null };
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const VERSION = 1;

export function draftStorageKey(key: DraftKey): string {
  if (key.kind === "edit") return `kh:draft:edit:${key.documentId}`;
  return key.title === undefined ? `kh:draft:new:${key.workspaceId}` : `kh:draft:new:${key.workspaceId}:${encodeURIComponent(key.title)}`;
}

export function readDraft(storage: DraftStorage | null, key: DraftKey): Draft | null {
  try {
    const raw = storage?.getItem(draftStorageKey(key));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isStoredDraft(value) ? { title: value.title, markdown: value.markdown, baseRevisionId: value.baseRevisionId } : null;
  } catch {
    return null;
  }
}

/** Keeps the draft while it differs from what the composer opened with, and removes it once it does not. */
export function syncDraft(storage: DraftStorage | null, key: DraftKey, draft: Draft, initial: { title: string; markdown: string }): void {
  if (draft.title === initial.title && draft.markdown === initial.markdown) {
    clearDraft(storage, key);
    return;
  }
  try {
    storage?.setItem(draftStorageKey(key), JSON.stringify({ v: VERSION, ...draft }));
  } catch {
    // Over quota, or storage refused: the draft is simply not kept.
  }
}

export function clearDraft(storage: DraftStorage | null, key: DraftKey): void {
  try {
    storage?.removeItem(draftStorageKey(key));
  } catch {
    // Nothing to clear if storage cannot be reached.
  }
}

/** The tab's sessionStorage, or null where there is none (server) or it is refused (some private modes). */
export function browserDraftStorage(): DraftStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isStoredDraft(value: unknown): value is Draft & { v: number } {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    record.v === VERSION &&
    typeof record.title === "string" &&
    typeof record.markdown === "string" &&
    (record.baseRevisionId === null || typeof record.baseRevisionId === "string")
  );
}
