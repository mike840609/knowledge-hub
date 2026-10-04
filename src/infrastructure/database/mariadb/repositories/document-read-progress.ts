import type { DocumentReadProgress } from "@/modules/personal/domain/document-read-progress";
import type { DocumentReadProgressRepository } from "@/modules/personal/ports/document-read-progress-repository";
import { asDate, asNumber, type DbRow, type QueryConnection } from "./shared";
export class MariaDbDocumentReadProgressRepository
  implements DocumentReadProgressRepository
{
  constructor(private readonly connection: QueryConnection) {}
  async advance(progress: DocumentReadProgress): Promise<void> {
    await this.connection.query(
      `INSERT INTO document_read_progress (user_id,workspace_id,document_id,revision_id,revision_no,read_at) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
       revision_id=IF(VALUES(revision_no)>revision_no,VALUES(revision_id),revision_id),
       read_at=IF(VALUES(revision_no)>revision_no,VALUES(read_at),read_at),
       revision_no=GREATEST(revision_no,VALUES(revision_no))`,
      [
        progress.userId,
        progress.workspaceId,
        progress.documentId,
        progress.revisionId,
        progress.revisionNo,
        progress.readAt,
      ],
    );
  }
  async getMany(
    userId: string,
    workspaceId: string,
    documentIds: string[],
  ): Promise<DocumentReadProgress[]> {
    if (!documentIds.length) return [];
    const result: DocumentReadProgress[] = [];
    for (let offset = 0; offset < documentIds.length; offset += 500) {
      const ids = documentIds.slice(offset, offset + 500);
      const rows = await this.connection.query<DbRow[]>(
        `SELECT * FROM document_read_progress WHERE user_id=? AND workspace_id=? AND document_id IN (${ids.map(() => "?").join(",")})`,
        [userId, workspaceId, ...ids],
      );
      result.push(
        ...rows.map((row) => ({
          userId: String(row.user_id),
          workspaceId: String(row.workspace_id),
          documentId: String(row.document_id),
          revisionId: String(row.revision_id),
          revisionNo: asNumber(row.revision_no, "read revision"),
          readAt: asDate(row.read_at),
        })),
      );
    }
    return result;
  }
}
