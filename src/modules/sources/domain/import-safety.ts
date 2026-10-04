export type ImportSafetySummary = {
  previousDocuments: number;
  incomingDocuments: number;
  matchedDocuments: number;
  archivedDocuments: number;
  archiveRatio: number;
  highRisk: boolean;
  reasons: (
    | "EMPTY_INPUT"
    | "COMPLETE_ARCHIVE"
    | "MASS_ARCHIVE"
    | "LOW_OVERLAP"
  )[];
};
export type ImportRiskAcknowledgment = { planHash: string; sourceName: string };
export function assessImportSafety(input: {
  previousDocuments: number;
  incomingDocuments: number;
  matchedDocuments: number;
  archivedDocuments: number;
}): ImportSafetySummary {
  const {
    previousDocuments,
    incomingDocuments,
    matchedDocuments,
    archivedDocuments,
  } = input;
  const archiveRatio = previousDocuments
    ? archivedDocuments / previousDocuments
    : 0;
  const reasons: ImportSafetySummary["reasons"] = [];
  if (previousDocuments > 0 && incomingDocuments === 0)
    reasons.push("EMPTY_INPUT");
  if (previousDocuments > 0 && archivedDocuments >= previousDocuments)
    reasons.push("COMPLETE_ARCHIVE");
  if (archivedDocuments >= 5 && archiveRatio >= 0.3)
    reasons.push("MASS_ARCHIVE");
  if (
    previousDocuments >= 5 &&
    matchedDocuments / previousDocuments < 0.2 &&
    archivedDocuments > 0
  )
    reasons.push("LOW_OVERLAP");
  return { ...input, archiveRatio, highRisk: reasons.length > 0, reasons };
}
