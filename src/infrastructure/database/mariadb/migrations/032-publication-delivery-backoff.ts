import type { Migration } from "./types";

/**
 * A worker run must be able to advance past contributors that are permanently
 * pending (group-only, frozen or failing). Backing a delivery off keeps those
 * rows out of the head of the next bounded listing without consuming a
 * contributor's own caller-scoped retry.
 */
export const publicationDeliveryBackoffMigration: Migration = {
  version: 32,
  name: "publication-delivery-backoff",
  statements: [
    `ALTER TABLE publication_event_deliveries
      ADD COLUMN next_attempt_at DATETIME(6) NULL AFTER outcome,
      ADD KEY ix_publication_event_deliveries_retry (processed_at, next_attempt_at)`,
  ],
};
