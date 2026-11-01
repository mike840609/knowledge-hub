import type {
  PublicationEventInput,
  PublicationEventRepository,
} from "@/modules/knowledge/ports/publication-event-repository";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type { QueryConnection } from "./shared";
import { insertBatches, valueRows } from "./shared";

/**
 * Upper bound for one bound event row: three UUIDs plus the revision id, the
 * kind, the timestamp and the driver's protocol overhead. The schema fixes the
 * rest (ids are UUIDs, `kind` is 16 characters), so a constant is enough.
 */
const EVENT_ROW_BYTES = 256;

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
    // One Apply can project thousands of documents in a single transaction;
    // chunk like every other bulk insert so event bookkeeping can never fail
    // the user's import with `ER_NET_PACKET_TOO_LARGE`.
    for (const batch of insertBatches(events, () => EVENT_ROW_BYTES)) {
      await this.connection.query(
        `INSERT INTO publication_events (id, document_id, tree_node_id, source_id, kind, revision_id, created_at, consumed_at)
         VALUES ${valueRows(batch.length, 8)}`,
        batch.flatMap((event) => [
          uuidv7(), event.documentId, event.treeNodeId, event.sourceId ?? null, event.kind, event.revisionId ?? null, event.at, null,
        ]),
      );
    }
  }
}
