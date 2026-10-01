export type DocumentShortcuts = { recent: string[]; favorites: string[] };

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
    return { recent: uniqueKeys(record.recent, 8), favorites: uniqueKeys(record.favorites, 10_000) };
  } catch {
    return emptyDocumentShortcuts;
  }
}

export function rememberDocument(shortcuts: DocumentShortcuts, key: string): DocumentShortcuts {
  return { ...shortcuts, recent: [key, ...shortcuts.recent.filter((item) => item !== key)].slice(0, 8) };
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

/** How many favourites the sidebar lists in place; the rest are behind "Show all". */
export const FAVORITES_SHOWN = 4;

/**
 * The favourites to list in place — the newest few — and, when there are more than that, the number on the
 * "Show all" row: how many there are in all, not how many are behind it.
 */
export function favoritesInPlace(favorites: readonly string[]): { inPlace: string[]; showAll: number | null } {
  return {
    inPlace: favorites.slice(0, FAVORITES_SHOWN),
    showAll: favorites.length > FAVORITES_SHOWN ? favorites.length : null,
  };
}

export function toggleFavoriteDocument(shortcuts: DocumentShortcuts, key: string): DocumentShortcuts {
  return {
    ...shortcuts,
    favorites: shortcuts.favorites.includes(key)
      ? shortcuts.favorites.filter((item) => item !== key)
      : [key, ...shortcuts.favorites],
  };
}
