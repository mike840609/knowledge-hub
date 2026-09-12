import { createHash } from "node:crypto";
import { importError } from "./import-errors";

const CONTROL = /[\u0000-\u001f\u007f]/u;
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u;

export function compareImportText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function normalizeImportPath(rawPath: string): { sourcePath: string; sourcePathHash: string } {
  if (
    !rawPath ||
    rawPath.startsWith("/") ||
    rawPath.startsWith("\\") ||
    WINDOWS_ABSOLUTE.test(rawPath) ||
    CONTROL.test(rawPath)
  ) {
    throw importError("INVALID_SOURCE_PATH", "Source paths must be safe relative paths.");
  }

  const parts: string[] = [];
  for (const part of rawPath.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      throw importError("INVALID_SOURCE_PATH", "Source paths cannot escape the selected folder.");
    }
    parts.push(part);
  }

  if (parts.length === 0) {
    throw importError("INVALID_SOURCE_PATH", "Source path cannot be empty.");
  }

  const sourcePath = parts.join("/");
  const sourcePathHash = createHash("sha256").update(sourcePath, "utf8").digest("hex");
  return { sourcePath, sourcePathHash };
}

export function isIgnoredImportPath(path: string): boolean {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const leaf = parts.at(-1);
  return parts.some((part) => part.startsWith(".")) || parts.includes("node_modules") || leaf === "Thumbs.db";
}
