import type { ImportDiagnostic } from "./import-diagnostic";
import { importError } from "./import-errors";

export type ImportTitleSource = "FRONTMATTER" | "H1" | "FILENAME";

export function resolveImportTitle(input: {
  sourcePath: string;
  frontmatterTitle: unknown;
  firstH1: string | null;
}): { title: string; source: ImportTitleSource; diagnostics: ImportDiagnostic[] } {
  const diagnostics: ImportDiagnostic[] = [];
  const frontmatterTitle = typeof input.frontmatterTitle === "string" ? input.frontmatterTitle.trim() : "";

  if (input.frontmatterTitle !== undefined && !frontmatterTitle) {
    diagnostics.push({
      code: "INVALID_FRONTMATTER_TITLE",
      severity: "WARNING",
      sourcePath: input.sourcePath,
      message: "frontmatter.title must be a non-empty string; falling back.",
    });
  }

  const h1 = input.firstH1?.trim() || null;
  if (frontmatterTitle) {
    if (h1 && h1 !== frontmatterTitle) {
      diagnostics.push({
        code: "TITLE_CONFLICT",
        severity: "WARNING",
        sourcePath: input.sourcePath,
        message: "frontmatter.title differs from the first H1; frontmatter.title wins.",
        details: { frontmatterTitle, h1 },
      });
    }
    return { title: frontmatterTitle, source: "FRONTMATTER", diagnostics };
  }

  if (h1) return { title: h1, source: "H1", diagnostics };

  const filename = input.sourcePath.split("/").at(-1) ?? "";
  const stem = filename.replace(/\.(?:md|markdown)$/iu, "").trim();
  if (!stem) {
    throw importError("INVALID_TITLE", "Markdown file could not resolve a non-empty title.");
  }
  return { title: stem, source: "FILENAME", diagnostics };
}
