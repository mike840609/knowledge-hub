import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";

/**
 * Link index backfill and repair (graph spec §7.4).
 *
 * Migration 012 creates the tables empty, and migrations cannot write data, so
 * documents that existed before it have no index rows; this indexes them. It is
 * also the repair for any row that later fell behind — its revision moved on
 * without it, or the extraction rules changed (`LINK_EXTRACTOR_VERSION`).
 *
 * Each document is done in a transaction of its own: lock the document, read
 * its current revision under that lock, replace its edges. What is written is
 * therefore always the revision that is current *when the lock is held*, so a
 * save that lands while this runs is never overwritten with older content — the
 * save waits for the lock, then indexes itself. Idempotent, safe to interrupt
 * and rerun, and safe to run while the application is serving traffic.
 *
 * The index is derived data: this reads Markdown and writes only the two index
 * tables, and it decides nothing about who can read what.
 */
export type ReindexResult = { indexed: number; skipped: number };

export async function reindexDocumentLinks(pool: Pool, options: { batchSize?: number } = {}): Promise<ReindexResult> {
  const batchSize = options.batchSize ?? 200;
  const unitOfWork = new MariaDbUnitOfWork(pool);
  let indexed = 0;
  let skipped = 0;
  let after: string | undefined;
  for (;;) {
    const ids = await unitOfWork.run((repositories) => repositories.links.listStaleDocumentIds(batchSize, after));
    if (ids.length === 0) break;
    for (const documentId of ids) {
      const done = await unitOfWork.run(async (repositories) => {
        const document = await repositories.documents.lockById(documentId);
        if (!document) return false;
        const current = await repositories.revisions.findCurrent(documentId);
        if (!current) return false;
        await repositories.links.replaceForDocument({ documentId, revisionId: current.id, links: extractDocumentLinks(current.markdown) });
        return true;
      });
      if (done) indexed += 1;
      else skipped += 1;
    }
    // Paging past the last id seen, not restarting: a document that cannot be
    // indexed stays stale and would otherwise be listed forever.
    after = ids[ids.length - 1];
  }
  return { indexed, skipped };
}

const HELP = `Usage: npx tsx scripts/db/reindex-document-links.ts [--target dev|test|e2e] [--batch-size N]

Indexes the links of every document that has no valid link index row (created
before migration 012, or fallen behind its current revision or the extraction
rules). Idempotent, resumable, and safe to run while the application is serving
traffic. See docs/operations/document-link-index-rollout.md.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP);
    return;
  }
  const targetIndex = args.indexOf("--target");
  const target = targetIndex === -1 ? "dev" : args[targetIndex + 1];
  if (target !== "dev" && target !== "test" && target !== "e2e") {
    throw new Error("Invalid arguments. Expected: [--target dev|test|e2e] [--batch-size N].");
  }
  const sizeIndex = args.indexOf("--batch-size");
  const batchSize = sizeIndex === -1 ? undefined : Number(args[sizeIndex + 1]);
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    throw new Error("Invalid --batch-size. Expected a positive integer.");
  }
  const pool = createDatabasePool(databaseConfig(target));
  try {
    const result = await reindexDocumentLinks(pool, { batchSize });
    console.log(`Link index up to date: ${result.indexed} document(s) indexed, ${result.skipped} skipped.`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
