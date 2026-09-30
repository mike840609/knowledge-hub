import { parseDocumentShortcuts } from "./document-shortcuts";
import { readStored, writeStored } from "@/components/shell/use-persisted-state";
const migrations = new Map<string, Promise<void>>();
/** Import legacy browser favorites once. Existing server versions, including deletions, win. */
export function migrateLocalFavorites(workspaceId: string): Promise<void> {
  const marker = `kh:favorites-migrated:${workspaceId}`;
  if (readStored("local", marker) === "1") return Promise.resolve();
  const running = migrations.get(workspaceId); if (running) return running;
  const work = (async () => {
    const local = parseDocumentShortcuts(readStored("local", `kh:document-shortcuts:${workspaceId}`));
    const endpoint = `/api/workspaces/${workspaceId}/personal`;
    for (const favorite of local.favorites) {
      const key = `favorite:${favorite.split(":")[1]}`;
      const response = await fetch(`${endpoint}?key=${encodeURIComponent(key)}`, { cache: "no-store" });
      if ([400, 403, 404].includes(response.status)) continue;
      if (!response.ok) throw new Error("Could not migrate favorites.");
      const item = await response.json() as { version: number };
      if (item.version !== 0) continue;
      const saved = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value: { favorite: true }, version: 0 }) });
      if (!saved.ok && saved.status !== 409) throw new Error("Could not migrate favorites.");
    }
    writeStored("local", marker, "1");
  })().finally(() => migrations.delete(workspaceId));
  migrations.set(workspaceId, work); return work;
}
const writes = new Map<string, Promise<void>>();
export function pendingFavoriteWrites(workspaceId: string): Promise<void> { return writes.get(workspaceId) ?? Promise.resolve(); }
export function enqueueFavoriteWrite(workspaceId: string, work: () => Promise<void>): Promise<void> {
  const next = pendingFavoriteWrites(workspaceId).catch(() => {}).then(work);
  writes.set(workspaceId, next);
  void next.finally(() => { if (writes.get(workspaceId) === next) writes.delete(workspaceId); }).catch(() => {});
  return next;
}
