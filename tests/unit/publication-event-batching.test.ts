import { describe, expect, it, vi } from "vitest";
import type { PublicationEventInput } from "@/modules/knowledge/ports/publication-event-repository";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";
import { MariaDbPublicationEventRepository } from "@/infrastructure/database/mariadb/repositories/publication-events";

/**
 * A folder Apply projects many documents in one transaction. Its events are
 * written with `recordMany`, so the statement has to be chunked exactly like
 * the revision bulk insert it accompanies (`repositories/revisions.ts`):
 * one multi-row INSERT per batch, well under MariaDB's `max_allowed_packet`.
 * A single 20 000-row statement would fail the whole import with
 * `ER_NET_PACKET_TOO_LARGE`.
 */
function fakeConnection() {
  // Typed like `DatabaseConnection.query`, so the recorded calls are
  // `[sql, parameters]` pairs rather than an untyped tuple list.
  type Query = (sql: string, parameters: readonly unknown[]) => Promise<unknown>;
  const query = vi.fn<Query>().mockResolvedValue([]);
  return { query, connection: { query } as unknown as QueryConnection };
}

const DOCUMENT_ID = "0199f400-0000-7000-8000-0000000007a1";
const REVISION_ID = "0199f400-0000-7000-8000-0000000007a2";
const now = new Date("2026-10-31T00:00:00Z");

function events(count: number): PublicationEventInput[] {
  return Array.from({ length: count }, () => ({
    documentId: DOCUMENT_ID, treeNodeId: null, sourceId: null,
    kind: "REVISION" as const, revisionId: REVISION_ID, at: now,
  }));
}

describe("publication event bulk insert", () => {
  it("writes one statement for a list inside the batch boundary", async () => {
    const { query, connection } = fakeConnection();
    await new MariaDbPublicationEventRepository(connection).recordMany(events(500));

    expect(query).toHaveBeenCalledTimes(1);
    const [, parameters] = query.mock.calls[0];
    expect(parameters).toHaveLength(500 * 8);
  });

  it("chunks more than one batch into one statement per batch", async () => {
    const { query, connection } = fakeConnection();
    await new MariaDbPublicationEventRepository(connection).recordMany(events(1201));

    expect(query).toHaveBeenCalledTimes(3);
    const rows = query.mock.calls.map(([, parameters]) => parameters.length / 8);
    expect(rows).toEqual([500, 500, 201]);
    for (const [sql, parameters] of query.mock.calls) {
      expect(sql).toContain("INSERT INTO publication_events");
      // `consumed_at` is literal NULL, so every row binds eight values.
      expect(parameters.length % 8).toBe(0);
    }
  });

  it("issues no statement for an empty list", async () => {
    const { query, connection } = fakeConnection();
    await new MariaDbPublicationEventRepository(connection).recordMany([]);
    expect(query).not.toHaveBeenCalled();
  });
});
