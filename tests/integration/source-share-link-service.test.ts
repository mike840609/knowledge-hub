import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { ApplyFolderImportService } from "@/modules/sources/application/apply-folder-import";
import { CreateFolderImportService } from "@/modules/sources/application/create-folder-import";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { FinalizeFolderImportService } from "@/modules/sources/application/finalize-folder-import";
import { UploadFolderImportEntriesService } from "@/modules/sources/application/upload-folder-import-entries";
import { DEFAULT_IMPORT_LIMITS } from "@/modules/sources/domain/import-limits";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

const injected = vi.hoisted(() => ({ caller: null as unknown, shares: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ establishTrustedCaller: async () => ({ caller: injected.caller }), shares: injected.shares }),
}));

import { GET as listSourceLinks, POST as createSourceLink } from "@/app/api/sources/[sourceId]/share-links/route";

let pool: Pool;
beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  injected.shares = new DocumentShareService(new MariaDbUnitOfWork(pool), new RandomShareTokenIssuer());
});
afterAll(async () => { await pool.end(); });

function newIdentity(name: string): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `SOURCE-SHARE-${id}`, name, org_code: "SHARE" };
}

function service(clock?: () => Date) {
  return new DocumentShareService(new MariaDbUnitOfWork(pool), new RandomShareTokenIssuer(), clock);
}

/** A My Space owned by a fresh user, with its default HUB_MANAGED Source. */
async function mySpaceSource() {
  const owner = newIdentity("Source Owner");
  const unitOfWork = new MariaDbUnitOfWork(pool);
  await unitOfWork.run((repositories) => repositories.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(unitOfWork).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspace.id);
  return { owner, caller, workspaceId: workspace.id, sourceId };
}

async function count(sql: string, params: unknown[]): Promise<number> {
  const rows = await pool.query<{ n: unknown }[]>(sql, params);
  return Number(rows[0].n);
}

const linkRows = (sourceId: string) => count("SELECT COUNT(*) AS n FROM document_share_links WHERE source_id = ?", [sourceId]);
const tokenOf = (path: string) => path.slice("/s/".length);

describe("DocumentShareService.createForSource (source share links §8)", () => {
  it("issues a UUIDv4 link on an ACTIVE My Space Source that expires in 30 days by default", async () => {
    const { caller, sourceId } = await mySpaceSource();
    const now = new Date("2026-10-29T08:00:00.000Z");
    const link = await service(() => now).createForSource(caller, { sourceId });
    expect(link.path).toMatch(/^\/s\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(link.expiresAt?.toISOString()).toBe("2026-11-28T08:00:00.000Z");
    expect(link.active).toBe(true);
    expect(await linkRows(sourceId)).toBe(1);
  });

  it("stores the link against the source, not a document or folder", async () => {
    const { caller, sourceId } = await mySpaceSource();
    await service().createForSource(caller, { sourceId, label: "team", expiresInDays: 7 });
    const rows = await pool.query<{ document_id: unknown; folder_node_id: unknown; source_id: unknown; label: unknown }[]>(
      "SELECT document_id, folder_node_id, source_id, label FROM document_share_links WHERE source_id = ?", [sourceId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].document_id).toBeNull();
    expect(rows[0].folder_node_id).toBeNull();
    expect(String(rows[0].source_id)).toBe(sourceId);
    expect(rows[0].label).toBe("team");
  });

  it("works on a SOURCE_MANAGED Source from a folder import", async () => {
    const { caller, workspaceId } = await mySpaceSource();
    const unitOfWork = new MariaDbUnitOfWork(pool);
    const bytes = new TextEncoder().encode("# Readme\n");
    const manifest = { uploadKey: `m-${uuidv7().slice(-8)}`, relativePath: "docs/readme.md", kind: "MARKDOWN" as const, size: bytes.byteLength };
    const start = await new CreateFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).createInitial(caller, { workspaceId, sourceName: "Synced Wiki", rootName: "wiki", manifest: [manifest] });
    await new UploadFolderImportEntriesService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).upload(caller, { snapshotId: start.snapshotId, entries: [{ uploadKey: manifest.uploadKey, bytes }] });
    await new FinalizeFolderImportService(unitOfWork, { limits: DEFAULT_IMPORT_LIMITS }).finalize(caller, start.snapshotId);
    const applied = await new ApplyFolderImportService(unitOfWork, {}).apply(caller, start.snapshotId);
    if (applied.kind !== "APPLIED") throw new Error("expected the initial import to apply");
    const ownership = await pool.query<{ ownership: unknown }[]>("SELECT ownership FROM knowledge_sources WHERE id = ?", [applied.sourceId]);
    expect(ownership[0].ownership).toBe("SOURCE_MANAGED");
    await expect(service().createForSource(caller, { sourceId: applied.sourceId })).resolves.toMatchObject({ active: true });
  });

  it("refuses a Source in a Team workspace", async () => {
    const { source } = await createSourceFixture(pool);
    await expect(service().createForSource(fixtureCaller(), { sourceId: source.id })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_PERSONAL" });
    expect(await linkRows(source.id)).toBe(0);
  });

  it("refuses someone else's My Space Source: a non-member is denied, a member of that workspace finds nothing", async () => {
    const { sourceId, workspaceId } = await mySpaceSource();
    const stranger = newIdentity("Stranger");
    await expect(service().createForSource(callerFromIdentity(stranger), { sourceId })).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });

    const member = newIdentity("Member");
    await new MariaDbUnitOfWork(pool).run(async (repositories) => {
      await repositories.users.upsertIdentity(member);
      await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId, userId: member.id, role: "VIEWER", now: new Date() }));
    });
    await expect(service().createForSource(callerFromIdentity(member), { sourceId })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    expect(await linkRows(sourceId)).toBe(0);
  });

  it("refuses an ARCHIVED Source", async () => {
    const { caller, sourceId, owner } = await mySpaceSource();
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(sourceId, "ARCHIVED", owner.id));
    await expect(service().createForSource(caller, { sourceId })).rejects.toMatchObject({ code: "DOCUMENT_ARCHIVED", message: "The shared source is archived." });
    expect(await linkRows(sourceId)).toBe(0);
  });

  it("allows ten active links, refuses the eleventh; expired and revoked ones do not count", async () => {
    const { caller, sourceId } = await mySpaceSource();
    const shares = service();
    const links = [];
    for (let index = 0; index < 10; index += 1) links.push(await shares.createForSource(caller, { sourceId }));
    await expect(shares.createForSource(caller, { sourceId })).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED", message: "A source can have at most 10 active share links." });
    await shares.revoke(caller, links[0].id);
    await pool.query("UPDATE document_share_links SET created_at = NOW(6) - INTERVAL 2 DAY, expires_at = NOW(6) - INTERVAL 1 SECOND WHERE id = ?", [links[1].id]);
    await expect(shares.createForSource(caller, { sourceId })).resolves.toMatchObject({ active: true });
    await expect(shares.createForSource(caller, { sourceId })).resolves.toMatchObject({ active: true });
    await expect(shares.createForSource(caller, { sourceId })).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED" });
  });

  it("rejects an expiry outside the allowed set", async () => {
    const { caller, sourceId } = await mySpaceSource();
    await expect(service().createForSource(caller, { sourceId, expiresInDays: 2 })).rejects.toMatchObject({ code: "INVALID_SHARE_LINK_EXPIRY" });
  });

  it("audits creation with the source id and no token", async () => {
    const { caller, sourceId, workspaceId } = await mySpaceSource();
    const link = await service().createForSource(caller, { sourceId, label: "team" });
    const rows = await pool.query<{ payload: unknown }[]>(
      "SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'DOCUMENT_SHARE_LINK_CREATED'", [workspaceId]);
    expect(rows).toHaveLength(1);
    const payload = typeof rows[0].payload === "string" ? JSON.parse(rows[0].payload) : rows[0].payload;
    expect(payload).toMatchObject({ sourceId, label: "team" });
    expect(payload).not.toHaveProperty("documentId");
    expect(payload).not.toHaveProperty("folderNodeId");
    expect(JSON.stringify(payload)).not.toContain(tokenOf(link.path));
  });
});

describe("DocumentShareService.listForSource", () => {
  it("lists only that Source's links, newest first, with view totals", async () => {
    const { caller, sourceId } = await mySpaceSource();
    const other = await mySpaceSource();
    const shares = service();
    const first = await shares.createForSource(caller, { sourceId, label: "first" });
    const second = await shares.createForSource(caller, { sourceId, label: "second" });
    await shares.createForSource(other.caller, { sourceId: other.sourceId, label: "elsewhere" });
    await pool.query("INSERT INTO document_share_link_views (share_link_id, view_date, first_viewed_at, last_viewed_at, view_count) VALUES (?, CURDATE(), NOW(6), NOW(6), 4)", [first.id]);

    const listed = await shares.listForSource(caller, sourceId);
    expect(listed.map((link) => link.label)).toEqual(["second", "first"]);
    expect(listed.find((link) => link.id === first.id)?.totalViews).toBe(4);
    expect(listed.find((link) => link.id === second.id)?.totalViews).toBe(0);
  });

  it("hides the list from anyone but the My Space owner", async () => {
    const { sourceId } = await mySpaceSource();
    await expect(service().listForSource(callerFromIdentity(newIdentity("Stranger")), sourceId)).rejects.toMatchObject({ code: "WORKSPACE_ACCESS_DENIED" });
    await expect(service().listForSource(fixtureCaller(), uuidv7())).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });
});

describe("DocumentShareService.revoke on a source link", () => {
  it("revokes for the owner and audits the source id once", async () => {
    const { caller, sourceId, workspaceId } = await mySpaceSource();
    const shares = service();
    const link = await shares.createForSource(caller, { sourceId });
    const now = new Date("2026-10-29T09:00:00.000Z");
    await service(() => now).revoke(caller, link.id);
    await shares.revoke(caller, link.id);
    const rows = await pool.query<{ revoked_at: unknown }[]>("SELECT revoked_at FROM document_share_links WHERE id = ?", [link.id]);
    expect(new Date(String(rows[0].revoked_at)).getTime()).not.toBeNaN();
    expect((await shares.listForSource(caller, sourceId))[0]).toMatchObject({ id: link.id, active: false });
    const events = await pool.query<{ payload: unknown }[]>(
      "SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = 'DOCUMENT_SHARE_LINK_REVOKED'", [workspaceId]);
    expect(events).toHaveLength(1);
    const payload = typeof events[0].payload === "string" ? JSON.parse(events[0].payload) : events[0].payload;
    expect(payload).toMatchObject({ sourceId });
  });

  it("answers ShareLinkNotFoundError to a stranger and writes nothing", async () => {
    const { caller, sourceId } = await mySpaceSource();
    const link = await service().createForSource(caller, { sourceId });
    await expect(service().revoke(callerFromIdentity(newIdentity("Stranger")), link.id)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    const rows = await pool.query<{ revoked_at: unknown }[]>("SELECT revoked_at FROM document_share_links WHERE id = ?", [link.id]);
    expect(rows[0].revoked_at).toBeNull();
  });

  it("still revokes after the Source has been archived", async () => {
    const { caller, sourceId, owner } = await mySpaceSource();
    const link = await service().createForSource(caller, { sourceId });
    await new MariaDbUnitOfWork(pool).run((repositories) => repositories.sources.updateStatus(sourceId, "ARCHIVED", owner.id));
    await expect(service().revoke(caller, link.id)).resolves.toBeUndefined();
    expect((await service().listForSource(caller, sourceId))[0].active).toBe(false);
  });
});

describe("source share-link API", () => {
  function as(caller: CallerContext) { injected.caller = caller; }
  const sourceParams = (sourceId: string) => ({ params: Promise.resolve({ sourceId }) });
  const post = (body: unknown) => new Request("http://hub.test/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

  it("creates a source link with 201 and a path, and lists it", async () => {
    const { caller, sourceId } = await mySpaceSource();
    as(caller);
    const response = await createSourceLink(post({ label: "team", expiresInDays: 7 }), sourceParams(sourceId));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.link.path).toMatch(/^\/s\//);
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const { links } = await (await listSourceLinks(new Request("http://hub.test"), sourceParams(sourceId))).json();
    expect(links).toMatchObject([{ id: body.link.id, label: "team", active: true }]);
  });

  it("rejects a body that is not a JSON object with 400 INVALID_REQUEST", async () => {
    const { caller, sourceId } = await mySpaceSource();
    as(caller);
    const response = await createSourceLink(post([1]), sourceParams(sourceId));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_REQUEST");
  });
});
