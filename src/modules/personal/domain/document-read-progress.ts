export type DocumentReadProgress = {
  userId: string; workspaceId: string; documentId: string;
  revisionId: string; revisionNo: number; readAt: Date;
};
