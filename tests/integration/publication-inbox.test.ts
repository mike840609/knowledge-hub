import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { notificationHref } from "@/components/knowledge/notification-href";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import type { ShareCommentNotificationView } from "@/modules/knowledge/domain/share-comment-event";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { createPublicationFixture, type PublicationFixture } from "../fixtures/publications";

let fixture: PublicationFixture;
let service: DocumentReviewService;

beforeAll(async () => {
  fixture = await createPublicationFixture();
  service = new DocumentReviewService(fixture.uow, undefined, () => true, () => true);
});
afterAll(async () => {
  await fixture.dispose();
});

const MARKDOWN = "A secret passage here.";

function anchorOf(markdown = MARKDOWN): ReviewAnchor {
  const block = projectReviewBlocks(markdown)[0];
  return {
    schemaVersion: 1, blockPath: block.path, blockKind: block.kind,
    startUtf16: 2, endUtf16: 16, exact: "secret passage", prefix: "A ", suffix: " here.",
  };
}

function identity(name: string): UserIdentity {
  return { id: uuidv7(), emp_id: `INBOX-${randomUUID()}`, name, org_code: "PUBINBOX" };
}

async function addUser(name: string): Promise<{ identity: UserIdentity; caller: CallerContext }> {
  const user = identity(name);
  await fixture.uow.run((repositories) => repositories.users.upsertIdentity(user));
  return { identity: user, caller: callerFromIdentity(user) };
}

/** A direct team member with a fresh user, so no other test's Inbox rows can touch it. */
async function addMember(teamId: string, name: string, role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER") {
  const user = await addUser(name);
  await fixture.uow.run((repositories) => repositories.workspaceMemberships.insert(
    createDirectMembership({ workspaceId: teamId, userId: user.identity.id, role, now: new Date() }),
  ));
  return user;
}

async function removeMember(teamId: string, userId: string) {
  await fixture.uow.run((repositories) => repositories.workspaceMemberships.remove(teamId, userId));
}

/** A group-only member: the caller's validated groups decide access, never a direct row. */
async function groupMember(name: string) {
  const user = await addUser(name);
  return { ...user, caller: { ...user.caller, validatedExternalGroupIds: [fixture.annExternalGroupId] } };
}

async function publishedDocument(options: { teamId?: string; creator: CallerContext; title?: string }) {
  const title = options.title ?? `Team document ${uuidv7()}`;
  // The fixture writes Hub originals through the fixed personal workspaces; the publication names
  // whoever this test treats as creator, which is what review calls the document's owner.
  const original = await fixture.createHubOriginal(fixture.mike, title, MARKDOWN);
  const publication = await fixture.createPublication({
    teamWorkspaceId: options.teamId ?? fixture.teamWorkspaceId,
    name: `Publication ${uuidv7()}`,
    kind: "DOCUMENT",
    creator: options.creator,
    origin: { kind: "DOCUMENT", documentId: original.documentId },
  });
  const document = await fixture.createTeamDocument({
    publication,
    creatorContributionId: publication.contributionId,
    originalDocumentId: original.documentId,
    sourcePath: null,
    title,
    markdown: MARKDOWN,
  });
  return {
    publication,
    documentId: document.teamDocumentId,
    revisionId: await fixture.revisionIdOf(document.teamDocumentId),
    anchor: anchorOf(),
    title,
    markdown: MARKDOWN,
  };
}

const commentIdOf = async (threadId: string): Promise<string> => String((await fixture.pool.query<{ id: string }[]>(
  "SELECT id FROM document_review_comments WHERE thread_id = ? ORDER BY created_at, id LIMIT 1",
  [threadId],
))[0].id);

const eventsOf = async (documentId: string) => fixture.pool.query<{ id: string; read_at: Date | null }[]>(
  "SELECT id, read_at FROM share_comment_events WHERE document_id = ? ORDER BY created_at, id",
  [documentId],
);

const mentionRowsOf = async (commentId: string) => fixture.pool.query<{ mentioned_user_id: string; share_link_id: string | null; read_at: Date | null }[]>(
  "SELECT mentioned_user_id, share_link_id, read_at FROM review_comment_mentions WHERE comment_id = ?",
  [commentId],
);

const entryFrom = (list: { notifications: ShareCommentNotificationView[] }, id: string) =>
  list.notifications.find((entry) => entry.id === id);

const expectNamesNothing = (entry: ShareCommentNotificationView) => {
  expect(entry).toMatchObject({
    workspaceId: "", documentId: "", sourceId: "", documentTitle: "",
    authorName: undefined, excerpt: "", access: { kind: "TEAM", available: false },
  });
  expect(entry.token).toBeUndefined();
  expect(notificationHref(entry)).toBeNull();
};

const teamHref = (workspaceId: string, sourceId: string, documentId: string, threadId: string) =>
  `/w/${workspaceId}/knowledge/${sourceId}/${documentId}?thread=${threadId}`;

describe("team discussion in the Inbox", () => {
  it("delivers a team comment to its creator with a team document link, never a share token", async () => {
    const creator = await addMember(fixture.teamWorkspaceId, "InboxCreator", "EDITOR");
    const commenter = await addMember(fixture.teamWorkspaceId, "InboxCommenter", "EDITOR");
    const doc = await publishedDocument({ creator: creator.caller });

    const thread = await service.createForOwner(commenter.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "A team comment", idempotencyKey: randomUUID(),
    });

    const entry = entryFrom(await service.listUnreadForOwner(creator.caller), (await eventsOf(doc.documentId))[0].id);
    expect(entry).toMatchObject({
      kind: "OWNER", workspaceId: fixture.teamWorkspaceId, documentId: doc.documentId,
      sourceId: doc.publication.sourceId, threadId: thread.id,
      documentTitle: doc.title, authorName: "InboxCommenter", excerpt: "A team comment",
      access: { kind: "TEAM", available: true },
    });
    expect(entry?.token).toBeUndefined();
    expect(notificationHref(entry!)).toBe(teamHref(fixture.teamWorkspaceId, doc.publication.sourceId, doc.documentId, thread.id));
    expect(notificationHref(entry!)).not.toContain("/s/");
    expect(await service.countUnreadForOwner(creator.caller)).toEqual({ count: 1 });
  });

  it("delivers a team mention with the team document link and no share link", async () => {
    const creator = await addMember(fixture.teamWorkspaceId, "MentionCreator", "EDITOR");
    const mentioned = await addMember(fixture.teamWorkspaceId, "MentionedMember", "EDITOR");
    const doc = await publishedDocument({ creator: creator.caller });

    const thread = await service.createForOwner(creator.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "Thanks @MentionedMember", idempotencyKey: randomUUID(), mentions: [mentioned.identity.id],
    });
    expect(await mentionRowsOf(await commentIdOf(thread.id))).toEqual([
      { mentioned_user_id: mentioned.identity.id, share_link_id: null, read_at: null },
    ]);

    const entry = entryFrom(await service.listUnreadForOwner(mentioned.caller), `mention:${await commentIdOf(thread.id)}`);
    expect(entry).toMatchObject({
      kind: "MENTION", workspaceId: fixture.teamWorkspaceId, documentId: doc.documentId,
      sourceId: doc.publication.sourceId, threadId: thread.id, documentTitle: doc.title,
      authorName: "MentionCreator", excerpt: "Thanks @MentionedMember",
      access: { kind: "TEAM", available: true },
    });
    expect(entry?.token).toBeUndefined();
    expect(notificationHref(entry!)).toBe(teamHref(fixture.teamWorkspaceId, doc.publication.sourceId, doc.documentId, thread.id));
    expect(notificationHref(entry!)).not.toContain("/s/");
    expect(await service.countUnreadForOwner(mentioned.caller)).toEqual({ count: 1 });
  });

  it("keeps a direct member's historical entry, names nothing without access, and shows it again on return", async () => {
    const creator = await addMember(fixture.teamWorkspaceId, "DirectCreator", "EDITOR");
    const commenter = await addMember(fixture.teamWorkspaceId, "DirectCommenter", "EDITOR");
    const doc = await publishedDocument({ creator: creator.caller });
    const thread = await service.createForOwner(commenter.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "Direct membership", idempotencyKey: randomUUID(),
    });
    const eventId = (await eventsOf(doc.documentId))[0].id;

    expect(entryFrom(await service.listUnreadForOwner(creator.caller), eventId)).toMatchObject({ access: { kind: "TEAM", available: true } });

    await removeMember(fixture.teamWorkspaceId, creator.identity.id);

    expect(entryFrom(await service.listUnreadForOwner(creator.caller), eventId)).toBeUndefined();
    expect(await service.countUnreadForOwner(creator.caller)).toEqual({ count: 0 });
    const lost = entryFrom(await service.listActivityForOwner(creator.caller), eventId)!;
    expectNamesNothing(lost);
    await expect(service.markEventRead(creator.caller, eventId)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service.markThreadRead(creator.caller, doc.documentId, thread.id)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service.markDocumentRead(creator.caller, doc.documentId)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expect((await eventsOf(doc.documentId))[0].read_at).toBeNull();

    await fixture.uow.run((repositories) => repositories.workspaceMemberships.insert(
      createDirectMembership({ workspaceId: fixture.teamWorkspaceId, userId: creator.identity.id, role: "EDITOR", now: new Date() }),
    ));
    const regained = entryFrom(await service.listActivityForOwner(creator.caller), eventId)!;
    expect(regained).toMatchObject({ documentTitle: doc.title, authorName: "DirectCommenter", excerpt: "Direct membership", access: { kind: "TEAM", available: true } });
    expect(notificationHref(regained)).toBe(teamHref(fixture.teamWorkspaceId, doc.publication.sourceId, doc.documentId, thread.id));
    expect(entryFrom(await service.listUnreadForOwner(creator.caller), eventId)).toBeDefined();
    expect(await service.countUnreadForOwner(creator.caller)).toEqual({ count: 1 });
  });

  it("re-judges the caller's validated group on every request", async () => {
    const creator = await groupMember("GroupCreator");
    const doc = await publishedDocument({ teamId: fixture.groupTeamWorkspaceId, creator: creator.caller });
    const thread = await service.createForOwner(creator.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "Group discussion", idempotencyKey: randomUUID(),
    });
    await service.replyForOwner(fixture.mike, {
      documentId: doc.documentId, threadId: thread.id, body: "GROUP SECRET", idempotencyKey: randomUUID(),
    });
    const eventId = (await eventsOf(doc.documentId))[0].id;

    const withoutGroup = { ...creator.caller, validatedExternalGroupIds: [] };
    expect(entryFrom(await service.listUnreadForOwner(withoutGroup), eventId)).toBeUndefined();
    expect(await service.countUnreadForOwner(withoutGroup)).toEqual({ count: 0 });
    const lost = entryFrom(await service.listActivityForOwner(withoutGroup), eventId)!;
    expectNamesNothing(lost);
    expect(JSON.stringify(lost)).not.toContain("GROUP SECRET");

    const regained = entryFrom(await service.listActivityForOwner(creator.caller), eventId)!;
    expect(regained).toMatchObject({ documentTitle: doc.title, access: { kind: "TEAM", available: true } });
    expect(entryFrom(await service.listUnreadForOwner(creator.caller), eventId)).toBeDefined();
  });

  it("marks all read only for rows the caller can still read, skipping inaccessible team rows", async () => {
    const creator = await addMember(fixture.teamWorkspaceId, "BulkCreator", "EDITOR");
    const mixed: CallerContext = { ...creator.caller, validatedExternalGroupIds: [fixture.annExternalGroupId] };
    const directCommenter = await addMember(fixture.teamWorkspaceId, "BulkDirectCommenter", "EDITOR");
    const directDoc = await publishedDocument({ creator: mixed });
    await service.createForOwner(directCommenter.caller, {
      documentId: directDoc.documentId, expectedRevisionId: directDoc.revisionId, anchor: directDoc.anchor,
      body: "Readable team comment", idempotencyKey: randomUUID(),
    });
    const groupDoc = await publishedDocument({ teamId: fixture.groupTeamWorkspaceId, creator: mixed });
    await service.createForOwner(fixture.mike, {
      documentId: groupDoc.documentId, expectedRevisionId: groupDoc.revisionId, anchor: groupDoc.anchor,
      body: "Unreadable team comment", idempotencyKey: randomUUID(),
    });
    const directEvent = (await eventsOf(directDoc.documentId))[0];
    const groupEvent = (await eventsOf(groupDoc.documentId))[0];
    expect(directEvent.read_at).toBeNull();
    expect(groupEvent.read_at).toBeNull();
    expect(await service.countUnreadForOwner(mixed)).toEqual({ count: 2 });

    const withoutGroup = { ...mixed, validatedExternalGroupIds: [] };
    await service.markAllActivityRead(withoutGroup);

    const directAfter = (await eventsOf(directDoc.documentId))[0];
    const groupAfter = (await eventsOf(groupDoc.documentId))[0];
    expect(directAfter.read_at).not.toBeNull();
    expect(groupAfter.read_at).toBeNull();
    expect(await service.countUnreadForOwner(withoutGroup)).toEqual({ count: 0 });
  });

  it("does not auto-read a team mention whose access was lost, so it returns with access", async () => {
    const mentioned = await addMember(fixture.teamWorkspaceId, "MentionedLost", "EDITOR");
    const writer = await addMember(fixture.teamWorkspaceId, "MentionWriter", "EDITOR");
    const doc = await publishedDocument({ creator: writer.caller });
    const thread = await service.createForOwner(writer.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "@MentionedLost this needs you", idempotencyKey: randomUUID(), mentions: [mentioned.identity.id],
    });
    const commentId = await commentIdOf(thread.id);
    expect(await service.countUnreadForOwner(mentioned.caller)).toEqual({ count: 1 });

    await removeMember(fixture.teamWorkspaceId, mentioned.identity.id);
    expect(entryFrom(await service.listUnreadForOwner(mentioned.caller), `mention:${commentId}`)).toBeUndefined();
    expect(await service.countUnreadForOwner(mentioned.caller)).toEqual({ count: 0 });
    expect((await mentionRowsOf(commentId))[0].read_at).toBeNull();
    const lost = entryFrom(await service.listActivityForOwner(mentioned.caller), `mention:${commentId}`)!;
    expectNamesNothing(lost);
    expect(lost.readAt).toBeNull();

    await fixture.uow.run((repositories) => repositories.workspaceMemberships.insert(
      createDirectMembership({ workspaceId: fixture.teamWorkspaceId, userId: mentioned.identity.id, role: "EDITOR", now: new Date() }),
    ));
    const regained = entryFrom(await service.listUnreadForOwner(mentioned.caller), `mention:${commentId}`)!;
    expect(regained).toMatchObject({ kind: "MENTION", documentTitle: doc.title, access: { kind: "TEAM", available: true } });
    expect(notificationHref(regained)).toBe(teamHref(fixture.teamWorkspaceId, doc.publication.sourceId, doc.documentId, thread.id));
  });

  it("keeps team entries out of My Shares per-share counts", async () => {
    const creator = await addMember(fixture.teamWorkspaceId, "CountsCreator", "EDITOR");
    const commenter = await addMember(fixture.teamWorkspaceId, "CountsCommenter", "EDITOR");
    const doc = await publishedDocument({ creator: creator.caller });
    await service.createForOwner(commenter.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "Counted in the Inbox", idempotencyKey: randomUUID(),
    });
    expect(await service.listUnreadShareCountsForOwner(creator.caller)).toEqual([]);
    expect(await service.countUnreadForOwner(creator.caller)).toEqual({ count: 1 });
  });

  it("re-judges membership and creator rights before hiding", async () => {
    const creator = await addMember(fixture.teamWorkspaceId, "HideCreator", "EDITOR");
    const member = await addMember(fixture.teamWorkspaceId, "HideMember", "EDITOR");
    const doc = await publishedDocument({ creator: creator.caller });
    const first = await service.createForOwner(member.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "First discussion", idempotencyKey: randomUUID(),
    });
    const second = await service.createForOwner(member.caller, {
      documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
      body: "Second discussion", idempotencyKey: randomUUID(),
    });

    await expect(service.setVisibility(member.caller, {
      documentId: doc.documentId, threadId: first.id, visibility: "HIDDEN", reason: "member cannot",
    })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await service.setVisibility(creator.caller, {
      documentId: doc.documentId, threadId: first.id, visibility: "HIDDEN", reason: "creator can",
    });

    await removeMember(fixture.teamWorkspaceId, creator.identity.id);
    await expect(service.setVisibility(creator.caller, {
      documentId: doc.documentId, threadId: second.id, visibility: "HIDDEN", reason: "lost access",
    })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });
});
