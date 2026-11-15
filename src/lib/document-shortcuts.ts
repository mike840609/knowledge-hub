export type DocumentShortcuts = { recent: string[]; favorites: string[]; openedAt?: Record<string, string> };

export const emptyDocumentShortcuts: DocumentShortcuts = { recent: [], favorites: [] };

function uniqueKeys(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))].slice(0, limit);
}

export function parseDocumentShortcuts(raw: string | null): DocumentShortcuts {
  if (!raw) return emptyDocumentShortcuts;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return emptyDocumentShortcuts;
    const record = value as Record<string, unknown>;
    const recent = uniqueKeys(record.recent, 8);
    const openedAt = Object.fromEntries(recent.flatMap(key => {
      const value = record.openedAt && typeof record.openedAt === "object" ? (record.openedAt as Record<string, unknown>)[key] : undefined;
      return typeof value === "string" && Number.isFinite(Date.parse(value)) ? [[key, value]] : [];
    }));
    return { recent, favorites: uniqueKeys(record.favorites, 10_000), ...(Object.keys(openedAt).length ? { openedAt } : {}) };
  } catch {
    return emptyDocumentShortcuts;
  }
}

export function rememberDocument(shortcuts: DocumentShortcuts, key: string): DocumentShortcuts {
  const recent = [key, ...shortcuts.recent.filter((item) => item !== key)].slice(0, 8);
  const openedAt = Object.fromEntries(recent.flatMap(item => {
    const value = item === key ? new Date().toISOString() : shortcuts.openedAt?.[item];
    return value ? [[item, value]] : [];
  }));
  return { ...shortcuts, recent, openedAt };
}

/**
 * The document a Knowledge path is on (`/w/:workspace/knowledge/:source/:document`, and under it `/edit`
 * and the like), read from the path itself — which is there from the first render, where the page's own
 * report of what it is showing is an effect later.
 */
export function documentIdInPath(pathname: string): string | undefined {
  // The shape of an ID, not a check of one: this only takes a document out of a list, it grants nothing.
  const match = /^\/w\/[^/]+\/knowledge\/[^/]+\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(pathname);
  // Stored IDs are lower case; a path may not be.
  return match?.[1].toLowerCase();
}

/**
 * The documents to offer as recent, newest first, as IDs: what was remembered (`sourceId:documentId`),
 * without the one being read — the palette is for going somewhere else.
 */
export function recentDocumentIds(shortcuts: DocumentShortcuts, reading?: string): string[] {
  const ids: string[] = [];
  for (const key of shortcuts.recent) {
    const documentId = key.split(":")[1];
    if (documentId && documentId !== reading && !ids.includes(documentId)) ids.push(documentId);
  }
  return ids;
}

export function toggleFavoriteDocument(shortcuts: DocumentShortcuts, key: string): DocumentShortcuts {
  return {
    ...shortcuts,
    favorites: shortcuts.favorites.includes(key)
      ? shortcuts.favorites.filter((item) => item !== key)
      : [key, ...shortcuts.favorites],
  };
}
