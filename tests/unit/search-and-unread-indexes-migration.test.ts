import { describe, expect, it, vi } from "vitest";
import { migrations } from "@/infrastructure/database/mariadb/migrations";
import { MariaDbKnowledgeSearchRepository } from "@/infrastructure/database/mariadb/repositories/knowledge-search";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";
import type { KnowledgeSearchCriteria } from "@/modules/knowledge/ports/knowledge-search-repository";
import { AgentContextService } from "@/modules/knowledge/application/agent-context-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";

const workspaceId = "00000000-0000-0000-0000-000000000001";
const sourceId = "00000000-0000-0000-0000-0000000000a1";
const firstId = "00000000-0000-0000-0000-0000000000b1";
const secondId = "00000000-0000-0000-0000-0000000000b2";

describe("migration 036 search and unread indexes", () => {
  it("registers one additive migration with path, task-binding and unread indexes", () => {
    const migration = migrations.find((candidate) => candidate.version === 36);
    expect(migration).toMatchObject({ version: 36, name: "search-and-unread-indexes" });
    const statements = migration!.statements.join("\n");
    expect(statements).toContain("CREATE INDEX idx_entries_source_path ON source_entries (source_id, source_path(255))");
    expect(statements).toContain("CREATE INDEX idx_task_bindings_workspace_owner ON task_export_bindings (workspace_id, owner_user_id)");
    expect(statements).toContain("CREATE INDEX idx_recipient_user_unread ON document_share_link_recipients (user_id, read_at, added_at, share_link_id)");
  });
});

const criteria = (sort?: "newest" | "oldest" | "relevance"): KnowledgeSearchCriteria => ({
  terms: ["needle"], workspaceIds: ["workspace-1"], sourceId: null, includeArchived: false, limit: 21, offset: 0,
  filters: sort === undefined ? undefined : { path: null, updatedFrom: null, updatedBefore: null, sort },
});

async function sqlFor(sort?: "newest" | "oldest" | "relevance") {
  const query = vi.fn(async () => []);
  await new MariaDbKnowledgeSearchRepository({ query } as unknown as QueryConnection).search(criteria(sort));
  return query.mock.calls[0] as unknown as [string, unknown[]];
}

describe("MariaDbKnowledgeSearchRepository deferred snippet projection", () => {
  it("applies LIMIT in a derived query before joining the revision body once", async () => {
    const [sql] = await sqlFor();

    expect(sql).toContain("SET STATEMENT max_statement_time=5 FOR");
    // The LONGTEXT work runs only for rows already chosen by the inner ORDER BY ... LIMIT.
    expect(sql.indexOf("LIMIT ? OFFSET ?")).toBeLessThan(sql.indexOf("JOIN knowledge_revisions body_r ON body_r.id = matched.current_revision_id"));
    expect(sql).toContain("LOCATE(?, body_r.markdown COLLATE utf8mb4_unicode_ci) AS anchor_at");
    expect(sql).toContain("CHAR_LENGTH(body_r.markdown) AS markdown_length");
    expect(sql).toContain("SUBSTRING(body_r.markdown");
    // No LONGTEXT expression survives in the inner candidate query.
    expect(sql).not.toContain("CHAR_LENGTH(r.markdown)");
    expect(sql).not.toContain("SUBSTRING(r.markdown");
    // Candidate ordering still happens over the revision join's created_at.
    expect(sql).toContain("r.created_at");
  });

  it("preserves the outer page order for every sort", async () => {
    expect((await sqlFor("newest"))[0]).toContain("matched.updated_at DESC, matched.document_id ASC");
    expect((await sqlFor("oldest"))[0]).toContain("matched.updated_at ASC, matched.document_id ASC");
    expect((await sqlFor("relevance"))[0]).toContain("matched.title_hits DESC, matched.updated_at DESC, matched.document_id ASC");
  });

  it("keeps the literal parameter order the outer projection expects", async () => {
    const [, parameters] = await sqlFor();
    expect(parameters.slice(0, 6)).toEqual(["needle", "needle", "needle", 60, 160, 160]);
    expect(parameters.at(-2)).toBe(21);
    expect(parameters.at(-1)).toBe(0);
  });
});

describe("AgentContextService source-tree cache", () => {
  it("loads a source's tree once for multiple selected documents from that source", async () => {
    const caller = callerFromIdentity({ id: workspaceId, emp_id: "1", name: "Mike", org_code: "A" });
    const listBySource = vi.fn(async () => [firstId, secondId].map((documentId) => ({
      id: documentId, sourceId, documentId, nodeType: "DOCUMENT", parentId: null, status: "ACTIVE",
    })));
    const r = {
      users: { upsertIdentity: vi.fn(), findById: vi.fn() },
      workspaceAccess: { requireWorkspaceRead: vi.fn(), requireMembership: vi.fn() },
      workspaces: { findById: vi.fn(async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: workspaceId, lifecycleState: "ACTIVE" })) },
      documents: { findById: vi.fn(async (documentId: string) => ({ id: documentId, sourceId, status: "ACTIVE" })) },
      sourcePolicy: { findById: vi.fn(async () => ({ id: sourceId, workspaceId, status: "ACTIVE", name: "Wiki" })) },
      tree: { listBySource },
      revisions: { findCurrent: vi.fn(async (documentId: string) => ({ id: documentId, revisionNo: 1, title: documentId, markdown: "Body", createdAt: new Date("2026-11-01T00:00:00Z") })) },
      linkedEntries: { findByDocumentId: vi.fn(async () => null) },
      links: { loadCatalog: vi.fn(async () => []), loadValidEdges: vi.fn(async () => []) },
      reviewThreads: { listByDocument: vi.fn(async () => []) },
      reviewComments: { listByThreads: vi.fn(async () => []) },
    } as unknown as KnowledgeRepositories;

    const out = await new AgentContextService({ run: (work) => work(r), read: (work) => work(r) })
      .build(caller, workspaceId, [firstId, secondId], "", { includeDiscussions: false });

    expect(out.documentCount).toBe(2);
    expect(listBySource).toHaveBeenCalledTimes(1);
    expect(listBySource).toHaveBeenCalledWith(sourceId);
  });

  it("reuses the loaded source tree when ContextTooLargeError retries without the link map", async () => {
    const caller = callerFromIdentity({ id: workspaceId, emp_id: "1", name: "Mike", org_code: "A" });
    const listBySource = vi.fn(async () => [{ id: "node-1", sourceId, documentId: firstId, nodeType: "DOCUMENT", parentId: null, status: "ACTIVE" }]);
    // The document alone fits under the 256 KiB cap; only the link map pushes the first assembly over it.
    const markdown = "x".repeat(260_000);
    const unresolvedTarget = "a".repeat(10_000);
    const r = {
      users: { upsertIdentity: vi.fn(), findById: vi.fn() },
      workspaceAccess: { requireWorkspaceRead: vi.fn(), requireMembership: vi.fn() },
      workspaces: { findById: vi.fn(async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: workspaceId, lifecycleState: "ACTIVE" })) },
      documents: { findById: vi.fn(async (documentId: string) => ({ id: documentId, sourceId, status: "ACTIVE" })) },
      sourcePolicy: { findById: vi.fn(async () => ({ id: sourceId, workspaceId, status: "ACTIVE", name: "Wiki" })) },
      tree: { listBySource },
      revisions: { findCurrent: vi.fn(async (documentId: string) => ({ id: documentId, revisionNo: 1, title: documentId, markdown, createdAt: new Date("2026-11-01T00:00:00Z") })) },
      linkedEntries: { findByDocumentId: vi.fn(async () => null) },
      links: {
        loadCatalog: vi.fn(async () => [{ documentId: firstId, sourceId, title: "Doc", sourcePath: null, createdAt: new Date("2026-11-01T00:00:00Z") }]),
        loadValidEdges: vi.fn(async () => [{ documentId: firstId, links: [{ kind: "WIKI", target: unresolvedTarget, fragment: null, display: null, line: 1, ordinal: 0 }] }]),
      },
      reviewThreads: { listByDocument: vi.fn(async () => []) },
      reviewComments: { listByThreads: vi.fn(async () => []) },
    } as unknown as KnowledgeRepositories;

    const out = await new AgentContextService({ run: (work) => work(r), read: (work) => work(r) })
      .build(caller, workspaceId, [firstId], "", { includeDiscussions: false });

    // The retry dropped the map, not the already-read source tree.
    expect(out.linkCount).toBe(0);
    expect(out.documentCount).toBe(1);
    expect(listBySource).toHaveBeenCalledTimes(1);
    expect(listBySource).toHaveBeenCalledWith(sourceId);
  });
});
