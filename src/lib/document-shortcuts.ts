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
    return { recent: uniqueKeys(record.recent, 8), favorites: uniqueKeys(record.favorites, 8) };
  } catch {
    return emptyDocumentShortcuts;
  }
}

export function rememberDocument(shortcuts: DocumentShortcuts, key: string): DocumentShortcuts {
  return { ...shortcuts, recent: [key, ...shortcuts.recent.filter((item) => item !== key)].slice(0, 8) };
}

export function toggleFavoriteDocument(shortcuts: DocumentShortcuts, key: string): DocumentShortcuts {
  return {
    ...shortcuts,
    favorites: shortcuts.favorites.includes(key)
      ? shortcuts.favorites.filter((item) => item !== key)
      : [key, ...shortcuts.favorites].slice(0, 8),
  };
}
