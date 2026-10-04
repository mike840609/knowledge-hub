import { readExcludedPaths, parseExcludedPaths } from "./import-exclusions";
export type SavedImportScope = { paths: string[]; configured: boolean; syncVersion: number; legacyPaths?: string[] };
export async function loadSourceImportScope(workspaceId: string, sourceId: string, signal?: AbortSignal): Promise<SavedImportScope> {
  const response = await fetch(`/api/sources/${sourceId}/import-scope`, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message ?? "Could not load source exclusions. No files were uploaded.");
  if (!Array.isArray(data.paths) || typeof data.configured !== "boolean" || !Number.isSafeInteger(data.syncVersion)) throw new Error("Source exclusions could not be confirmed. No files were uploaded.");
  const paths = parseExcludedPaths(data.paths.join("\n"));
  let legacyPaths: string[] | undefined;
  if (!data.configured) { try { legacyPaths = readExcludedPaths(workspaceId, sourceId); } catch { /* Optional legacy settings never block authoritative settings. */ } }
  return { ...data, paths, legacyPaths };
}
