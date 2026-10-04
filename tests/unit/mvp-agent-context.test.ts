import { expect, it, vi } from "vitest";
import { AgentContextService } from "@/modules/knowledge/application/agent-context-service";
import { formatAgentContext, validateContextSelection } from "@/modules/knowledge/domain/agent-context";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
const id = "00000000-0000-0000-0000-000000000001";
const caller = callerFromIdentity({ id, emp_id: "1", name: "Mike", org_code: "A" });
it("rejects empty, duplicate, invalid and oversized selections", () => {
  for (const ids of [[], [id, id], ["bad"], Array.from({ length: 21 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`)]) expect(() => validateContextSelection(ids)).toThrow();
});
it("formats saved revisions with provenance and pinned links and bounds UTF-8 bytes", () => {
  const doc = { documentId: id, sourceId: id, sourceName: "Wiki", sourcePath: "docs/a.md", revisionId: id, revisionNo: 2, title: "中文", markdown: "# 中文\nbody", updatedAt: new Date("2026-10-04T00:00:00Z") };
  const out = formatAgentContext(id, [doc]);
  expect(out.markdown).toContain("docs/a.md"); expect(out.markdown).toContain("?revision=2"); expect(out.bytes).toBe(new TextEncoder().encode(out.markdown).length);
  expect(() => formatAgentContext(id, [{ ...doc, markdown: "字".repeat(100000) }])).toThrow();
});
it("does not return partial context for a foreign workspace even when both are readable", async () => {
  const read = vi.fn(async () => {});
  const r = { users: { upsertIdentity: vi.fn() }, workspaceAccess: { requireWorkspaceRead: read, requireMembership: read }, workspaces: { findById: vi.fn(async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: id, lifecycleState: "ACTIVE" })) }, documents: { findById: vi.fn(async () => ({ id, sourceId: id, status: "ACTIVE" })) }, sourcePolicy: { findById: vi.fn(async () => ({ id, workspaceId: "other", status: "ACTIVE" })) }, revisions: { findCurrent: vi.fn() } } as unknown as KnowledgeRepositories;
  await expect(new AgentContextService({ run: work => work(r) }).build(caller, id, [id])).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  expect(r.revisions.findCurrent).not.toHaveBeenCalled();
});
it("refuses an archived document placement before reading its body", async () => {
  const read = vi.fn(async () => {});
  const r = { users: { upsertIdentity: vi.fn() }, workspaceAccess: { requireWorkspaceRead: read, requireMembership: read }, workspaces: { findById: vi.fn(async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: id, lifecycleState: "ACTIVE" })) }, documents: { findById: vi.fn(async () => ({ id, sourceId: id, status: "ACTIVE" })) }, sourcePolicy: { findById: vi.fn(async () => ({ id, workspaceId: id, status: "ACTIVE", name: "Wiki" })) }, tree: { listBySource: vi.fn(async () => [{ id, sourceId: id, documentId: id, nodeType: "DOCUMENT", parentId: null, status: "ARCHIVED" }]) }, revisions: { findCurrent: vi.fn(async () => ({ id, revisionNo: 1, title: "A", markdown: "secret", createdAt: new Date() })) }, linkedEntries: { findByDocumentId: vi.fn(async () => null) } } as unknown as KnowledgeRepositories;
  await expect(new AgentContextService({ run: work => work(r) }).build(caller, id, [id])).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  expect(r.revisions.findCurrent).not.toHaveBeenCalled();
});
