export type ContinueDoc = { documentId: string; sourceId: string; title: string; updatedAt: string; ownership: "SOURCE_MANAGED" | "HUB_MANAGED"; status: "ACTIVE" | "ARCHIVED"; sourceStatus: "ACTIVE" | "ARCHIVED"; sourceName?: string; sourcePath?: string | null; pageIcon?: string | null };
export type ContinueDraft = { key: string; title: string; sourceId: string | null; updatedAt: string };

/**
 * The documents Home actually needs in its client props: every active document,
 * plus only those archived documents that have a draft to recover. Sending every
 * archived document makes the Home payload grow with the archive, not with the
 * work the reader can still resume.
 */
export function documentsForHome(
  documents: readonly ContinueDoc[],
  drafts: readonly ContinueDraft[],
): ContinueDoc[] {
  const draftIds = new Set(drafts.flatMap(draft => draft.key.startsWith("draft:") ? [draft.key.slice("draft:".length)] : []));
  return documents.filter(document => (document.status === "ACTIVE" && document.sourceStatus === "ACTIVE") || draftIds.has(document.documentId));
}
export type DraftItem = { id: string; at: string; draft: ContinueDraft; doc?: ContinueDoc };
export type RecentItem = { id: string; label: "Edited" | "Opened"; at?: string; doc: ContinueDoc };

/** Recent keeps this many rows; Home shows the first `RECENT_SHOWN` and the rest behind "Show more". */
export const RECENT_LIMIT = 16;
export const RECENT_SHOWN = 8;

/**
 * Home's two work lists. Drafts are unfinished work and are listed whole, newest first, so an old
 * one never sinks below newer edits; a draft whose document or source is archived stays here so the
 * reader can recover it. Recent holds the user's Hub-managed edits and this device's opens, one row
 * per active document, newest first; a document with a draft is shown under Drafts only. A
 * source-managed document's `updatedAt` is written by a sync, not by the user, so it never counts
 * as Edited.
 */
export function homeLists({ documents, drafts, recent, openedAt = {} }: {
  documents: readonly ContinueDoc[]; drafts: readonly ContinueDraft[]; recent: readonly string[]; openedAt?: Readonly<Record<string, string>>;
}): { drafts: DraftItem[]; recent: RecentItem[] } {
  const active = documents.filter(d => d.status === "ACTIVE" && d.sourceStatus === "ACTIVE");
  const byShortcut = new Map(active.map(d => [`${d.sourceId}:${d.documentId}`, d]));
  const all = new Map(documents.map(d => [d.documentId, d]));

  // ponytail: every draft is listed, as the old Drafts tab did; cap it if drafts pile up.
  // A draft whose document or source is archived stays here so the reader can recover it;
  // Recents and Favorites still use the active maps above.
  const draftItems: DraftItem[] = [];
  for (const draft of drafts) {
    if (draft.key === "draft:new") { draftItems.push({ id: draft.key, at: draft.updatedAt, draft }); continue; }
    const doc = all.get(draft.key.slice("draft:".length));
    if (doc) draftItems.push({ id: doc.documentId, at: draft.updatedAt, draft, doc });
  }
  draftItems.sort((a, b) => b.at.localeCompare(a.at));

  const drafted = new Set(draftItems.map(item => item.id));
  const held = new Map<string, RecentItem>();
  const offer = (item: RecentItem) => {
    if (drafted.has(item.id)) return;
    const current = held.get(item.id);
    if (!current || (!!item.at && (!current.at || item.at > current.at))) held.set(item.id, item);
  };
  // Recents first: Map keeps first-insertion order, which is the order untimed recents keep.
  for (const key of recent) {
    const doc = byShortcut.get(key);
    if (doc) offer({ id: doc.documentId, label: "Opened", at: openedAt[key], doc });
  }
  for (const doc of active) if (doc.ownership === "HUB_MANAGED") offer({ id: doc.documentId, label: "Edited", at: doc.updatedAt, doc });
  const recentItems = [...held.values()]
    .sort((a, b) => (a.at && b.at ? b.at.localeCompare(a.at) : a.at ? -1 : b.at ? 1 : 0))
    .slice(0, RECENT_LIMIT);

  return { drafts: draftItems, recent: recentItems };
}
