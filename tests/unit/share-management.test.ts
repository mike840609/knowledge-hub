import { expect, it, vi } from "vitest";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { parseShareManagementQuery } from "@/modules/knowledge/domain/share-management";
import type { KnowledgeRepositories } from "@/modules/knowledge/ports/unit-of-work";
import { fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";
it("rejects invalid filters and pagination instead of broadening the request", () => {
  expect(parseShareManagementQuery({ q: " guide ", status: "expired", page: "2" })).toEqual({ q: "guide", status: "expired", page: 2 });
  for (const query of [{ status: "invalid" }, { page: "0" }, { page: "2x" }, { q: "x".repeat(201) }]) expect(() => parseShareManagementQuery(query)).toThrow();
});
it("refuses a foreign or Team workspace before reading bearer tokens", async () => {
  const r = { workspaceAccess: { requireWorkspaceRead: vi.fn() }, workspaces: { findById: vi.fn(async () => ({ workspaceType: "TEAM", personalOwnerUserId: fixtureIdentity.id, lifecycleState: "ACTIVE" })) }, shareLinks: { listForWorkspace: vi.fn() } } as unknown as KnowledgeRepositories;
  const service = new DocumentShareService({ run: work => work(r) }, { issue: () => "unused" });
  await expect(service.listManagement(fixtureCaller(), "ws", {})).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  expect(r.shareLinks.listForWorkspace).not.toHaveBeenCalled();
});
it("bounds the page and exposes only selected-workspace link metadata", async () => {
  const links = Array.from({ length: 51 }, (_, i) => ({ id: String(i), path: "/s/token", status: "active", title: "Guide" }));
  const r = { workspaceAccess: { requireWorkspaceRead: vi.fn() }, workspaces: { findById: vi.fn(async () => ({ workspaceType: "PERSONAL", personalOwnerUserId: fixtureIdentity.id, lifecycleState: "ACTIVE" })) }, shareLinks: { listForWorkspace: vi.fn(async () => links) } } as unknown as KnowledgeRepositories;
  const service = new DocumentShareService({ run: work => work(r) }, { issue: () => "unused" });
  const result = await service.listManagement(fixtureCaller(), "ws", { page: "2" });
  expect(result.items).toHaveLength(50); expect(result.hasNext).toBe(true); expect(result.query.page).toBe(2);
});
