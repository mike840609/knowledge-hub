import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "mariadb";
import { databaseConfig } from "@/infrastructure/database/mariadb/config";
import { createDatabasePool } from "@/infrastructure/database/mariadb/pool";
import { MariaDbUnitOfWork } from "@/infrastructure/database/mariadb/transaction";
import { RandomShareTokenIssuer } from "@/infrastructure/security/random-share-token-issuer";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { DocumentShareService } from "@/modules/knowledge/application/document-share-service";
import { HubKnowledgeCommandServiceImpl } from "@/modules/knowledge/application/hub-knowledge-command-service";
import { MAX_NAMED_SHARE_RECIPIENTS } from "@/modules/knowledge/domain/document-share-link";
import { MENTION_LIMIT } from "@/modules/knowledge/domain/review-mention";
import { ensureDefaultHubSource } from "@/modules/sources/application/ensure-default-hub-source";
import { PersonalWorkspaceService } from "@/modules/workspaces/application/personal-workspace-service";
import { uuidv7 } from "@/shared/ids/uuidv7";

/** Named-recipient share spec: the owner creates a NAMED link and manages who it names. */

let pool: Pool;
beforeAll(() => { pool = createDatabasePool(databaseConfig("test")); });
afterAll(async () => { await pool.end(); });

const unitOfWork = () => new MariaDbUnitOfWork(pool);
const service = () => new DocumentShareService(unitOfWork(), new RandomShareTokenIssuer());
const notFound = { code: "SHARE_LINK_NOT_FOUND" };
const invalid = { code: "INVALID_REQUEST" };

function newIdentity(name: string, empPrefix = "NAMED-MGMT"): UserIdentity {
  const id = uuidv7();
  return { id, emp_id: `${empPrefix}-${id}`, name, org_code: "SHARE" };
}

async function newUser(name: string, empPrefix?: string): Promise<UserIdentity> {
  const identity = newIdentity(name, empPrefix);
  await unitOfWork().run((r) => r.users.upsertIdentity(identity));
  return identity;
}

async function setup() {
  const owner = newIdentity("Named Mgmt Owner");
  const uow = unitOfWork();
  await uow.run((r) => r.users.upsertIdentity(owner));
  const { workspace } = await new PersonalWorkspaceService(uow).ensurePersonalWorkspace(owner.id);
  const caller = callerFromIdentity(owner);
  const sourceId = await ensureDefaultHubSource(uow, caller, workspace.id);
  const hub = new HubKnowledgeCommandServiceImpl(uow);
  const { treeNodeId: folderNodeId } = await hub.createFolder(caller, { sourceId, parentId: null, name: "Shared" });
  const doc = await hub.createDocument(caller, { sourceId, parentId: folderNodeId, title: "Inside", markdown: "Inside body", metadata: {} });
  const alice = await newUser("Alice");
  const bob = await newUser("Bob");
  const stranger = await newUser("Stranger");
  return { owner, caller, workspaceId: workspace.id, sourceId, folderNodeId, documentId: doc.documentId, alice, bob, stranger, shares: service() };
}
type Fixture = Awaited<ReturnType<typeof setup>>;

async function namedDocLink(f: Fixture, recipients: string[] = [f.alice.id]) {
  return f.shares.create(f.caller, { documentId: f.documentId, label: "Named", recipients });
}

async function auditPayloads(workspaceId: string, eventType: string): Promise<Array<Record<string, unknown>>> {
  const rows = await pool.query<Array<{ payload: unknown }>>("SELECT payload FROM workspace_audit_events WHERE workspace_id = ? AND event_type = ? ORDER BY created_at, id", [workspaceId, eventType]);
  return rows.map((row) => (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>);
}

describe("creating a named share", () => {
  it("creates a NAMED document share: no expiry, recipients normalised, only they can read it", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, label: "For Alice", recipients: [f.alice.id.toUpperCase(), f.alice.id, f.bob.id] });
    expect(view).toMatchObject({ audience: "NAMED", expiresAt: null, recipientCount: 2, active: true, label: "For Alice" });
    const token = view.path.slice(3);
    await expect(f.shares.readShared(token, { viewerId: f.alice.id })).resolves.toMatchObject({ kind: "DOCUMENT", audience: "NAMED" });
    await expect(f.shares.readShared(token, { viewerId: f.bob.id })).resolves.toMatchObject({ kind: "DOCUMENT" });
    await expect(f.shares.readShared(token, { viewerId: f.stranger.id })).rejects.toMatchObject(notFound);
    await expect(f.shares.readShared(token)).rejects.toMatchObject(notFound);
    const [event] = await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_LINK_CREATED");
    expect(event).toMatchObject({ audience: "NAMED", documentId: f.documentId, expiresAt: null });
    expect([...(event.recipientIds as string[])].sort()).toEqual([f.alice.id, f.bob.id].sort());
  });

  it("creates a NAMED folder share", async () => {
    const f = await setup();
    const view = await f.shares.createForFolder(f.caller, { folderNodeId: f.folderNodeId, recipients: [f.alice.id] });
    expect(view).toMatchObject({ audience: "NAMED", expiresAt: null, recipientCount: 1 });
    await expect(f.shares.readShared(view.path.slice(3), { viewerId: f.alice.id })).resolves.toMatchObject({ kind: "FOLDER", audience: "NAMED" });
    await expect(f.shares.readShared(view.path.slice(3), { viewerId: f.stranger.id })).rejects.toMatchObject(notFound);
    expect((await f.shares.listForFolder(f.caller, f.folderNodeId)).map((l) => [l.id, l.audience, l.recipientCount])).toEqual([[view.id, "NAMED", 1]]);
  });

  it("keeps a LINK share as it was, with no recipient count", async () => {
    const f = await setup();
    const view = await f.shares.create(f.caller, { documentId: f.documentId, expiresInDays: 7 });
    expect(view).toMatchObject({ audience: "LINK", recipientCount: null });
    expect(view.expiresAt).toBeInstanceOf(Date);
    expect((await f.shares.list(f.caller, f.documentId))[0]).toMatchObject({ audience: "LINK", recipientCount: null });
    const [event] = await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_LINK_CREATED");
    expect(event).toMatchObject({ audience: "LINK", recipientIds: [] });
  });

  it("lists a NAMED share's recipient count", async () => {
    const f = await setup();
    const view = await namedDocLink(f, [f.alice.id, f.bob.id]);
    expect((await f.shares.list(f.caller, f.documentId)).find((l) => l.id === view.id)).toMatchObject({ audience: "NAMED", recipientCount: 2 });
  });

  it.each([
    ["the owner as a recipient", (f: Fixture) => ({ recipients: [f.owner.id] })],
    ["an unknown user id", () => ({ recipients: [uuidv7()] })],
    ["an unknown id beside a known one", (f: Fixture) => ({ recipients: [f.alice.id, uuidv7()] })],
    ["an empty list", () => ({ recipients: [] })],
    ["a non-list", () => ({ recipients: "nobody" })],
    ["a malformed id", () => ({ recipients: ["not-a-uuid"] })],
    ["expiresInDays", (f: Fixture) => ({ recipients: [f.alice.id], expiresInDays: 7 })],
    ["more than the cap", () => ({ recipients: Array.from({ length: MAX_NAMED_SHARE_RECIPIENTS + 1 }, () => uuidv7()) })],
  ])("refuses %s with INVALID_REQUEST and creates nothing", async (_name, input) => {
    const f = await setup();
    await expect(f.shares.create(f.caller, { documentId: f.documentId, ...input(f) })).rejects.toMatchObject(invalid);
    await expect(f.shares.createForFolder(f.caller, { folderNodeId: f.folderNodeId, ...input(f) })).rejects.toMatchObject(invalid);
    expect(await f.shares.list(f.caller, f.documentId)).toEqual([]);
    expect(await f.shares.listForFolder(f.caller, f.folderNodeId)).toEqual([]);
  });

  it("counts LINK and NAMED links together toward the active limit", async () => {
    const f = await setup();
    for (let i = 0; i < 5; i++) await f.shares.create(f.caller, { documentId: f.documentId });
    for (let i = 0; i < 5; i++) await namedDocLink(f);
    await expect(namedDocLink(f)).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED" });
    await expect(f.shares.create(f.caller, { documentId: f.documentId })).rejects.toMatchObject({ code: "SHARE_LINK_LIMIT_REACHED" });
  });
});

describe("managing recipients", () => {
  it("lets the owner list, add and remove recipients; duplicates are ignored and ids normalised", async () => {
    const f = await setup();
    const link = await namedDocLink(f, [f.alice.id]);
    await f.shares.addRecipients(f.caller, link.id, [f.alice.id.toUpperCase(), f.bob.id.toUpperCase(), f.bob.id]);
    const listed = await f.shares.listRecipients(f.caller, link.id);
    expect(listed.map((r) => r.userId).sort()).toEqual([f.alice.id, f.bob.id].sort());
    expect(listed.find((r) => r.userId === f.bob.id)).toMatchObject({ name: "Bob", nameEn: null, empId: f.bob.emp_id, addedAt: expect.any(Date) });
    expect((await f.shares.list(f.caller, f.documentId))[0].recipientCount).toBe(2);

    const token = link.path.slice(3);
    await expect(f.shares.readShared(token, { viewerId: f.bob.id })).resolves.toMatchObject({ kind: "DOCUMENT" });
    await f.shares.removeRecipient(f.caller, link.id, f.bob.id.toUpperCase());
    expect((await f.shares.listRecipients(f.caller, link.id)).map((r) => r.userId)).toEqual([f.alice.id]);
    await expect(f.shares.readShared(token, { viewerId: f.bob.id })).rejects.toMatchObject(notFound);
    await expect(f.shares.readShared(token, { viewerId: f.alice.id })).resolves.toMatchObject({ kind: "DOCUMENT" });
    // Removing someone who is not a recipient is a no-op.
    await f.shares.removeRecipient(f.caller, link.id, f.stranger.id);
  });

  it("writes an audit event for each recipient actually added or removed", async () => {
    const f = await setup();
    const link = await namedDocLink(f, [f.alice.id]);
    await f.shares.addRecipients(f.caller, link.id, [f.alice.id, f.bob.id]);
    await f.shares.removeRecipient(f.caller, link.id, f.bob.id);
    await f.shares.removeRecipient(f.caller, link.id, f.stranger.id);
    expect(await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_RECIPIENT_ADDED")).toEqual([{ userId: f.bob.id }]);
    expect(await auditPayloads(f.workspaceId, "DOCUMENT_SHARE_RECIPIENT_REMOVED")).toEqual([{ userId: f.bob.id }]);
  });

  it("refuses an unknown or malformed id and a naming of the owner, adding nothing", async () => {
    const f = await setup();
    const link = await namedDocLink(f, [f.alice.id]);
    await expect(f.shares.addRecipients(f.caller, link.id, [f.bob.id, uuidv7()])).rejects.toMatchObject(invalid);
    await expect(f.shares.addRecipients(f.caller, link.id, ["nope"])).rejects.toMatchObject(invalid);
    await expect(f.shares.addRecipients(f.caller, link.id, [f.owner.id])).rejects.toMatchObject(invalid);
    await expect(f.shares.addRecipients(f.caller, link.id, [])).rejects.toMatchObject(invalid);
    await expect(f.shares.addRecipients(f.caller, link.id, "x")).rejects.toMatchObject(invalid);
    await expect(f.shares.removeRecipient(f.caller, link.id, "nope")).rejects.toMatchObject(invalid);
    expect((await f.shares.listRecipients(f.caller, link.id)).map((r) => r.userId)).toEqual([f.alice.id]);
  });

  it("caps recipients at 50 counting those already named", async () => {
    const f = await setup();
    const users = await Promise.all(Array.from({ length: MAX_NAMED_SHARE_RECIPIENTS }, (_, i) => newUser(`Cap ${i}`, "NAMED-CAP")));
    const link = await namedDocLink(f, users.map((u) => u.id));
    expect(link.recipientCount).toBe(MAX_NAMED_SHARE_RECIPIENTS);
    await expect(f.shares.addRecipients(f.caller, link.id, [f.alice.id])).rejects.toMatchObject(invalid);
    // Re-naming someone already there adds nobody, so it fits.
    await f.shares.addRecipients(f.caller, link.id, [users[0].id]);
    expect((await f.shares.listRecipients(f.caller, link.id))).toHaveLength(MAX_NAMED_SHARE_RECIPIENTS);
    await f.shares.removeRecipient(f.caller, link.id, users[1].id);
    await f.shares.addRecipients(f.caller, link.id, [f.alice.id]);
    expect((await f.shares.listRecipients(f.caller, link.id))).toHaveLength(MAX_NAMED_SHARE_RECIPIENTS);
  });

  it("answers anyone but the link's owner as a dead link", async () => {
    const f = await setup();
    const link = await namedDocLink(f);
    const other = callerFromIdentity(f.stranger);
    await expect(f.shares.listRecipients(other, link.id)).rejects.toMatchObject(notFound);
    await expect(f.shares.addRecipients(other, link.id, [f.bob.id])).rejects.toMatchObject(notFound);
    await expect(f.shares.removeRecipient(other, link.id, f.alice.id)).rejects.toMatchObject(notFound);
    await expect(f.shares.listRecipients(f.caller, uuidv7())).rejects.toMatchObject(notFound);
    expect((await f.shares.listRecipients(f.caller, link.id)).map((r) => r.userId)).toEqual([f.alice.id]);
  });

  it("refuses to manage recipients of a LINK share", async () => {
    const f = await setup();
    const link = await f.shares.create(f.caller, { documentId: f.documentId });
    await expect(f.shares.listRecipients(f.caller, link.id)).rejects.toMatchObject(invalid);
    await expect(f.shares.addRecipients(f.caller, link.id, [f.alice.id])).rejects.toMatchObject(invalid);
    await expect(f.shares.removeRecipient(f.caller, link.id, f.alice.id)).rejects.toMatchObject(invalid);
  });

  it("refuses to manage recipients of a revoked share, and revoking closes the read", async () => {
    const f = await setup();
    const link = await namedDocLink(f);
    await f.shares.revoke(f.caller, link.id);
    await expect(f.shares.readShared(link.path.slice(3), { viewerId: f.alice.id })).rejects.toMatchObject(notFound);
    await expect(f.shares.listRecipients(f.caller, link.id)).rejects.toMatchObject(notFound);
    await expect(f.shares.addRecipients(f.caller, link.id, [f.bob.id])).rejects.toMatchObject(notFound);
    await expect(f.shares.removeRecipient(f.caller, link.id, f.alice.id)).rejects.toMatchObject(notFound);
  });
});

describe("recipient candidates", () => {
  it("finds existing users by name, never the caller, and answers nothing for an empty query", async () => {
    const f = await setup();
    const marker = `Zq${uuidv7().slice(-8)}`;
    const me = callerFromIdentity(await newUser(`${marker} Me`));
    const peer = await newUser(`${marker} Peer`);
    const found = await f.shares.searchRecipientCandidates(me, marker);
    expect(found.candidates).toEqual([{ id: peer.id, name: peer.name, nameEn: null, empId: peer.emp_id }]);
    expect(found.candidates.map((c) => c.id)).not.toContain(me.identity.id);
    expect(await f.shares.searchRecipientCandidates(me, "   ")).toEqual({ candidates: [] });
    expect(await f.shares.searchRecipientCandidates(me, "")).toEqual({ candidates: [] });
  });

  it("returns at most MENTION_LIMIT candidates even when the caller matches", async () => {
    const f = await setup();
    const marker = `Lm${uuidv7().slice(-8)}`;
    const me = callerFromIdentity(await newUser(`${marker} 00 Me`));
    for (let i = 0; i < MENTION_LIMIT + 2; i++) await newUser(`${marker} ${String(i + 1).padStart(2, "0")}`);
    const found = await f.shares.searchRecipientCandidates(me, marker);
    expect(found.candidates).toHaveLength(MENTION_LIMIT);
    expect(found.candidates.map((c) => c.id)).not.toContain(me.identity.id);
  });
});
