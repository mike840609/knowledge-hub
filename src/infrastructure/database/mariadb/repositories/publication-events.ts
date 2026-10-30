import type {
  PublicationEventInput,
  PublicationEventRepository,
} from "@/modules/knowledge/ports/publication-event-repository";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { QueryConnection } from "./shared";
import { valueRows } from "./shared";

export class MariaDbPublicationEventRepository implements PublicationEventRepository {
  constructor(private readonly connection: QueryConnection) {}

  async record(event: PublicationEventInput): Promise<void> {
    await this.connection.query(
      `INSERT INTO publication_events (id, document_id, tree_node_id, source_id, kind, revision_id, created_at, consumed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      [uuidv7(), event.documentId, event.treeNodeId, event.sourceId ?? null, event.kind, event.revisionId ?? null, event.at],
    );
  }

  async recordMany(events: readonly PublicationEventInput[]): Promise<void> {
    if (events.length === 0) return;
    await this.connection.query(
      `INSERT INTO publication_events (id, document_id, tree_node_id, source_id, kind, revision_id, created_at, consumed_at)
       VALUES ${valueRows(events.length, 8)}`,
      events.flatMap((event) => [
        uuidv7(), event.documentId, event.treeNodeId, event.sourceId ?? null, event.kind, event.revisionId ?? null, event.at, null,
      ]),
    );
  }
}
