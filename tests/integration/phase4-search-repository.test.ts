import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import type { KnowledgeSearchCriteria } from "@/modules/knowledge/ports/knowledge-search-repository";
import { SourceApplicationService } from "@/modules/sources/application/source-version-guard";
import { createTeamWorkspaceInsert } from "@/modules/workspaces/domain/workspace";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const owner: UserIdentity = { id: "00000000-0000-0000-0000-000000000401", emp_id: "P4-OWNER", name: "Search Owner", org_code: "HRSD" };

/** One workspace + one HUB source the owner can write to. */
async function createScope(): Promise<{ workspaceId: string; sourceId: string }> {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  const workspaceId = uuidv7();
  const sourceId = uuidv7();
  const now = new Date();
  await unitOfWork.run(async (repositories) => {
    await repositories.users.upsertIdentity(owner);
    await repositories.workspaces.insert(createTeamWorkspaceInsert({ id: workspaceId, name: `Search ${workspaceId}`, createdBy: owner.id, now }));
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: owner.id, role: "OWNER", createdBy: owner.id, now }));
    await repositories.sources.insert({
      id: sourceId, name: "Search Source", workspaceId, sourceType: "HUB", ownership: "HUB_MANAGED", status: "ACTIVE", syncVersion: 0,
      createdBy: owner.id, updatedBy: owner.id, archivedBy: null, archivedAt: null, createdAt: now, updatedAt: now,
    });
  });
  return { workspaceId, sourceId };
}

async function search(criteria: Partial<KnowledgeSearchCriteria> & { terms: string[]; workspaceIds: string[] }) {
  const unitOfWork = new MariaDbUnitOfWork(pool);
  return unitOfWork.run((repositories) => repositories.search.search({
    sourceId: null, includeArchived: false, limit: 21, offset: 0, ...criteria,
  }));
}

describe("Phase 4 search repository", () => {
  it("matches mixed Chinese/English content case- and width-insensitively", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "請假流程 SWFP Leave Policy",
      markdown: "員工請假流程：主管簽核後生效。Employee leave requests need manager approval.", metadata: {},
    });

    expect((await search({ terms: ["請假"], workspaceIds: [workspaceId] })).map((row) => row.title)).toEqual(["請假流程 SWFP Leave Policy"]);
    expect(await search({ terms: ["swfp"], workspaceIds: [workspaceId] })).toHaveLength(1);
    expect(await search({ terms: ["ＳＷＦＰ"], workspaceIds: [workspaceId] })).toHaveLength(1);
    // Simplified input does not reach Traditional content; recorded as current behaviour.
    expect(await search({ terms: ["请假"], workspaceIds: [workspaceId] })).toHaveLength(0);
  });

  it("requires every term to match either the title or the body", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Runbook 值班手冊", markdown: "escalation 流程說明", metadata: {},
    });

    expect(await search({ terms: ["Runbook", "escalation"], workspaceIds: [workspaceId] })).toHaveLength(1);
    expect(await search({ terms: ["Runbook", "absent"], workspaceIds: [workspaceId] })).toHaveLength(0);
  });

  // hub.archiveDocument flips knowledge_documents.status and the document's tree
  // node together (set-document-lifecycle.ts), so this case cannot isolate
  // d.status from n.status — it only proves the pair is hidden as a unit.
  it("hides a document archived together with its tree node unless includeArchived is set", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Retired 停用筆記", markdown: "archivedneedle 內容", metadata: {},
    });
    await hub.archiveDocument(callerFromIdentity(owner), created.documentId);

    expect(await search({ terms: ["archivedneedle"], workspaceIds: [workspaceId] })).toHaveLength(0);
    expect(await search({ terms: ["archivedneedle"], workspaceIds: [workspaceId], includeArchived: true })).toHaveLength(1);
  });

  // Archiving the Source only flips knowledge_sources.status; the document and
  // its tree node stay ACTIVE. This isolates the s.status = 'ACTIVE' predicate,
  // which the document-archival case above never exercises.
  it("hides documents under an archived source unless includeArchived is set", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Under retired source", markdown: "archivedsourceneedle 內容", metadata: {},
    });
    await new SourceApplicationService(new MariaDbUnitOfWork(pool)).archiveSource(callerFromIdentity(owner), sourceId);

    expect(await search({ terms: ["archivedsourceneedle"], workspaceIds: [workspaceId] })).toHaveLength(0);
    expect(await search({ terms: ["archivedsourceneedle"], workspaceIds: [workspaceId], includeArchived: true })).toHaveLength(1);
  });

  it("searches only the current revision", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    const created = await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Architecture 架構", markdown: "firstrevisionneedle", metadata: {},
    });
    await hub.createRevision(callerFromIdentity(owner), {
      documentId: created.documentId, expectedCurrentRevisionId: created.revisionId,
      title: "Architecture 架構", markdown: "secondrevisionneedle", metadata: {},
    });

    expect(await search({ terms: ["firstrevisionneedle"], workspaceIds: [workspaceId] })).toHaveLength(0);
    expect(await search({ terms: ["secondrevisionneedle"], workspaceIds: [workspaceId] })).toHaveLength(1);
  });

  it("treats an out-of-scope source filter exactly like a missing one", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Scoped 範圍", markdown: "scopedneedle", metadata: {},
    });

    expect(await search({ terms: ["scopedneedle"], workspaceIds: [workspaceId], sourceId })).toHaveLength(1);
    expect(await search({ terms: ["scopedneedle"], workspaceIds: [workspaceId], sourceId: uuidv7() })).toHaveLength(0);
  });

  it("ranks title hits above body-only hits and returns correct snippet and attribution fields", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    // Longer than SNIPPET_LENGTH (160) so the no-match ELSE branch (SUBSTRING
    // from 1) is distinguishable from returning the whole markdown untouched.
    const longUnrelatedBody = "unrelated body. ".repeat(20);
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Body only", markdown: "rankneedle appears in the body", metadata: {},
    });
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "rankneedle in the title", markdown: longUnrelatedBody, metadata: {},
    });

    const rows = await search({ terms: ["rankneedle"], workspaceIds: [workspaceId] });
    expect(rows.map((row) => row.title)).toEqual(["rankneedle in the title", "Body only"]);

    const [titleHit, bodyHit] = rows;
    // Title-only hit: the term never appears in the body, so LOCATE finds
    // nothing and the snippet must fall back to the body's first 160 chars.
    expect(titleHit.snippet).toBe(longUnrelatedBody.slice(0, 160));
    // Body hit: the term appears in the body, so the snippet must be built
    // around that match, not an unrelated slice.
    expect(bodyHit.snippet).toContain("rankneedle");
    expect(bodyHit.snippet.length).toBeLessThanOrEqual(160);
    expect(titleHit.sourceName).toBe("Search Source");
    expect(titleHit.workspaceName).toBe(`Search ${workspaceId}`);
  });

  it("applies limit and offset for pagination", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    for (const index of [1, 2, 3]) {
      await hub.createDocument(callerFromIdentity(owner), {
        sourceId, parentId: null, title: `Page ${index}`, markdown: "pageneedle", metadata: {},
      });
    }

    const firstTwo = await search({ terms: ["pageneedle"], workspaceIds: [workspaceId], limit: 2, offset: 0 });
    const rest = await search({ terms: ["pageneedle"], workspaceIds: [workspaceId], limit: 2, offset: 2 });
    expect(firstTwo).toHaveLength(2);
    expect(rest).toHaveLength(1);
    expect(firstTwo.map((row) => row.documentId)).not.toContain(rest[0].documentId);
  });

  it("treats wildcard characters in the query as literal text", async () => {
    const { workspaceId, sourceId } = await createScope();
    const hub = new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Discount 折扣", markdown: "the coupon gives 100% off", metadata: {},
    });
    await hub.createDocument(callerFromIdentity(owner), {
      sourceId, parentId: null, title: "Plain 普通", markdown: "the number is 1000 exactly", metadata: {},
    });

    expect((await search({ terms: ["100%"], workspaceIds: [workspaceId] })).map((row) => row.title)).toEqual(["Discount 折扣"]);
  });

  it("returns no rows and issues no query when there are no terms or no workspaces", async () => {
    const { workspaceId } = await createScope();
    expect(await search({ terms: [], workspaceIds: [workspaceId] })).toEqual([]);
    expect(await search({ terms: ["anything"], workspaceIds: [] })).toEqual([]);
  });
});
