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
/**
 * Paths no folder import ever reads (Phase 2 spec §6.2): any hidden segment
 * (`.git`, `.obsidian`, `.trash`, `.DS_Store`), `node_modules`, `Thumbs.db`.
 * Kept here, free of `node:crypto`, so the browser drops them before reading,
 * hashing or counting a file and the server applies the same rule.
 */
export function isIgnoredImportPath(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const leaf = parts.at(-1);
  return parts.some((part) => part.startsWith(".")) || parts.includes("node_modules") || leaf === "Thumbs.db";
}
/** Only the source's own excluded-path rules, without the built-in ignore rule. */
export function matchesExcludedRule(path: string, rules: readonly string[]): boolean {
  return rules.some(rule => path === rule || path.startsWith(`${rule}/`));
}
export function isExcludedImportPath(path: string, rules: readonly string[]): boolean {
  return isIgnoredImportPath(path) || matchesExcludedRule(path, rules);
}
export function normalizeImportScope(raw: unknown, previousPaths: readonly string[]): ImportScope {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw importError("INVALID_IMPORT_MANIFEST", "Provide import scope settings.");
  const { paths, excludedCount } = raw as Record<string, unknown>;
  if (!Array.isArray(paths) || paths.length > 50 || paths.some(p => typeof p !== "string" || p.includes("\n") || p.includes("\r"))) throw importError("INVALID_IMPORT_MANIFEST", "Provide up to 50 excluded paths.");
  if (!Number.isSafeInteger(excludedCount) || Number(excludedCount) < 0 || Number(excludedCount) > 1000000) throw importError("INVALID_IMPORT_MANIFEST", "Invalid excluded file count.");
  return { paths: parseExcludedPaths(paths.join("\n")), previousPaths: [...previousPaths], excludedCount: Number(excludedCount) };
}
