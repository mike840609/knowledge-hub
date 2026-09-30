import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { findEscapedWikiLinks, type EscapedWikiLink } from "@/modules/knowledge/domain/escaped-wikilinks";

/**
 * Documents whose current revision holds a `\[\[…]]` (daily-driver spec §4.3).
 *
 * Until the rendered editor held wikilinks as nodes of their own it wrote `[[x]]` as `\[\[x]]`,
 * which is no link: a document opened and saved there lost its wikilinks, and every backlink
 * and graph edge with it. This lists the documents that may have been through that, so a person
 * can see how many there are and look at them before anything is decided about them.
 *
 * It only reports. There is no repair here and no flag that adds one: putting the brackets back
 * writes a revision per document, into history, and only a person can say which of these were
 * meant as text. The shape cannot tell them apart — someone who escaped a link on purpose and then
 * saved from the rendered editor got the same `\[\[x]]` — so every row is a candidate.
 *
 * It cannot write. The scan runs in one `START TRANSACTION READ ONLY`, which the database enforces,
 * and which also gives it one consistent snapshot to read every batch from.
 */
export type EscapedWikiLinkCandidate = {
  workspaceId: string;
  sourceId: string;
  documentId: string;
  title: string;
  /** ACTIVE or ARCHIVED: an archived document that is restored brings the damage back with it. */
  documentStatus: string;
  sourceStatus: string;
  occurrences: EscapedWikiLink[];
};

export type EscapedWikiLinkReport = {
  /** Documents that have a current revision: everything that could have been asked about. */
  scanned: number;
  candidates: EscapedWikiLinkCandidate[];
};

export async function reportEscapedWikiLinks(pool: Pool, options: { batchSize?: number } = {}): Promise<EscapedWikiLinkReport> {
  const batchSize = options.batchSize ?? 200;
  const connection = await pool.getConnection();
  try {
    await connection.query("START TRANSACTION READ ONLY");
    const counted = await connection.query<Record<string, unknown>[]>("SELECT COUNT(*) AS n FROM knowledge_documents WHERE current_revision_id IS NOT NULL");
    const scanned = Number(counted[0]?.n ?? 0);
    const candidates: EscapedWikiLinkCandidate[] = [];
    let after: string | undefined;
    for (;;) {
      // CHAR(92, 91, 92, 91) is `\[\[`: a cheap way to skip the documents that cannot hold one, so only those are read in full.
      const rows = await connection.query<Record<string, unknown>[]>(
        `SELECT d.id AS document_id, d.source_id AS source_id, s.workspace_id AS workspace_id, d.status AS document_status,
                s.status AS source_status, r.title AS title, r.markdown AS markdown
         FROM knowledge_documents d
         JOIN knowledge_sources s ON s.id = d.source_id
         JOIN knowledge_revisions r ON r.id = d.current_revision_id
         WHERE d.current_revision_id IS NOT NULL AND INSTR(r.markdown, CHAR(92, 91, 92, 91)) > 0
           ${after === undefined ? "" : "AND d.id > ?"}
         ORDER BY d.id
         LIMIT ?`,
        after === undefined ? [batchSize] : [after, batchSize],
      );
      if (rows.length === 0) break;
      for (const row of rows) {
        const occurrences = findEscapedWikiLinks(String(row.markdown));
        if (occurrences.length === 0) continue;
        candidates.push({
          workspaceId: String(row.workspace_id),
          sourceId: String(row.source_id),
          documentId: String(row.document_id),
          title: String(row.title),
          documentStatus: String(row.document_status),
          sourceStatus: String(row.source_status),
          occurrences,
        });
      }
      after = String(rows[rows.length - 1].document_id);
    }
    return { scanned, candidates };
  } finally {
    try {
      await connection.query("ROLLBACK");
    } finally {
      await connection.release();
    }
  }
}

export function formatReport(report: EscapedWikiLinkReport): string {
  const occurrences = report.candidates.reduce((total, candidate) => total + candidate.occurrences.length, 0);
  const lines = [`Documents whose current revision holds \\[\\[…]]: ${report.candidates.length} of ${report.scanned} scanned, ${occurrences} occurrence(s).`];
  for (const candidate of report.candidates) {
    lines.push("", `  ${candidate.documentId}  ${candidate.documentStatus}  ${JSON.stringify(candidate.title)}`);
    lines.push(`    workspace ${candidate.workspaceId}  source ${candidate.sourceId} (${candidate.sourceStatus})`);
    for (const occurrence of candidate.occurrences) lines.push(`    line ${occurrence.line}: ${occurrence.text}`);
  }
  lines.push(
    "",
    "These are candidates, not findings. The rendered editor used to write [[x]] as \\[\\[x]], which is no link; but a link that someone",
    "escaped on purpose and then saved from that editor has the same shape. Nothing was changed, and this script has no way to change anything.",
  );
  return lines.join("\n");
}

const HELP = `Usage: npx tsx scripts/db/report-escaped-wikilinks.ts [--target dev|test|e2e] [--batch-size N] [--json]

Lists the documents whose current revision holds \\[\\[…]] — what the rendered editor wrote for a
[[wikilink]] before it held them as nodes — with the line of each. Read-only: it reports and
changes nothing, and has no repair option. Every row is a candidate for a person to look at.
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
    throw new Error("Invalid arguments. Expected: [--target dev|test|e2e] [--batch-size N] [--json].");
  }
  const sizeIndex = args.indexOf("--batch-size");
  const batchSize = sizeIndex === -1 ? undefined : Number(args[sizeIndex + 1]);
  if (batchSize !== undefined && (!Number.isInteger(batchSize) || batchSize < 1)) {
    throw new Error("Invalid --batch-size. Expected a positive integer.");
  }
  const pool = createDatabasePool(databaseConfig(target));
  try {
    const report = await reportEscapedWikiLinks(pool, { batchSize });
    console.log(args.includes("--json") ? JSON.stringify(report, null, 2) : formatReport(report));
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
