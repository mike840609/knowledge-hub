import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createDocumentFixture, createSourceFixture, fixtureCaller } from "../fixtures/knowledge";

const injected = vi.hoisted(() => ({ caller: null as unknown, shares: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ establishTrustedCaller: async () => ({ caller: injected.caller }), shares: injected.shares }),
}));

import { GET as listLinks, POST as createLink } from "@/app/api/documents/[documentId]/share-links/route";
import { POST as revokeLink } from "@/app/api/share-links/[linkId]/revoke/route";

let pool: Pool;
beforeAll(() => {
  pool = createDatabasePool(databaseConfig("test"));
  injected.shares = new DocumentShareService(new MariaDbUnitOfWork(pool), new RandomShareTokenIssuer());
});
afterAll(async () => { await pool.end(); });

function as(caller: CallerContext) { injected.caller = caller; }
const documentParams = (documentId: string) => ({ params: Promise.resolve({ documentId }) });
const post = (body: unknown) => new Request("http://hub.test/api", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

async function mySpaceDocument() {
  const id = uuidv7();
  const owner = { id, emp_id: `SHARE-API-${id}`, name: "Api Owner", org_code: "SHARE" };
  const unitOfWork = new MariaDbUnitOfWork(pool);
  await unitOfWork.run((repositories) => repositories.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(unitOfWork).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(unitOfWork, caller, workspace.id);
  const { documentId } = await new HubKnowledgeCommandServiceImpl(unitOfWork).createDocument(caller, {
    sourceId, parentId: null, title: "Api Doc", markdown: "body", metadata: {},
  });
  return { caller, documentId };
}

describe("share-link API (share-link spec §9.4)", () => {
  it("creates a link and returns its path, never a URL", async () => {
    const { caller, documentId } = await mySpaceDocument();
    as(caller);
    const response = await createLink(post({ label: "team", expiresInDays: 7 }), documentParams(documentId));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.link.path).toMatch(/^\/s\//);
    expect(JSON.stringify(body)).not.toMatch(/https?:\/\//);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects a body that is not a JSON object, and an expiry outside the set", async () => {
    const { caller, documentId } = await mySpaceDocument();
    as(caller);
    expect((await createLink(post([1]), documentParams(documentId))).status).toBe(400);
    const invalid = await createLink(post({ expiresInDays: 2 }), documentParams(documentId));
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error.code).toBe("INVALID_SHARE_LINK_EXPIRY");
  });

  it("answers 409 for a Team document and 404 for someone else's My Space", async () => {
    const { source, folderId } = await createSourceFixture(pool);
    const team = await createDocumentFixture(pool, source.id, folderId);
    as(fixtureCaller());
    const conflict = await createLink(post({}), documentParams(team.documentId));
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).error.code).toBe("SHARE_LINK_NOT_PERSONAL");

    const { documentId } = await mySpaceDocument();
    as(fixtureCaller());
    expect((await listLinks(new Request("http://hub.test"), documentParams(documentId))).status).toBe(404);
  });

  it("revokes with 204 and the list then shows the link inactive", async () => {
    const { caller, documentId } = await mySpaceDocument();
    as(caller);
    const { link } = await (await createLink(post({}), documentParams(documentId))).json();
    const revoked = await revokeLink(new Request("http://hub.test", { method: "POST" }), { params: Promise.resolve({ linkId: link.id }) });
    expect(revoked.status).toBe(204);
    const { links } = await (await listLinks(new Request("http://hub.test"), documentParams(documentId))).json();
    expect(links).toMatchObject([{ id: link.id, active: false }]);
  });

  it("answers 404 when someone else tries to revoke", async () => {
    const { caller, documentId } = await mySpaceDocument();
    as(caller);
    const { link } = await (await createLink(post({}), documentParams(documentId))).json();
    as(fixtureCaller());
    const response = await revokeLink(new Request("http://hub.test", { method: "POST" }), { params: Promise.resolve({ linkId: link.id }) });
    expect(response.status).toBe(404);
  });
});
