import { describe, expect, it, vi } from "vitest";
import { MariaDbDocumentShareLinkRepository } from "@/infrastructure/database/mariadb/repositories/document-share-links";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";

describe("batch validity for followed links", () => {
  const row = (id: string, status: string, member: string | null = "owner") => ({
    id, document_id: `doc-${id}`, token: `token-${id}`, label: null, created_by: "owner",
    created_at: new Date("2026-01-01"), expires_at: new Date("2027-01-01"),
    revoked_by: null, revoked_at: null, document_status: "ACTIVE", source_status: "ACTIVE",
    workspace_type: "PERSONAL", workspace_status: status, personal_owner_user_id: "owner",
    membership_user_id: member, membership_role: member ? "OWNER" : null,
  });
  it("fetches the links, workspace states and creator grants in one statement", async () => {
    const query = vi.fn().mockResolvedValue([row("a", "ACTIVE"), row("b", "ARCHIVED"), row("c", "ACTIVE", null)]);
    const r = new MariaDbDocumentShareLinkRepository({ query } as unknown as QueryConnection);
    const links = await r.findWithValidityByIds(["a", "b", "c", "missing"], new Date("2026-11-01"));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(["a", "b", "c", "missing"]);
    expect(query.mock.calls[0][0]).toContain("LEFT JOIN workspace_memberships");
    expect(links.get("a")?.valid).toBe(true);
    expect(links.get("b")?.valid).toBe(false);
    expect(links.get("c")?.valid).toBe(false);
    expect(links.has("missing")).toBe(false);
  });
  it("does not query an empty list", async () => {
    const query = vi.fn();
    const r = new MariaDbDocumentShareLinkRepository({ query } as unknown as QueryConnection);
    expect((await r.findWithValidityByIds([], new Date())).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
