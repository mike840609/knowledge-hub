import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { hubDocument, linkOutsider, linkOwner, provisionLinkDatabase, setupLinkScope } from "../fixtures/link-graph";

const injected = vi.hoisted(() => ({ caller: null as unknown, services: null as unknown }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({ ...(injected.services as object), establishTrustedCaller: async () => ({ caller: injected.caller }) }),
}));

import { findReadableDocumentHref } from "@/server/knowledge-read";

/**
 * `/knowledge/new?from=<document>` (daily-driver spec §6.2): the page sends Cancel back to that document —
 * but only when it is one this caller can read, in this workspace. The parameter is an address anyone can
 * write, so what it names is asked of the query service, which authorizes, and anything that does not
 * come back as a readable document of this workspace is ignored, leaving Cancel to go to the list.
 */

let pool: Pool;
let dispose: () => Promise<void>;
const owner = callerFromIdentity(linkOwner);
const outsider = callerFromIdentity(linkOutsider);

beforeAll(async () => {
  ({ pool, dispose } = await provisionLinkDatabase());
  injected.services = { queries: new KnowledgeQueryServiceImpl(new MariaDbUnitOfWork(pool)) };
});
afterAll(async () => {
  await dispose();
});

describe("findReadableDocumentHref", () => {
  it("is where the document is read, for a document of this workspace the caller can read", async () => {
    const scope = await setupLinkScope(pool);
    const document = await hubDocument(pool, scope, "Origin", "x");
    injected.caller = owner;
    expect(await findReadableDocumentHref(scope.workspaceId, document.documentId)).toBe(`/w/${scope.workspaceId}/knowledge/${scope.hubSourceId}/${document.documentId}`);
  });

  it("is nothing for a document of another workspace, even one the caller can read there", async () => {
    const mine = await setupLinkScope(pool);
    const theirs = await setupLinkScope(pool);
    const elsewhere = await hubDocument(pool, theirs, "Elsewhere", "x");
    injected.caller = owner;
    // Readable — the owner made both scopes — but not in `mine`, which is the workspace the page is for.
    expect(await findReadableDocumentHref(theirs.workspaceId, elsewhere.documentId)).not.toBeNull();
    expect(await findReadableDocumentHref(mine.workspaceId, elsewhere.documentId)).toBeNull();
  });

  it("is nothing for someone who cannot read it, and nothing that says the document exists", async () => {
    const scope = await setupLinkScope(pool);
    const document = await hubDocument(pool, scope, "Private", "x");
    injected.caller = outsider;
    expect(await findReadableDocumentHref(scope.workspaceId, document.documentId)).toBeNull();
  });

  it("is nothing for an ID that names nothing, or a document that has been archived", async () => {
    const scope = await setupLinkScope(pool);
    const document = await hubDocument(pool, scope, "Gone", "x");
    injected.caller = owner;
    expect(await findReadableDocumentHref(scope.workspaceId, "0199f500-0000-7000-8000-00000000dead")).toBeNull();
    await pool.query("UPDATE knowledge_documents SET status='ARCHIVED', archived_by=?, archived_at=NOW(6) WHERE id=?", [linkOwner.id, document.documentId]);
    expect(await findReadableDocumentHref(scope.workspaceId, document.documentId)).toBeNull();
  });
});
