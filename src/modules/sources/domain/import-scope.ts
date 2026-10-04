import { importError } from "./import-errors";

export type ImportScope = { paths: string[]; previousPaths: string[]; excludedCount: number };
/** Shared by browser and server. Scope is a content selection rule, never authorization. */
export function parseExcludedPaths(text: string): string[] {
  const rules = [...new Set(text.split(/\r?\n/).map(line => line.trim().replace(/\\/g, "/").replace(/\/+$/, "")).filter(Boolean))];
  if (rules.length > 50) throw importError("INVALID_IMPORT_MANIFEST", "Use at most 50 excluded paths.");
  for (const rule of rules) {
    if (rule.length > 1024 || rule.startsWith("/") || rule.split("/").some(part => !part || part === "." || part === "..") || /[*?\[\]:\u0000-\u001f\u007f]/.test(rule))
      throw importError("INVALID_IMPORT_MANIFEST", "Use relative file or folder paths, without wildcards or .. segments.");
  }
  return rules;
}
export function isExcludedImportPath(path: string, rules: readonly string[]): boolean {
  if (path.split("/").some(part => part === ".git" || part === ".obsidian")) return true;
  return rules.some(rule => path === rule || path.startsWith(`${rule}/`));
}
export function normalizeImportScope(raw: unknown, previousPaths: readonly string[]): ImportScope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw importError("INVALID_IMPORT_MANIFEST", "Provide import scope settings.");
  const { paths, excludedCount } = raw as Record<string, unknown>;
  if (!Array.isArray(paths) || paths.length > 50 || paths.some(p => typeof p !== "string" || p.includes("\n") || p.includes("\r"))) throw importError("INVALID_IMPORT_MANIFEST", "Provide up to 50 excluded paths.");
  if (!Number.isSafeInteger(excludedCount) || Number(excludedCount) < 0 || Number(excludedCount) > 1000000) throw importError("INVALID_IMPORT_MANIFEST", "Invalid excluded file count.");
  return { paths: parseExcludedPaths(paths.join("\n")), previousPaths: [...previousPaths], excludedCount: Number(excludedCount) };
}
