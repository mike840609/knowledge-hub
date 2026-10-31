import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { uuidv7 } from "@/shared/ids/uuidv7";
import {
  purgePublicationEvents,
  purgeRetentionDays,
} from "../../scripts/db/purge-publication-events";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;

beforeAll(async () => {
  fixture = await createPublicationFixture();
});
afterAll(async () => {
  await fixture.dispose();
});

type EventRow = { id: string; documentId: string };

async function insertEvent(input: {
  documentId: string;
  createdAt: Date;
  consumedAt: Date | null;
}): Promise<EventRow> {
  const id = uuidv7();
  await fixture.pool.query(
    `INSERT INTO publication_events (id, document_id, kind, created_at, consumed_at)
     VALUES (?, ?, 'REVISION', ?, ?)`,
    [id, input.documentId, input.createdAt, input.consumedAt],
  );
  return { id, documentId: input.documentId };
}

async function insertDelivery(input: {
  eventId: string;
  contributionId: string;
  processedAt: Date | null;
}): Promise<void> {
  await fixture.pool.query(
    `INSERT INTO publication_event_deliveries (event_id, contribution_id, processed_at, outcome)
     VALUES (?, ?, ?, ?)`,
    [input.eventId, input.contributionId, input.processedAt, input.processedAt === null ? null : "APPLIED"],
  );
}

async function remainingEventIds(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await fixture.pool.query<{ id: string }[]>(
    `SELECT id FROM publication_events WHERE id IN (${ids.map(() => "?").join(", ")}) ORDER BY id`,
    [...ids],
  );
  return rows.map((row) => String(row.id));
}

describe("publication event retention", () => {
  it("deletes only consumed events older than the cutoff whose deliveries are all processed", async () => {
    const original = await fixture.createHubOriginal(fixture.mike, "Retention source", "retention");
    const publication = await fixture.createPublication({
      name: `Retention ${uuidv7()}`,
      kind: "DOCUMENT",
      creator: fixture.mike,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });

    const now = new Date("2026-10-31T12:00:00Z");
    const cutoff = new Date(now.getTime() - purgeRetentionDays() * 86_400_000);
    const old = new Date(cutoff.getTime() - 60_000);
    const atCutoff = new Date(cutoff.getTime());
    const fresh = new Date(cutoff.getTime() + 1);

    // Old + consumed, all deliveries processed: purged.
    const processed = await insertEvent({ documentId: original.documentId, createdAt: old, consumedAt: old });
    await insertDelivery({ eventId: processed.id, contributionId: publication.contributionId, processedAt: old });
    // Old + consumed with no deliveries at all: purged.
    const empty = await insertEvent({ documentId: original.documentId, createdAt: old, consumedAt: old });
    // Old + consumed but one delivery still pending: kept, with its delivery.
    const secondContributionId = await fixture.addContribution({
      publicationId: publication.publication.id,
      user: fixture.ann,
      origin: { kind: "DOCUMENT", documentId: original.documentId },
    });
    const pending = await insertEvent({ documentId: original.documentId, createdAt: old, consumedAt: old });
    await insertDelivery({ eventId: pending.id, contributionId: publication.contributionId, processedAt: old });
    await insertDelivery({ eventId: pending.id, contributionId: secondContributionId, processedAt: null });
    // Old but unconsumed: never purged; behind stays detectable.
    const unconsumed = await insertEvent({ documentId: original.documentId, createdAt: old, consumedAt: null });
    // Exactly at the cutoff counts as old enough; one millisecond younger is kept.
    const boundary = await insertEvent({ documentId: original.documentId, createdAt: atCutoff, consumedAt: atCutoff });
    const younger = await insertEvent({ documentId: original.documentId, createdAt: fresh, consumedAt: fresh });

    const result = await purgePublicationEvents(fixture.pool, { now: () => now });

    expect(result.status).toBe("RAN");
    expect(result.events).toBe(3);
    expect(result.deliveries).toBe(1);
    expect(result.cutoff.getTime()).toBe(cutoff.getTime());
    expect(await remainingEventIds([processed.id, empty.id, pending.id, unconsumed.id, boundary.id, younger.id]))
      .toEqual([pending.id, unconsumed.id, younger.id].sort());

    const keptDeliveries = await fixture.pool.query<{ n: unknown }[]>(
      "SELECT COUNT(*) AS n FROM publication_event_deliveries WHERE event_id = ?",
      [pending.id],
    );
    expect(Number(keptDeliveries[0]?.n ?? 0)).toBe(2);

    // A rerun has nothing left to remove and stays idempotent.
    const again = await purgePublicationEvents(fixture.pool, { now: () => now });
    expect(again).toMatchObject({ status: "RAN", events: 0, deliveries: 0 });
  });
});
