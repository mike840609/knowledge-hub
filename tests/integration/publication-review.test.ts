import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocumentReviewService } from "@/modules/knowledge/application/document-review-service";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";
import { projectReviewBlocks } from "@/modules/knowledge/domain/review-anchor";
import { callerFromIdentity, type CallerContext } from "@/modules/identity/domain/caller-context";
import type { UserIdentity } from "@/modules/identity/domain/user-identity";
import { createDirectMembership } from "@/modules/workspaces/domain/workspace-membership";
import { uuidv7 } from "@/shared/ids/uuidv7";
import {
  annIdentity,
  createPublicationFixture,
  mikeIdentity,
  type PublicationFixture,
} from "../fixtures/publications";

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
    schemaVersion: 1,
    blockPath: block.path,
    blockKind: block.kind,
    startUtf16: 2,
    endUtf16: 16,
    exact: "secret passage",
    prefix: "A ",
    suffix: " here.",
  };
}

function identity(name: string): UserIdentity {
  return { id: uuidv7(), emp_id: `PUB-${randomUUID()}`, name, org_code: "PUBREVIEW" };
}

/** A signed-in user with no membership anywhere. */
async function addUser(user: UserIdentity): Promise<CallerContext> {
  await fixture.uow.run((repositories) => repositories.users.upsertIdentity(user));
  return callerFromIdentity(user);
}

/** A direct member of a team, created with the same row a governance grant writes. */
async function addMember(teamId: string, user: UserIdentity, role: "OWNER" | "ADMIN" | "EDITOR" | "VIEWER"): Promise<CallerContext> {
  await fixture.uow.run(async (repositories) => {
    await repositories.users.upsertIdentity(user);
    await repositories.workspaceMemberships.insert(createDirectMembership({ workspaceId: teamId, userId: user.id, role, now: new Date() }));
  });
  return callerFromIdentity(user);
}

/** A published team document, its first revision and an anchor into that revision. */
async function publishedDocument(options: {
  teamId?: string;
  creator?: CallerContext;
  markdown?: string;
  title?: string;
}) {
  const creator = options.creator ?? fixture.mike;
  const title = options.title ?? `Team document ${uuidv7()}`;
  const markdown = options.markdown ?? MARKDOWN;
  const original = await fixture.createHubOriginal(creator, title, markdown);
  const publication = await fixture.createPublication({
    teamWorkspaceId: options.teamId ?? fixture.teamWorkspaceId,
    name: `Publication ${uuidv7()}`,
    kind: "DOCUMENT",
    creator,
    origin: { kind: "DOCUMENT", documentId: original.documentId },
  });
  const document = await fixture.createTeamDocument({
    publication,
    creatorContributionId: publication.contributionId,
    originalDocumentId: original.documentId,
    sourcePath: null,
    title,
    markdown,
  });
  return {
    publication,
    documentId: document.teamDocumentId,
    revisionId: await fixture.revisionIdOf(document.teamDocumentId),
    anchor: anchorOf(markdown),
    markdown,
    title,
  };
}

const commentIdOf = async (threadId: string): Promise<string> => {
  const rows = await fixture.pool.query<{ id: string }[]>(
    "SELECT id FROM document_review_comments WHERE thread_id = ? ORDER BY created_at, id LIMIT 1",
    [threadId],
  );
  return String(rows[0].id);
};

const eventsOf = async (documentId: string) =>
  fixture.pool.query<{ comment_id: string; recipient_user_id: string | null; origin_share_link_id: string | null }[]>(
    "SELECT comment_id, recipient_user_id, origin_share_link_id FROM share_comment_events WHERE document_id = ? ORDER BY created_at, id",
    [documentId],
  );

describe("publication review scope", () => {
  it("lets direct and group members read and comment, and hides the document from non-members", async () => {
    const doc = await publishedDocument({});
    const viewer = identity("Viewer");
    const viewerCaller = await addMember(fixture.teamWorkspaceId, viewer, "VIEWER");

    // A direct EDITOR reads the member projection and knows who owns the discussion.
    const annRead = await service.queryForOwner(fixture.ann, doc.documentId);
    expect(annRead).toMatchObject({ ownerUserId: mikeIdentity.id, canModerate: false });
    expect(annRead.threads).toEqual([]);

    const annThread = await service.createForOwner(fixture.ann, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Ann asks on the team document",
      idempotencyKey: randomUUID(),
    });
    expect(annThread.comments[0]).toMatchObject({ body: "Ann asks on the team document", own: true });

    // An existing direct VIEWER may read and comment too.
    const viewerThread = await service.createForOwner(viewerCaller, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Viewer comments",
      idempotencyKey: randomUUID(),
    });
    expect(viewerThread.id).not.toBe(annThread.id);
    expect((await service.queryForOwner(viewerCaller, doc.documentId)).threads).toHaveLength(2);

    // Ann is only in the group team through her validated SSO group; she can still read and comment.
    const groupDoc = await publishedDocument({ teamId: fixture.groupTeamWorkspaceId });
    const groupRead = await service.queryForOwner(fixture.ann, groupDoc.documentId);
    expect(groupRead).toMatchObject({ ownerUserId: mikeIdentity.id, canModerate: false });
    await expect(service.createForOwner(fixture.ann, {
      documentId: groupDoc.documentId,
      expectedRevisionId: groupDoc.revisionId,
      anchor: groupDoc.anchor,
      body: "Group member asks",
      idempotencyKey: randomUUID(),
    })).resolves.toMatchObject({ comments: [{ body: "Group member asks" }] });

    const outsider = await addUser(identity("Outsider"));
    await expect(service.queryForOwner(outsider, doc.documentId)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service.createForOwner(outsider, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "An outsider must not comment",
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service.queryForOwner(outsider, randomUUID())).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });

  it("lets only the creator or an admin hide, and never returns hidden bodies to ordinary members", async () => {
    const doc = await publishedDocument({});
    const adminCaller = await addMember(fixture.teamWorkspaceId, identity("Admin"), "ADMIN");

    const thread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Creator opens",
      idempotencyKey: randomUUID(),
    });
    const annComment = await service.replyForOwner(fixture.ann, {
      documentId: doc.documentId,
      threadId: thread.id,
      body: "HIDDEN TEAM SECRET",
      idempotencyKey: randomUUID(),
    });

    await expect(service.setVisibility(fixture.ann, {
      documentId: doc.documentId, threadId: thread.id, commentId: annComment.id, visibility: "HIDDEN", reason: "not yours",
    })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });

    // The creator may hide any comment.
    await service.setVisibility(fixture.mike, {
      documentId: doc.documentId, threadId: thread.id, commentId: annComment.id, visibility: "HIDDEN", reason: "moderated",
    });
    const memberView = await service.queryForOwner(fixture.ann, doc.documentId);
    expect(JSON.stringify(memberView)).not.toContain("HIDDEN TEAM SECRET");
    if (memberView.canModerate) throw new Error("expected the member projection");
    expect(memberView.threads[0].comments.find(comment => comment.id === annComment.id)?.body).not.toBe("HIDDEN TEAM SECRET");

    // The creator reads the moderator projection, which still names the body.
    const creatorView = await service.queryForOwner(fixture.mike, doc.documentId);
    expect(creatorView).toMatchObject({ canModerate: true });
    if (!creatorView.canModerate) throw new Error("expected the owner projection");
    expect(creatorView.threads[0]).toMatchObject({ visibility: "VISIBLE" });
    expect(JSON.stringify(creatorView)).toContain("HIDDEN TEAM SECRET");

    // A member may edit or delete only their own comment.
    const own = await service.replyForOwner(fixture.ann, {
      documentId: doc.documentId,
      threadId: thread.id,
      body: "Ann's own words",
      idempotencyKey: randomUUID(),
    });
    await expect(service.editForOwner(fixture.ann, { documentId: doc.documentId, threadId: thread.id, commentId: thread.comments[0].id, body: "takeover" }))
      .rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service.deleteForOwner(fixture.ann, { documentId: doc.documentId, threadId: thread.id, commentId: thread.comments[0].id }))
      .rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await service.editForOwner(fixture.ann, { documentId: doc.documentId, threadId: thread.id, commentId: own.id, body: "Ann revised" });
    await service.deleteForOwner(fixture.ann, { documentId: doc.documentId, threadId: thread.id, commentId: own.id });

    // An ADMIN may hide a whole discussion; an ordinary member may not.
    await expect(service.setVisibility(fixture.ann, { documentId: doc.documentId, threadId: thread.id, visibility: "HIDDEN" }))
      .rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await service.setVisibility(adminCaller, { documentId: doc.documentId, threadId: thread.id, visibility: "HIDDEN", reason: "admin" });
    expect((await service.queryForOwner(fixture.ann, doc.documentId)).threads).toEqual([]);
    expect((await service.queryForOwner(fixture.mike, doc.documentId)).threads[0]).toMatchObject({ visibility: "HIDDEN" });
  });

  it("notifies only the document creator and never auto-follows a team commenter", async () => {
    const doc = await publishedDocument({});
    const bob = await addMember(fixture.teamWorkspaceId, identity("Bob"), "EDITOR");

    const annThread = await service.createForOwner(fixture.ann, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Ann comments on Mike's document",
      idempotencyKey: randomUUID(),
    });
    const [annEvent] = await eventsOf(doc.documentId);
    expect(annEvent).toMatchObject({ comment_id: await commentIdOf(annThread.id), recipient_user_id: fixture.mike.identity.id, origin_share_link_id: null });

    await service.replyForOwner(bob, {
      documentId: doc.documentId,
      threadId: annThread.id,
      body: "Bob replies",
      idempotencyKey: randomUUID(),
    });
    const afterReply = await eventsOf(doc.documentId);
    expect(afterReply).toHaveLength(2);
    expect(afterReply.every(event => event.recipient_user_id === fixture.mike.identity.id && event.origin_share_link_id === null)).toBe(true);
    expect(afterReply.some(event => event.recipient_user_id === fixture.ann.identity.id)).toBe(false);

    // Writing in a team discussion creates no follow at all.
    const follows = await fixture.pool.query<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM review_thread_follows WHERE thread_id = ? AND user_id = ?",
      [annThread.id, fixture.ann.identity.id],
    );
    expect(Number(follows[0].count)).toBe(0);

    // The creator commenting on their own document tells nobody.
    const ownThread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Mike notes",
      idempotencyKey: randomUUID(),
    });
    const ownCommentId = await commentIdOf(ownThread.id);
    expect((await eventsOf(doc.documentId)).filter(event => event.comment_id === ownCommentId)).toEqual([]);

    // On a document Ann created, she is the owner: her comment is self, Bob's comment reaches her.
    const annDoc = await publishedDocument({ creator: fixture.ann });
    const annOwnThread = await service.createForOwner(fixture.ann, {
      documentId: annDoc.documentId,
      expectedRevisionId: annDoc.revisionId,
      anchor: annDoc.anchor,
      body: "Ann writes on her own team document",
      idempotencyKey: randomUUID(),
    });
    expect(await eventsOf(annDoc.documentId)).toEqual([]);
    await service.replyForOwner(bob, {
      documentId: annDoc.documentId,
      threadId: annOwnThread.id,
      body: "Bob answers Ann",
      idempotencyKey: randomUUID(),
    });
    expect(await eventsOf(annDoc.documentId)).toMatchObject([
      { recipient_user_id: fixture.ann.identity.id, origin_share_link_id: null },
    ]);
  });

  it("lets only the creator and admins resolve or reopen a discussion", async () => {
    const doc = await publishedDocument({});
    const adminCaller = await addMember(fixture.teamWorkspaceId, identity("ResolveAdmin"), "ADMIN");
    const thread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Creator opens",
      idempotencyKey: randomUUID(),
    });

    await expect(service.setResolution(fixture.ann, { documentId: doc.documentId, threadId: thread.id, status: "RESOLVED" }))
      .rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await service.setResolution(fixture.mike, { documentId: doc.documentId, threadId: thread.id, status: "RESOLVED" });
    expect((await service.queryForOwner(fixture.ann, doc.documentId)).threads[0]).toMatchObject({ status: "RESOLVED" });

    await expect(service.setResolution(fixture.ann, { documentId: doc.documentId, threadId: thread.id, status: "OPEN" }))
      .rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await service.setResolution(adminCaller, { documentId: doc.documentId, threadId: thread.id, status: "OPEN" });
    expect((await service.queryForOwner(fixture.ann, doc.documentId)).threads[0]).toMatchObject({ status: "OPEN" });

    // A hidden discussion is still moderation: a member cannot resolve it, an admin can.
    await service.setVisibility(fixture.mike, { documentId: doc.documentId, threadId: thread.id, visibility: "HIDDEN", reason: "moderated" });
    await expect(service.setResolution(fixture.ann, { documentId: doc.documentId, threadId: thread.id, status: "RESOLVED" }))
      .rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await service.setResolution(adminCaller, { documentId: doc.documentId, threadId: thread.id, status: "RESOLVED" });
  });

  it("serves no team discussion for an archived document or an archived publication source", async () => {
    const doc = await publishedDocument({});
    const thread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "ARCHIVED TEAM SECRET",
      idempotencyKey: randomUUID(),
    });
    await fixture.pool.query(
      "UPDATE knowledge_documents SET status = 'ARCHIVED', archived_by = ?, archived_at = ? WHERE id = ?",
      [fixture.mike.identity.id, new Date(), doc.documentId],
    );

    const attempts = [
      () => service.queryForOwner(fixture.ann, doc.documentId),
      () => service.markThreadRead(fixture.mike, doc.documentId, thread.id),
      () => service.setVisibility(fixture.mike, { documentId: doc.documentId, threadId: thread.id, visibility: "HIDDEN" }),
    ];
    for (const attempt of attempts) {
      const failure = await attempt().catch((error: unknown) => error);
      expect(failure).toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
      expect(JSON.stringify(failure)).not.toContain("ARCHIVED TEAM SECRET");
    }

    // An unpublished (source-archived) publication is gone from review too.
    const unpublished = await publishedDocument({});
    await fixture.pool.query(
      "UPDATE knowledge_sources SET status = 'ARCHIVED', archived_by = ?, archived_at = ? WHERE id = ?",
      [fixture.mike.identity.id, new Date(), unpublished.publication.sourceId],
    );
    await expect(service.queryForOwner(fixture.mike, unpublished.documentId)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
  });

  it("closes team discussion without the team flag while personal review still works", async () => {
    const closed = new DocumentReviewService(fixture.uow, undefined, () => true, () => false);
    const doc = await publishedDocument({});
    await expect(closed.queryForOwner(fixture.ann, doc.documentId)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(closed.createForOwner(fixture.ann, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "A closed team must not take comments",
      idempotencyKey: randomUUID(),
    })).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });

    const personal = await fixture.createHubOriginal(fixture.mike, "Personal review", MARKDOWN);
    const thread = await closed.createForOwner(fixture.mike, {
      documentId: personal.documentId,
      expectedRevisionId: personal.revisionId,
      anchor: anchorOf(),
      body: "Personal still works",
      idempotencyKey: randomUUID(),
    });
    expect((await closed.queryForOwner(fixture.mike, personal.documentId)).threads.map(view => view.id)).toEqual([thread.id]);
  });

  it("rechecks direct membership and validated groups on every read and restores with access", async () => {
    const memberIdentity = identity("MembershipRecheck");
    const member = await addMember(fixture.teamWorkspaceId, memberIdentity, "EDITOR");
    const doc = await publishedDocument({});
    const thread = await service.createForOwner(member, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "MEMBER SECRET",
      idempotencyKey: randomUUID(),
    });
    expect((await service.queryForOwner(member, doc.documentId)).threads.map(view => view.id)).toEqual([thread.id]);

    await fixture.uow.run((repositories) => repositories.workspaceMemberships.remove(fixture.teamWorkspaceId, memberIdentity.id));
    const lost = await service.queryForOwner(member, doc.documentId).catch((error: unknown) => error);
    expect(lost).toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expect(JSON.stringify(lost)).not.toContain("MEMBER SECRET");
    await expect(service.markDocumentRead(member, doc.documentId)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });

    await addMember(fixture.teamWorkspaceId, memberIdentity, "EDITOR");
    const regained = await service.queryForOwner(member, doc.documentId);
    expect(regained.threads.map(view => view.id)).toEqual([thread.id]);

    // A group-only member is judged by the caller's own validated groups on each request.
    const groupDoc = await publishedDocument({ teamId: fixture.groupTeamWorkspaceId });
    const groupThread = await service.createForOwner(fixture.ann, {
      documentId: groupDoc.documentId,
      expectedRevisionId: groupDoc.revisionId,
      anchor: groupDoc.anchor,
      body: "GROUP SECRET",
      idempotencyKey: randomUUID(),
    });
    expect((await service.queryForOwner(fixture.ann, groupDoc.documentId)).threads.map(view => view.id)).toEqual([groupThread.id]);
    const withoutGroups = { ...fixture.ann, validatedExternalGroupIds: [] };
    const revoked = await service.queryForOwner(withoutGroups, groupDoc.documentId).catch((error: unknown) => error);
    expect(revoked).toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    expect(JSON.stringify(revoked)).not.toContain("GROUP SECRET");
    expect(JSON.stringify(revoked)).not.toContain(groupDoc.title);
    expect((await service.queryForOwner(fixture.ann, groupDoc.documentId)).threads.map(view => view.id)).toEqual([groupThread.id]);
  });

  it("returns the member projection without moderation fields and the owner projection with them", async () => {
    const doc = await publishedDocument({});
    const adminCaller = await addMember(fixture.teamWorkspaceId, identity("ShapeAdmin"), "ADMIN");
    const thread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Owner opening",
      idempotencyKey: randomUUID(),
    });
    await service.replyForOwner(fixture.ann, {
      documentId: doc.documentId,
      threadId: thread.id,
      body: "Member answer",
      idempotencyKey: randomUUID(),
    });

    const member = await service.queryForOwner(fixture.ann, doc.documentId);
    if (member.canModerate) throw new Error("expected the member projection");
    expect(member.canModerate).toBe(false);
    expect(Object.keys(member.threads[0]).sort()).toEqual(["comments", "createdAt", "currentAnchor", "id", "status", "updatedAt"]);
    for (const key of ["visibility", "createdBy", "hiddenBy", "hiddenAt", "hiddenReason", "resolvedBy", "resolvedAt", "originalAnchor"]) {
      expect(member.threads[0]).not.toHaveProperty(key);
    }
    for (const key of ["authorUserId", "hiddenBy", "hiddenAt", "hiddenReason"]) {
      expect(member.threads[0].comments[0]).not.toHaveProperty(key);
    }

    for (const [view, expected] of [[await service.queryForOwner(fixture.mike, doc.documentId), true], [await service.queryForOwner(adminCaller, doc.documentId), true]] as const) {
      expect(view.canModerate).toBe(expected);
      if (!view.canModerate) throw new Error("expected the owner projection");
      expect(Object.keys(view.threads[0]).sort()).toEqual([
        "comments", "createdAt", "createdBy", "currentAnchor", "documentId", "hiddenAt", "hiddenBy",
        "hiddenReason", "id", "originalAnchor", "resolvedAt", "resolvedBy", "status", "updatedAt", "visibility",
      ]);
      for (const key of ["authorUserId", "hiddenBy", "hiddenAt", "hiddenReason"]) {
        expect(view.threads[0].comments[0]).toHaveProperty(key);
      }
    }
  });
});

describe("publication review mentions", () => {
  it("offers only direct team members as candidates", async () => {
    const doc = await publishedDocument({});
    const direct = await addMember(fixture.teamWorkspaceId, identity("DirectCand"), "EDITOR");
    const outsider = await addUser(identity("DirectoryCand"));

    const found = await service.searchMentionCandidates(fixture.mike, { query: "Cand", documentId: doc.documentId });
    expect(found.candidates.map(candidate => candidate.id)).toEqual([direct.identity.id]);
    expect(found.candidates.map(candidate => candidate.id)).not.toContain(outsider.identity.id);

    // The writer and the document creator are never offered.
    const annFound = await service.searchMentionCandidates(fixture.ann, { query: "Ann", documentId: doc.documentId });
    expect(annFound.candidates.map(candidate => candidate.id)).not.toContain(fixture.ann.identity.id);

    // Group-only membership is not listed, even for the group's own member.
    const groupDoc = await publishedDocument({ teamId: fixture.groupTeamWorkspaceId });
    const groupFound = await service.searchMentionCandidates(fixture.mike, { query: "Ann", documentId: groupDoc.documentId });
    expect(groupFound.candidates.map(candidate => candidate.id)).not.toContain(fixture.ann.identity.id);
  });

  it("rejects a mention of someone who is not a direct team member", async () => {
    const doc = await publishedDocument({});
    const outsider = await addUser(identity("NotDirect"));

    await expect(service.replyForOwner(fixture.ann, {
      documentId: doc.documentId,
      threadId: (await service.createForOwner(fixture.mike, {
        documentId: doc.documentId, expectedRevisionId: doc.revisionId, anchor: doc.anchor,
        body: "Opener", idempotencyKey: randomUUID(),
      })).id,
      body: "Say hello",
      idempotencyKey: randomUUID(),
      mentions: [outsider.identity.id],
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    // The group team member is not a direct row, so naming her is refused there too.
    const groupDoc = await publishedDocument({ teamId: fixture.groupTeamWorkspaceId });
    await expect(service.createForOwner(fixture.mike, {
      documentId: groupDoc.documentId,
      expectedRevisionId: groupDoc.revisionId,
      anchor: groupDoc.anchor,
      body: "Group mention",
      idempotencyKey: randomUUID(),
      mentions: [fixture.ann.identity.id],
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("stores a team mention with no share link and creates no follow", async () => {
    const doc = await publishedDocument({});

    const thread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Thanks @Ann",
      idempotencyKey: randomUUID(),
      mentions: [fixture.ann.identity.id, fixture.mike.identity.id],
    });

    const mentions = await fixture.pool.query<{ mentioned_user_id: string; share_link_id: string | null }[]>(
      "SELECT mentioned_user_id, share_link_id FROM review_comment_mentions WHERE comment_id = ?",
      [await commentIdOf(thread.id)],
    );
    expect(mentions).toEqual([{ mentioned_user_id: fixture.ann.identity.id, share_link_id: null }]);
    const follows = await fixture.pool.query<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM review_thread_follows WHERE thread_id = ? AND user_id = ?",
      [thread.id, fixture.ann.identity.id],
    );
    expect(Number(follows[0].count)).toBe(0);
    const links = await fixture.pool.query<{ count: number }[]>(
      "SELECT COUNT(*) AS count FROM document_share_links WHERE document_id = ?",
      [doc.documentId],
    );
    expect(Number(links[0].count)).toBe(0);
  });

  it("still requires a live share link for a personal mention and refuses a token on a team document", async () => {
    const personal = await fixture.createHubOriginal(fixture.mike, "Personal", MARKDOWN);
    const personalAnchor = anchorOf();
    await expect(service.createForOwner(fixture.mike, {
      documentId: personal.documentId,
      expectedRevisionId: personal.revisionId,
      anchor: personalAnchor,
      body: "Personal mention without a link",
      idempotencyKey: randomUUID(),
      mentions: [annIdentity.id],
    })).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    const doc = await publishedDocument({});
    const thread = await service.createForOwner(fixture.mike, {
      documentId: doc.documentId,
      expectedRevisionId: doc.revisionId,
      anchor: doc.anchor,
      body: "Team discussion",
      idempotencyKey: randomUUID(),
    });
    const token = randomUUID();
    await fixture.pool.query(
      `INSERT INTO document_share_links (id, document_id, token, label, created_by, created_at, expires_at, revoked_by, revoked_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, NULL, NULL)`,
      [uuidv7(), doc.documentId, token, fixture.mike.identity.id, new Date(), new Date(Date.now() + 86_400_000)],
    );
    await expect(service.queryForLink(null, token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    await expect(service.queryForLink(fixture.mike, token)).rejects.toMatchObject({ code: "SHARE_LINK_NOT_FOUND" });
    // The team discussion itself is still readable by a member, and the token reads nothing.
    expect((await service.queryForOwner(fixture.ann, doc.documentId)).threads.map(view => view.id)).toEqual([thread.id]);
  });
});
