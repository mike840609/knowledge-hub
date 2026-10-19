export type ContinueDoc = { documentId: string; sourceId: string; title: string; updatedAt: string; ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED"; sourceName?: string; sourcePath?: string | null };
export type ContinueDraft = { key: string; title: string; sourceId: string | null; updatedAt: string };
export type ContinueItem = { id: string; label: "Draft" | "Edited" | "Opened"; at?: string; doc?: ContinueDoc; draft?: ContinueDraft };

export const CONTINUE_LIMIT = 8;

/** Rank two entries for the same document: a draft always wins, then the newer time; untimed loses. */
function beats(next: ContinueItem, held: ContinueItem): boolean {
  if (held.label === "Draft") return false;
  if (next.label === "Draft") return true;
  return !!next.at && (!held.at || next.at > held.at);
}

/**
 * Home's Continue list: drafts, the user's Hub-managed edits and this device's recents, one row
 * per document, newest first. A source-managed document's `updatedAt` is written by a sync, not
 * by the user, so it never counts as Edited.
 */
export function continueItems({ documents, drafts, recent, openedAt = {} }: {
  documents: readonly ContinueDoc[]; drafts: readonly ContinueDraft[]; recent: readonly string[]; openedAt?: Readonly<Record<string, string>>;
}): ContinueItem[] {
  const active = documents.filter(d => d.status === "ACTIVE" && d.sourceStatus === "ACTIVE");
  const byId = new Map(active.map(d => [d.documentId, d]));
  const byShortcut = new Map(active.map(d => [`${d.sourceId}:${d.documentId}`, d]));
  const held = new Map<string, ContinueItem>();
  const offer = (item: ContinueItem) => {
    const current = held.get(item.id);
    if (!current || beats(item, current)) held.set(item.id, item);
  };
  // Recents first: Map keeps first-insertion order, which is the order untimed recents keep.
  for (const key of recent) {
    const doc = byShortcut.get(key);
    if (doc) offer({ id: doc.documentId, label: "Opened", at: openedAt[key], doc });
  }
  for (const doc of active) if (doc.ownership === "HUB_MANAGED") offer({ id: doc.documentId, label: "Edited", at: doc.updatedAt, doc });
  for (const draft of drafts) {
    if (draft.key === "draft:new") { offer({ id: draft.key, label: "Draft", at: draft.updatedAt, draft }); continue; }
    const doc = byId.get(draft.key.slice("draft:".length));
    if (doc) offer({ id: doc.documentId, label: "Draft", at: draft.updatedAt, doc, draft });
  }
  return [...held.values()]
    .sort((a, b) => (a.at && b.at ? b.at.localeCompare(a.at) : a.at ? -1 : b.at ? 1 : 0))
    .slice(0, CONTINUE_LIMIT);
}
