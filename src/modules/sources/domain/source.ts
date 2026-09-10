import type { SourceOwnership, SourceType } from "@/modules/knowledge/domain/source-policy";

export type KnowledgeSource = {
  id: string;
  name: string;
  workspaceId: string;
  sourceType: SourceType;
  ownership: SourceOwnership;
  status: "ACTIVE" | "ARCHIVED";
  syncVersion: number;
  createdBy: string;
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
