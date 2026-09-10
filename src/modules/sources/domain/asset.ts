export type KnowledgeAsset = {
  id: string;
  sourceId: string;
  sourcePath: string;
  mimeType: string | null;
  contentHash: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};
