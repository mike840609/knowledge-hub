import { DomainError } from "@/shared/domain/errors";

export type ImportPreviewPageErrorState = "NOT_FOUND" | "ACCESS_DENIED";

/**
 * Browser-only presentation mapping. Keep unexpected errors unclassified so
 * the route rethrows them into the existing error boundary.
 */
export function classifyImportPreviewPageError(error: unknown): ImportPreviewPageErrorState | null {
  if (!(error instanceof DomainError)) return null;
  if (error.code === "IMPORT_SNAPSHOT_NOT_FOUND") return "NOT_FOUND";
  if (error.code === "IMPORT_SNAPSHOT_ACCESS_DENIED") return "ACCESS_DENIED";
  return null;
}
