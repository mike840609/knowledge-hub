export const SOURCE_ENTRY_TYPES = ["FOLDER", "DOCUMENT"] as const;
export type SourceEntryType = (typeof SOURCE_ENTRY_TYPES)[number];

export type SourceEntry = {
  id: string;
  sourceId: string;
  externalId: string | null;
  sourcePath: string;
  entryType: SourceEntryType;
  contentHash: string | null;
  documentId: string | null;
  treeNodeId: string | null;
  status: "ACTIVE" | "ARCHIVED";
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};
