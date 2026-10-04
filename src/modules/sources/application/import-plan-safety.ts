import type { SourceRepositories } from "../ports/unit-of-work";
import type { FolderImportPlan } from "../domain/import-plan";
import { assessImportSafety } from "../domain/import-safety";
export async function safetyForPlan(
  r: SourceRepositories,
  sourceId: string | null,
  plan: FolderImportPlan,
) {
  const previousDocuments = sourceId
    ? await r.entries.countActiveDocuments(sourceId)
    : 0;
  const archivedDocuments = plan.documents.archive.length;
  const incomingDocuments = plan.preview.filter(
    (c) =>
      c.kind === "DOCUMENT" &&
      !c.labels.includes("ARCHIVED") &&
      !c.labels.includes("REMOVED"),
  ).length;
  return assessImportSafety({
    previousDocuments,
    incomingDocuments,
    archivedDocuments,
    matchedDocuments: Math.max(0, previousDocuments - archivedDocuments),
  });
}
