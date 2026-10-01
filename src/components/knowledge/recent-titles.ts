import { readStored, writeStored } from "@/components/shell/use-persisted-state";

/**
 * The names of the documents in the recent list, kept beside it.
 *
 * `DocumentShortcuts.recent` holds keys, which is all the sidebar needs: it has
 * the whole tree and looks the names up. The palette opens from every page,
 * including ones that have no tree, so it cannot. The sidebar writes the names
 * of what is recent here as it learns them, and the palette reads them back —
 * a hint kept in this browser, in the same place and under the same workspace
 * as the list it describes, and nothing the server has to know.
 *
 * It is a hint, not a record. A title is as old as the last time that document
 * was on screen in a tree; the link it leads to is by ID and never stale, and
 * opening it shows the document as it is.
 */
export type RecentTitle = { title: string; sourceName: string };

const keyFor = (workspaceId: string) => `kh:recent-titles:${workspaceId}`;

function parse(raw: string | null): Record<string, RecentTitle> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: Record<string, RecentTitle> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (
        entry && typeof entry === "object" &&
        typeof (entry as RecentTitle).title === "string" &&
        typeof (entry as RecentTitle).sourceName === "string"
      ) {
        result[key] = { title: (entry as RecentTitle).title, sourceName: (entry as RecentTitle).sourceName };
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function readRecentTitles(workspaceId: string): Record<string, RecentTitle> {
  return parse(readStored("local", keyFor(workspaceId)));
}

/**
 * Keeps a name for each key in `recent`, taking the fresh one where this tree
 * has it and the stored one where it does not (the document is in another
 * source's tree), and dropping everything that is no longer recent.
 */
export function rememberRecentTitles(
  workspaceId: string,
  recent: readonly string[],
  known: ReadonlyMap<string, RecentTitle>,
): void {
  const stored = readRecentTitles(workspaceId);
  const next: Record<string, RecentTitle> = {};
  for (const key of recent) {
    const entry = known.get(key) ?? stored[key];
    if (entry) next[key] = entry;
  }
  const serialised = JSON.stringify(next);
  if (serialised !== JSON.stringify(stored)) writeStored("local", keyFor(workspaceId), serialised);
}
