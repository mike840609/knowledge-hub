import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { KnowledgeQueryServiceImpl } from "@/modules/knowledge/application/knowledge-query-service";
import { hubDocument, linkOutsider, linkOwner, managedDocument, provisionLinkDatabase, setupLinkScope } from "../fixtures/link-graph";

let pool: Pool;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ pool, dispose } = await provisionLinkDatabase());
});
afterAll(async () => {
  await dispose();
});

const owner = callerFromIdentity(linkOwner);
const outsider = callerFromIdentity(linkOutsider);
const hub = () => new HubKnowledgeCommandServiceImpl(new MariaDbUnitOfWork(pool));
const queries = () => new KnowledgeQueryServiceImpl(new MariaDbUnitOfWork(pool));

describe("duplicating a document", () => {
  it("makes a sibling with the same content and a name that says which is the copy", async () => {
    const scope = await setupLinkScope(pool);
    const original = await hubDocument(pool, scope, "Origin", "# Origin\n\nBody.");
    const copy = await hub().duplicateDocument(owner, original.documentId);

    expect(copy.documentId).not.toBe(original.documentId);
    const current = await queries().getCurrentRevision(owner, copy.documentId);
    expect(current.title).toBe("Origin copy");
    expect(current.markdown).toBe("# Origin copy\n\nBody.");
    const tree = await queries().listTree(owner, scope.hubSourceId);
    const documents = tree.filter((item) => item.type === "document");
    expect(documents.map((item) => item.label)).toContain("Origin copy");
    expect(documents).toHaveLength(2);
  });

  it("refuses a document in a source the Hub does not own", async () => {
    const scope = await setupLinkScope(pool);
    const managed = await managedDocument(pool, scope, "notes/managed.md", "Managed", "Body.");
    await expect(hub().duplicateDocument(owner, managed.documentId)).rejects.toThrow();
  });

  it("refuses someone who is not a member of the workspace", async () => {
    const scope = await setupLinkScope(pool);
    const original = await hubDocument(pool, scope, "Private", "Body.");
    await expect(hub().duplicateDocument(outsider, original.documentId)).rejects.toThrow();
  });
});

describe("a page icon", () => {
  it("is saved on the document, read back with it, and copied with a duplicate", async () => {
    const scope = await setupLinkScope(pool);
    const original = await hubDocument(pool, scope, "Icon page", "Body.");
    expect((await queries().getDocument(owner, original.documentId)).pageIcon).toBeNull();
    expect(await hub().setDocumentIcon(owner, original.documentId, "📌")).toEqual({ icon: "📌" });
    expect((await queries().getDocument(owner, original.documentId)).pageIcon).toBe("📌");

    const copy = await hub().duplicateDocument(owner, original.documentId);
    expect((await queries().getDocument(owner, copy.documentId)).pageIcon).toBe("📌");
    expect(await hub().setDocumentIcon(owner, original.documentId, null)).toEqual({ icon: null });
    expect((await queries().getDocument(owner, original.documentId)).pageIcon).toBeNull();
  });

  it("refuses a glyph the picker does not offer", async () => {
    const scope = await setupLinkScope(pool);
    const original = await hubDocument(pool, scope, "Icon page", "Body.");
    await expect(hub().setDocumentIcon(owner, original.documentId, "🙂")).rejects.toThrow();
  });
});
