/**
 * How long the `[[` list takes to get its documents, and to narrow them (daily-driver plan D.9).
 *
 * Seeds one Workspace with N Hub documents on a throw-away database (the same provisioning the
 * integration tests use), then measures, for each N:
 *
 * - `listLinkTargets` — what `GET /api/workspaces/:id/link-targets` runs — warm, and once cold;
 * - the size of what it sends, raw and gzipped;
 * - `rankSuggestions` over the result, for a few queries, which is what every keystroke costs.
 *
 * Run with `npx tsx scripts/diagnostics/measure-link-targets.ts 2000 5000`. It is a diagnostic, not a
 * test: nothing in it asserts, and the numbers depend on the machine.
 */
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { MariaDbUnitOfWork } from "../../src/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "../../src/modules/identity/domain/caller-context";
import { KnowledgeLinkServiceImpl, type LinkTargetsView } from "../../src/modules/knowledge/application/knowledge-link-service";
import { rankSuggestions } from "../../src/components/knowledge/editor/link-suggestions";
import { hubDocument, linkOwner, provisionLinkDatabase, setupLinkScope } from "../../tests/fixtures/link-graph";

const WORDS = ["Kubernetes", "ClickHouse", "Airflow", "NATS", "Spring Boot", "payroll", "headcount", "attrition", "runbook", "upgrade", "incident", "review", "design", "migration", "薪資報表", "人力盤點", "離職分析", "部署流程", "資料管線", "效能調校"];
const title = (index: number) => `${WORDS[index % WORDS.length]} ${WORDS[(index * 7 + 3) % WORDS.length]} notes ${index}`;

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const summary = (samples: number[]) => {
  const sorted = [...samples].sort((a, b) => a - b);
  return `p50 ${percentile(sorted, 0.5).toFixed(2)} ms, p95 ${percentile(sorted, 0.95).toFixed(2)} ms, max ${sorted[sorted.length - 1].toFixed(2)} ms`;
};

async function main() {
  const sizes = process.argv.slice(2).map(Number).filter((value) => Number.isInteger(value) && value > 0);
  const { pool, dispose } = await provisionLinkDatabase();
  try {
    const owner = callerFromIdentity(linkOwner);
    const service = new KnowledgeLinkServiceImpl(new MariaDbUnitOfWork(pool));
    for (const size of sizes.length ? sizes : [2000, 5000]) {
      const scope = await setupLinkScope(pool, { name: `Measure ${size}` });
      const seeding = performance.now();
      for (let index = 0; index < size; index += 1) await hubDocument(pool, scope, title(index), `body ${index}`);
      console.log(`\n== ${size} documents (seeded in ${((performance.now() - seeding) / 1000).toFixed(1)} s)`);

      const first = performance.now();
      let view: LinkTargetsView = await service.listLinkTargets(owner, scope.workspaceId);
      console.log(`listLinkTargets, first call: ${(performance.now() - first).toFixed(2)} ms (${view.targets.length} targets, truncated ${view.truncated})`);
      const samples: number[] = [];
      for (let run = 0; run < 30; run += 1) {
        const start = performance.now();
        view = await service.listLinkTargets(owner, scope.workspaceId);
        samples.push(performance.now() - start);
      }
      console.log(`listLinkTargets, warm x30: ${summary(samples)}`);

      const json = JSON.stringify(view);
      console.log(`payload: ${(Buffer.byteLength(json) / 1024).toFixed(1)} KiB raw, ${(gzipSync(json).length / 1024).toFixed(1)} KiB gzipped`);
      const parse = performance.now();
      const parsed = JSON.parse(json) as LinkTargetsView;
      console.log(`JSON.parse of it: ${(performance.now() - parse).toFixed(2)} ms`);

      const plan = await pool.query(
        `EXPLAIN SELECT d.id, d.source_id, r.title, r.created_at
         FROM knowledge_documents d JOIN knowledge_sources s ON s.id = d.source_id
         JOIN knowledge_revisions r ON r.id = d.current_revision_id JOIN knowledge_tree_nodes n ON n.document_id = d.id
         WHERE s.workspace_id = ? AND s.status = 'ACTIVE' AND d.status = 'ACTIVE' AND n.status = 'ACTIVE'
         ORDER BY r.created_at DESC, d.id LIMIT ?`,
        [scope.workspaceId, 5001],
      );
      console.log("plan:", JSON.stringify(plan.map((row: Record<string, unknown>) => `${String(row.table)}:${String(row.type)}:${String(row.key)}:${String(row.rows)}${row.Extra ? `:${String(row.Extra)}` : ""}`)));

      for (const query of ["", "k", "kube", "kubernetes upg", "薪資", "zzzz-no-match"]) {
        const cold = performance.now();
        const fresh = JSON.parse(json) as LinkTargetsView; // new objects: nothing cached for them yet
        rankSuggestions(fresh.targets, query);
        const coldMs = performance.now() - cold;
        const warm: number[] = [];
        for (let run = 0; run < 200; run += 1) {
          const start = performance.now();
          rankSuggestions(parsed.targets, query);
          warm.push(performance.now() - start);
        }
        console.log(`rankSuggestions(${JSON.stringify(query)}): first (keys not yet made, incl. JSON.parse) ${coldMs.toFixed(2)} ms; per keystroke after ${summary(warm.slice(20))}`);
      }
    }
  } finally {
    await dispose();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
