import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { parseShareManagementQuery, SHARE_MANAGEMENT_PAGE_SIZE, type ShareManagementInput } from "../domain/share-management";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";
import {
  assertShareLinkCreation,
  isActiveShareLink,
  isShareToken,
  normalizeRecipients,
  shareLinkExpiry,
  shareLinkPath,
  ShareLinkNotFoundError,
  type DocumentShareLink,
  type ShareAudience,
  type ShareLinkTarget,
} from "../domain/document-share-link";
import { extractDocumentLinks } from "../domain/document-links";
import { DocumentNotFoundError, DomainError, IntegrityViolationError, SourceNotFoundError, ValidationError } from "../domain/errors";
import { linkLookupKey } from "../domain/link-graph";
import { buildLinkResolver } from "../domain/link-resolution";
import { MENTION_LIMIT } from "../domain/review-mention";
import type { ShareProposal } from "../domain/share-proposal";
import type { OpenFolderLink, OpenSourceLink } from "../ports/document-share-link-repository";
import type { ShareTokenIssuer } from "../ports/share-token-issuer";
import { openShareLinkTarget, reachableChain, reachableChainForSource } from "./internal/folder-link-reach";
import { linkOrigin } from "./internal/link-origin";
import { addNamedRecipients, appendRecipientEvent } from "./named-recipients";
import type { TreeViewNode } from "../ports/tree-repository";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

export type ShareLinkView = {
  id: string;
  label: string | null;
  /** `/s/<token>`; the browser composes the absolute URL (spec §9.4). */
  path: string;
  createdAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  active: boolean;
  totalViews: number;
  lastViewedAt: Date | null;
  audience: ShareAudience;
  /** The people a NAMED link names; null for a LINK. */
  recipientCount: number | null;
};

export type ShareRecipientView = { userId: string; name: string; nameEn: string | null; empId: string; addedAt: Date };
/** A PENDING proposal as its link's owner decides it. `proposedByName` is the proposer's current name. */
export type ShareProposalView = { id: string; userId: string; name: string; nameEn: string | null; empId: string; orgCode: string; proposedByName: string | null; createdAt: Date };
export type ShareRecipientCandidate = { id: string; name: string; nameEn: string | null; empId: string; orgCode: string };

type ShareCreateInput = { label?: unknown; expiresInDays?: unknown; recipients?: unknown };

export type SharedDocumentView = {
  revisionId: string;
  title: string;
  markdown: string;
  pageIcon: string | null;
  sharedByName: string;
  updatedAt: Date;
  expiresAt: Date | null;
};

/** One node of a shared folder's or Source's tree: names and icons only, never a body. */
export type SharedTreeNode = {
  id: string;
  /** `null` for a direct child of the shared root (a folder or a Source). */
  parentId: string | null;
  kind: "FOLDER" | "DOCUMENT";
  name: string;
  documentId: string | null;
  pageIcon: string | null;
};

/** A link in the document being read whose target is reachable through the same folder link. */
export type SharedResolvedLink = { lookupKey: string; documentId: string; title: string };

export type SharedFolderDocument = SharedDocumentView & {
  documentId: string;
  /** The folders from the shared folder (exclusive) down to the document's parent. */
  path: { id: string; name: string }[];
  links: SharedResolvedLink[];
};

/** Where `/s/:token/open` sends the caller: the named document when reachable, else the landing one. */
export type SharedTargetView = ({ kind: "DOCUMENT"; documentId: string } | { kind: "FOLDER" | "SOURCE"; documentId: string | null }) & { audience: ShareAudience };

/** One tree view shared by folder and Source links: the shared root's name, its forest, and the document read. */
export type SharedTreeView = {
  kind: "FOLDER" | "SOURCE";
  rootName: string;
  /** Depth-first in the owner's tree order. */
  tree: SharedTreeNode[];
  /** `null` only when the tree holds no document. */
  document: SharedFolderDocument | null;
  sharedByName: string;
  expiresAt: Date | null;
};

/** A folder link's view: the tree view with its root kind fixed. */
export type SharedFolderView = SharedTreeView & { kind: "FOLDER" };
/** A Source link's view: the tree view with its root kind fixed. */
export type SharedSourceView = SharedTreeView & { kind: "SOURCE" };

/**
 * `linkId` is on a NAMED read only, whose reader is a signed-in recipient or the owner: the Hub marks
 * their Inbox entry (`shared:<linkId>`) read with it. A LINK read serves anyone and names no link.
 */
export type SharedView = ({ kind: "DOCUMENT" } & SharedDocumentView | SharedFolderView | SharedSourceView) & { audience: ShareAudience; linkId?: string };

/**
 * The deepest a shared tree lists, counting a top-level node (a folder's direct child, or a Source's
 * root-level node) as depth 0. `listSubtree` stops at this depth because a chain of `MAX_CHAIN_LENGTH`
 * (1000) nodes reaches a shared folder at most `MAX_CHAIN_LENGTH - 1` hops up; a Source's forest has no
 * folder anchor, so it applies the same cap rather than listing nodes the reachability check must refuse
 * (source share spec §3).
 */
export const SHARED_TREE_MAX_DEPTH = 998;

export const SHARE_LINK_CREATED_EVENT = "DOCUMENT_SHARE_LINK_CREATED";
export const SHARE_LINK_REVOKED_EVENT = "DOCUMENT_SHARE_LINK_REVOKED";
export const SHARE_RECIPIENT_REMOVED_EVENT = "DOCUMENT_SHARE_RECIPIENT_REMOVED";
export const SHARE_PROPOSAL_DECLINED_EVENT = "DOCUMENT_SHARE_PROPOSAL_DECLINED";

/**
 * Document share links (share-link spec). `create`, `list` and `revoke` are
 * ordinary caller-scoped operations for a My Space owner. `readShared` is the
 * one exception the spec records in CLAUDE.md: it takes no caller and never
 * consults membership, because holding the token is the grant.
 */
export class DocumentShareService {
  constructor(
    private readonly unitOfWork: KnowledgeUnitOfWork,
    private readonly tokens: ShareTokenIssuer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async listManagement(caller: CallerContext, workspaceId: string, input: ShareManagementInput) {
    return this.unitOfWork.run(async r => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const workspace = await r.workspaces.findById(workspaceId);
      if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") throw new DocumentNotFoundError();
      const query = parseShareManagementQuery(input);
      const rows = await r.shareLinks.listForWorkspace(workspaceId, caller.identity.id, query, this.clock(), SHARE_MANAGEMENT_PAGE_SIZE + 1, (query.page - 1) * SHARE_MANAGEMENT_PAGE_SIZE);
      return { query, items: rows.slice(0, SHARE_MANAGEMENT_PAGE_SIZE), hasNext: rows.length > SHARE_MANAGEMENT_PAGE_SIZE };
    });
  }

  /** The owner's folders with a link open now, for the tree's marker (folder share spec §8). Owner of that My Space only. */
  async listOpenFolderLinks(caller: CallerContext, workspaceId: string): Promise<OpenFolderLink[]> {
    return (await this.listOpenShareTargets(caller, workspaceId)).folders;
  }

  async listOpenShareTargets(caller: CallerContext, workspaceId: string): Promise<{ folders: OpenFolderLink[]; sources: OpenSourceLink[] }> {
    return this.unitOfWork.run(async r => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const workspace = await r.workspaces.findById(workspaceId);
      if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") throw new DocumentNotFoundError();
      const now = this.clock();
      const folders = await r.shareLinks.listOpenFolderLinks(workspaceId, caller.identity.id, now);
      const sources = await r.shareLinks.listOpenSourceLinks(workspaceId, caller.identity.id, now);
      return { folders, sources };
    });
  }

  /**
   * The shared folders a document is visible through: its ancestors, nearest first, that have a link open
   * now, reached through ACTIVE nodes only (folder share spec §8). Owner of the document's My Space only.
   */
  async foldersSharingDocument(caller: CallerContext, documentId: string): Promise<OpenFolderLink[]> {
    return (await this.containersSharingDocument(caller, documentId)).folders;
  }

  async containersSharingDocument(caller: CallerContext, documentId: string): Promise<{ folders: OpenFolderLink[]; sources: OpenSourceLink[] }> {
    return this.unitOfWork.run(async r => {
      const { document, workspace } = await requireOwnedDocument(r, caller, documentId);
      if (document.status !== "ACTIVE") return { folders: [], sources: [] };
      const node = await r.tree.findByDocumentId(document.id);
      if (!node) return { folders: [], sources: [] };
      const open = new Map((await r.shareLinks.listOpenFolderLinks(workspace.id, caller.identity.id, this.clock())).map(folder => [folder.folderNodeId, folder]));
      const sourceLinks = await r.shareLinks.listOpenSourceLinks(workspace.id, caller.identity.id, this.clock());
      const chain = await r.tree.listChain(node.id);
      const shared: OpenFolderLink[] = [];
      const seen = new Set<string>();
      for (const [index, ancestor] of chain.entries()) {
        if (ancestor.status !== "ACTIVE" || seen.has(ancestor.id)) break;
        seen.add(ancestor.id);
        const folder = index > 0 ? open.get(ancestor.id) : undefined;
        if (folder) shared.push(folder);
      }
      const source = sourceLinks.find(item => item.sourceId === document.sourceId);
      const reachable = source ? await reachableChainForSource(r, { id: source.sourceId, status: "ACTIVE" }, document) : null;
      return { folders: shared, sources: source && reachable ? [source] : [] };
    });
  }

  async create(caller: CallerContext, input: { documentId: string } & ShareCreateInput): Promise<ShareLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { document, source, workspace } = await lockOwnedScope(repositories, caller, input.documentId);
      const target: ShareLinkTarget = { kind: "DOCUMENT", documentId: document.id };
      const activeLinkCount = await repositories.shareLinks.countActiveByDocument(document.id, this.clock());
      return this.issueLink(repositories, caller, { target, targetStatus: document.status, source, workspace, activeLinkCount, input });
    });
  }

  async createForFolder(caller: CallerContext, input: { folderNodeId: string } & ShareCreateInput): Promise<ShareLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { node, source, workspace } = await lockOwnedFolderScope(repositories, caller, input.folderNodeId);
      const target: ShareLinkTarget = { kind: "FOLDER", folderNodeId: node.id };
      const activeLinkCount = await repositories.shareLinks.countActiveByFolder(node.id, this.clock());
      return this.issueLink(repositories, caller, { target, targetStatus: node.status, source, workspace, activeLinkCount, input });
    });
  }

  async createForSource(caller: CallerContext, input: { sourceId: string } & ShareCreateInput): Promise<ShareLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { source, workspace } = await lockOwnedSourceScope(repositories, caller, input.sourceId);
      const target: ShareLinkTarget = { kind: "SOURCE", sourceId: source.id };
      const activeLinkCount = await repositories.shareLinks.countActiveBySource(source.id, this.clock());
      return this.issueLink(repositories, caller, { target, targetStatus: source.status, source, workspace, activeLinkCount, input });
    });
  }

  /** The part of creation that does not depend on what the link opens. */
  private async issueLink(
    repositories: KnowledgeRepositories,
    caller: CallerContext,
    scope: {
      target: ShareLinkTarget;
      targetStatus: "ACTIVE" | "ARCHIVED";
      source: { status: "ACTIVE" | "ARCHIVED" };
      workspace: Parameters<typeof assertShareLinkCreation>[0]["workspace"] & { id: string };
      activeLinkCount: number;
      input: ShareCreateInput;
    },
  ): Promise<ShareLinkView> {
    const now = this.clock();
    // `recipients` present makes the link NAMED, which stands until revoked and so has no expiry to choose.
    const named = scope.input.recipients !== undefined;
    if (named && scope.input.expiresInDays !== undefined) throw new DomainError("INVALID_REQUEST", "A named share has no expiry.");
    const normalized = assertShareLinkCreation({
      callerId: caller.identity.id,
      targetKind: scope.target.kind,
      documentStatus: scope.targetStatus,
      sourceStatus: scope.source.status,
      workspace: scope.workspace,
      activeLinkCount: scope.activeLinkCount,
      expiresInDays: scope.input.expiresInDays,
      label: scope.input.label,
    });
    const recipientIds = named ? normalizeRecipients(scope.input.recipients, { ownerId: caller.identity.id }) : [];
    await requireExistingUsers(repositories, recipientIds);
    const link: DocumentShareLink = {
      id: uuidv7(),
      target: scope.target,
      token: this.tokens.issue(),
      label: normalized.label,
      audience: named ? "NAMED" : "LINK",
      createdBy: caller.identity.id,
      createdAt: now,
      expiresAt: named ? null : shareLinkExpiry(now, normalized.expiresInDays),
      revokedBy: null,
      revokedAt: null,
    };
    // Guard the issuer: a sequential or derived token would be computable.
    if (!isShareToken(link.token)) throw new IntegrityViolationError("Share token issuer must return a random UUIDv4.");
    await repositories.shareLinks.insert(link);
    if (named) await repositories.shareLinks.insertRecipients(link.id, recipientIds, caller.identity.id, now);
    await repositories.auditEvents.append({
      id: uuidv7(),
      workspaceId: scope.workspace.id,
      actorUserId: caller.identity.id,
      actorKind: "USER",
      eventType: SHARE_LINK_CREATED_EVENT,
      targetType: "DOCUMENT_SHARE_LINK",
      targetId: link.id,
      payload: { ...targetPayload(link.target), expiresAt: link.expiresAt?.toISOString() ?? null, label: link.label, audience: link.audience, recipientIds },
      correlationId: null,
      createdAt: now,
    });
    return toView(link, now, undefined, named ? recipientIds.length : null);
  }

  async list(caller: CallerContext, documentId: string): Promise<ShareLinkView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { document } = await requireOwnedDocument(repositories, caller, documentId);
      return this.toViews(repositories, await repositories.shareLinks.listByDocument(document.id));
    });
  }

  async listForFolder(caller: CallerContext, folderNodeId: string): Promise<ShareLinkView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const node = await repositories.tree.findById(folderNodeId);
      if (!node) throw new DocumentNotFoundError();
      const source = await repositories.sourcePolicy.findById(node.sourceId);
      if (!source) throw new DocumentNotFoundError();
      await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
      const workspace = await repositories.workspaces.findById(source.workspaceId);
      if (!workspace || workspace.personalOwnerUserId !== caller.identity.id) throw new DocumentNotFoundError();
      requireFolder(node);
      return this.toViews(repositories, await repositories.shareLinks.listByFolder(node.id));
    });
  }

  /** Mirrors `listForFolder` without a node-type check: a Source has no tree node. */
  async listForSource(caller: CallerContext, sourceId: string): Promise<ShareLinkView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const source = await repositories.sourcePolicy.findById(sourceId);
      if (!source) throw new DocumentNotFoundError();
      await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
      const workspace = await repositories.workspaces.findById(source.workspaceId);
      if (!workspace || workspace.personalOwnerUserId !== caller.identity.id) throw new DocumentNotFoundError();
      return this.toViews(repositories, await repositories.shareLinks.listBySource(source.id));
    });
  }

  private async toViews(repositories: KnowledgeRepositories, links: DocumentShareLink[]): Promise<ShareLinkView[]> {
    const totals = await repositories.shareLinks.viewTotals(links.map((link) => link.id));
    const now = this.clock();
    return Promise.all(links.map(async (link) => toView(link, now, totals.get(link.id), link.audience === "NAMED" ? await repositories.shareLinks.countRecipients(link.id) : null)));
  }

  /** The people a NAMED link names, newest first. Owner of the link only; a LINK or a revoked link is refused. */
  async listRecipients(caller: CallerContext, linkId: string): Promise<ShareRecipientView[]> {
    if (!isUuid(linkId)) throw new ShareLinkNotFoundError();
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const link = await repositories.shareLinks.findById(linkId);
      if (!link || link.createdBy !== caller.identity.id || link.revokedAt !== null) throw new ShareLinkNotFoundError();
      requireNamed(link);
      const recipients = await repositories.shareLinks.listRecipients(link.id);
      const users = new Map((await repositories.users.findByIds(recipients.map((recipient) => recipient.userId))).map((user) => [user.id, user]));
      return recipients.flatMap((recipient) => {
        const user = users.get(recipient.userId);
        return user ? [{ userId: user.id, name: user.name, nameEn: user.nameEn, empId: user.emp_id, addedAt: recipient.addedAt }] : [];
      });
    });
  }

  /** Names more people on a NAMED link. Someone already named is ignored; the total stays within the cap. */
  async addRecipients(caller: CallerContext, linkId: string, userIds: unknown): Promise<void> {
    if (!isUuid(linkId)) throw new ShareLinkNotFoundError();
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { link, workspace } = await lockOwnedLink(repositories, caller, linkId);
      if (link.revokedAt !== null) throw new ShareLinkNotFoundError();
      requireNamed(link);
      const ids = normalizeRecipients(userIds, { ownerId: caller.identity.id });
      // INSERT IGNORE would swallow a missing user as it swallows a duplicate.
      await requireExistingUsers(repositories, ids);
      await addNamedRecipients(repositories, caller, link, workspace.id, ids, this.clock());
    });
  }

  /**
   * The people proposed for a NAMED link and still PENDING, oldest first. Owner of the link only; a revoked link is
   * refused. A link that no longer opens (archived target) lists nobody, since none of them could be decided.
   */
  async listProposals(caller: CallerContext, linkId: string): Promise<ShareProposalView[]> {
    if (!isUuid(linkId)) throw new ShareLinkNotFoundError();
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const link = await repositories.shareLinks.findById(linkId);
      if (!link || link.createdBy !== caller.identity.id || link.revokedAt !== null) throw new ShareLinkNotFoundError();
      if (!await linkOpensForOwner(repositories, link, this.clock(), caller.identity.id)) return [];
      const proposals = await repositories.shareProposals.listByLink(link.id, "PENDING");
      const users = new Map((await repositories.users.findByIds([...new Set(proposals.flatMap((p) => [p.userId, p.proposedBy]))])).map((user) => [user.id, user]));
      return proposals.flatMap((proposal) => {
        const user = users.get(proposal.userId);
        if (!user) return [];
        return [{ id: proposal.id, userId: user.id, name: user.name, nameEn: user.nameEn, empId: user.emp_id, orgCode: user.org_code, proposedByName: users.get(proposal.proposedBy)?.name ?? null, createdAt: proposal.createdAt }];
      });
    });
  }

  /**
   * Adds the proposed person through the one add path, then marks the proposal APPROVED (mention proposals
   * spec, "Owner decision API"). At the recipient limit it fails and the proposal stays PENDING.
   */
  async approveProposal(caller: CallerContext, linkId: string, proposalId: string): Promise<void> {
    await this.decideProposal(caller, linkId, proposalId, "APPROVED", async (repositories, link, workspaceId, proposal, now) => {
      await addNamedRecipients(repositories, caller, link, workspaceId, [proposal.userId], now);
      await repositories.shareProposals.decide(proposal.id, "APPROVED", caller.identity.id, now);
    });
  }

  /** Declines a proposal; final for proposals of that person on this link. Names nobody. */
  async declineProposal(caller: CallerContext, linkId: string, proposalId: string): Promise<void> {
    await this.decideProposal(caller, linkId, proposalId, "DECLINED", async (repositories, link, workspaceId, proposal, now) => {
      await repositories.shareProposals.decide(proposal.id, "DECLINED", caller.identity.id, now);
      await appendRecipientEvent(repositories, caller, workspaceId, link.id, SHARE_PROPOSAL_DECLINED_EVENT, proposal.userId, now, { proposalId: proposal.id });
    });
  }

  /**
   * The owner's decision on a PENDING proposal of a link that opens now. Every refusal is the same not-found;
   * repeating the decision already made is a no-op.
   */
  private async decideProposal(
    caller: CallerContext,
    linkId: string,
    proposalId: string,
    decision: "APPROVED" | "DECLINED",
    apply: (repositories: KnowledgeRepositories, link: DocumentShareLink, workspaceId: string, proposal: ShareProposal, now: Date) => Promise<void>,
  ): Promise<void> {
    if (!isUuid(linkId) || !isUuid(proposalId)) throw new ShareLinkNotFoundError();
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const now = this.clock();
      const { link, workspace } = await lockOwnedLink(repositories, caller, linkId);
      await requireLiveLink(repositories, link, now, caller.identity.id);
      const proposal = await repositories.shareProposals.lockById(proposalId);
      if (!proposal || proposal.shareLinkId !== link.id) throw new ShareLinkNotFoundError();
      if (proposal.status === decision) return;
      if (proposal.status !== "PENDING") throw new ShareLinkNotFoundError();
      await apply(repositories, link, workspace.id, proposal, now);
    });
  }

  /** Stops naming one person. Someone who is not named is a no-op; their read closes at once. */
  async removeRecipient(caller: CallerContext, linkId: string, userId: string): Promise<void> {
    if (!isUuid(linkId)) throw new ShareLinkNotFoundError();
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { link, workspace } = await lockOwnedLink(repositories, caller, linkId);
      if (link.revokedAt !== null) throw new ShareLinkNotFoundError();
      requireNamed(link);
      if (typeof userId !== "string" || !isUuid(userId)) throw new DomainError("INVALID_REQUEST", "Provide a user id.");
      const id = userId.toLowerCase();
      if (!(await repositories.shareLinks.removeRecipient(link.id, id))) return;
      await appendRecipientEvent(repositories, caller, workspace.id, link.id, SHARE_RECIPIENT_REMOVED_EVENT, id, this.clock());
    });
  }

  /** Existing users matching the query, for the owner choosing who to name. Never the caller; reads only. */
  async searchRecipientCandidates(caller: CallerContext, query: string): Promise<{ candidates: ShareRecipientCandidate[] }> {
    const needle = query.trim().slice(0, 200);
    if (!needle) return { candidates: [] };
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const found = await repositories.users.searchExisting(needle, MENTION_LIMIT + 1);
      const candidates = found.filter((user) => user.id !== caller.identity.id).slice(0, MENTION_LIMIT);
      return { candidates: candidates.map((user) => ({ id: user.id, name: user.name, nameEn: user.nameEn, empId: user.emp_id, orgCode: user.org_code })) };
    });
  }

  async revoke(caller: CallerContext, linkId: string): Promise<void> {
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { link, workspace } = await lockOwnedLink(repositories, caller, linkId);
      if (link.revokedAt !== null) return;
      const now = this.clock();
      await repositories.shareLinks.revoke(link.id, caller.identity.id, now);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId: workspace.id,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: SHARE_LINK_REVOKED_EVENT,
        targetType: "DOCUMENT_SHARE_LINK",
        targetId: link.id,
        payload: targetPayload(link.target),
        correlationId: null,
        createdAt: now,
      });
    });
  }

  /**
   * The single caller-less content read (spec §6.1). Every failure is the
   * same ShareLinkNotFoundError so no response distinguishes a link that
   * once worked from one that never existed. `recordView: false` judges the
   * link without counting a read, for a page that only passes through it.
   *
   * `documentId` is navigation inside a folder link (folder share spec §3):
   * it is re-judged against the folder on every call, and a document link
   * refuses any.
   *
   * `viewerId` is the signed-in reader, or null. It is not a caller and grants
   * nothing: a LINK ignores it, and a NAMED link opens only when it names a
   * recipient or the owner (named-recipient share spec).
   */
  async readShared(token: string, { documentId, recordView = true, viewerId = null }: { documentId?: string; recordView?: boolean; viewerId?: string | null } = {}): Promise<SharedView> {
    if (!isShareToken(token)) throw new ShareLinkNotFoundError();
    // A malformed id would make MariaDB's UUID column raise rather than match nothing.
    if (documentId !== undefined && !isUuid(documentId)) throw new ShareLinkNotFoundError();
    const now = this.clock();
    const { linkId, view } = await this.unitOfWork.run(async (repositories): Promise<{ linkId: string; view: SharedView }> => {
      const link = await repositories.shareLinks.findByToken(token);
      if (!link) throw new ShareLinkNotFoundError();
      if (link.target.kind === "SOURCE") return { linkId: link.id, view: await readSharedSource(repositories, link, link.target.sourceId, documentId, now, viewerId) };
      if (link.target.kind === "FOLDER") return { linkId: link.id, view: await readSharedFolder(repositories, link, link.target.folderNodeId, documentId, now, viewerId) };
      if (documentId !== undefined) throw new ShareLinkNotFoundError();
      const document = await repositories.documents.findById(link.target.documentId);
      if (!document) throw new ShareLinkNotFoundError();
      await requireOpenLink(repositories, link, document, now, viewerId);
      const revision = await repositories.revisions.findCurrent(document.id);
      if (!revision) throw new IntegrityViolationError("Document current revision is missing.");
      const creator = await requireCreator(repositories, link);
      return {
        linkId: link.id,
        view: { kind: "DOCUMENT", revisionId: revision.id, title: revision.title, markdown: revision.markdown, pageIcon: document.pageIcon ?? null, sharedByName: creator.name, updatedAt: revision.createdAt, expiresAt: link.expiresAt, audience: link.audience },
      };
    });
    if (view.audience === "NAMED") view.linkId = linkId;
    if (!recordView) return view;
    try {
      // Separate transaction: the count is a statistic, not an audit record,
      // so failing to write it must not stop the reader (spec A5).
      await this.unitOfWork.run((repositories) => repositories.shareLinks.recordView(linkId, now));
    } catch {
      console.warn("Share link view count was not recorded.");
    }
    return view;
  }

  /**
   * The narrow judgement `/s/:token/open` needs: the link opens, and which document the Hub should
   * show. A document link opens its own document and refuses `?d=`; a folder link opens the named
   * document when it is still reachable, else the landing document (folder share spec §4). It reads
   * no Markdown, creator or link catalog, and counts no view. `viewerId` is judged as readShared judges it.
   */
  async readSharedTarget(token: string, { documentId, viewerId = null }: { documentId?: string; viewerId?: string | null } = {}): Promise<SharedTargetView> {
    if (!isShareToken(token)) throw new ShareLinkNotFoundError();
    if (documentId !== undefined && !isUuid(documentId)) throw new ShareLinkNotFoundError();
    const now = this.clock();
    return this.unitOfWork.run(async (repositories): Promise<SharedTargetView> => {
      const link = await repositories.shareLinks.findByToken(token);
      if (!link) throw new ShareLinkNotFoundError();
      if (link.target.kind === "DOCUMENT") {
        if (documentId !== undefined) throw new ShareLinkNotFoundError();
        const document = await repositories.documents.findById(link.target.documentId);
        if (!document) throw new ShareLinkNotFoundError();
        await requireOpenLink(repositories, link, document, now, viewerId);
        return { kind: "DOCUMENT", documentId: document.id, audience: link.audience };
      }
      if (link.target.kind === "SOURCE") {
        const source = await repositories.sourcePolicy.findById(link.target.sourceId);
        if (!source) throw new ShareLinkNotFoundError();
        await requireOpenLink(repositories, link, { sourceId: source.id, status: source.status }, now, viewerId);
        if (documentId !== undefined) {
          const document = await repositories.documents.findById(documentId);
          if (document && document.currentRevisionId !== null && await reachableChainForSource(repositories, source, document)) {
            return { kind: "SOURCE", documentId: document.id, audience: link.audience };
          }
        }
        const tree = sharedForest(await repositories.tree.listBySource(source.id), SHARED_TREE_MAX_DEPTH);
        return { kind: "SOURCE", documentId: tree.find((node) => node.documentId !== null)?.documentId ?? null, audience: link.audience };
      }
      const folder = await repositories.tree.findById(link.target.folderNodeId);
      if (!folder || folder.nodeType !== "FOLDER") throw new ShareLinkNotFoundError();
      await requireOpenLink(repositories, link, folder, now, viewerId);
      if (documentId !== undefined) {
        const document = await repositories.documents.findById(documentId);
        if (document && document.currentRevisionId !== null && await reachableChain(repositories, folder, document)) {
          return { kind: "FOLDER", documentId: document.id, audience: link.audience };
        }
      }
      const tree = sharedSubtree(await repositories.tree.listSubtree(folder.sourceId, folder.id), folder.id);
      return { kind: "FOLDER", documentId: tree.find((node) => node.documentId !== null)?.documentId ?? null, audience: link.audience };
    });
  }
}

/**
 * Locks the link, then its target's scope — the order `revoke` has always taken, so a change to a link's
 * audience serialises with anything else that locks the link row. Owner of the link only.
 * No path locks a share link after Source/Workspace, so taking the link first cannot invert Phase 3 §14.2.
 */
async function lockOwnedLink(repositories: KnowledgeRepositories, caller: CallerContext, linkId: string) {
  const link = await repositories.shareLinks.lockById(linkId);
  if (!link || link.createdBy !== caller.identity.id) throw new ShareLinkNotFoundError();
  const { workspace } = await lockLinkTargetScope(repositories, caller, link.target).catch((error: unknown) => {
    if (error instanceof DocumentNotFoundError || error instanceof SourceNotFoundError) throw new ShareLinkNotFoundError();
    throw error;
  });
  return { link, workspace };
}

function requireNamed(link: Pick<DocumentShareLink, "audience">): void {
  if (link.audience !== "NAMED") throw new DomainError("INVALID_REQUEST", "Only a named share has recipients.");
}

/** The repository's insert ignores a missing user as it ignores a duplicate, so existence is proven here. */
async function requireExistingUsers(repositories: KnowledgeRepositories, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = new Set((await repositories.users.findByIds(ids)).map((user) => user.id));
  if (ids.some((id) => !found.has(id))) throw new DomainError("INVALID_REQUEST", "Every recipient must be an existing user.");
}

/** Whether the link opens now for its owner, judged as a reader's link is: revoked, archived or out of reach does not. */
async function linkOpensForOwner(repositories: KnowledgeRepositories, link: DocumentShareLink, now: Date, ownerId: string): Promise<boolean> {
  if (link.target.kind === "SOURCE") {
    const source = await repositories.sourcePolicy.findById(link.target.sourceId);
    return !!source && !!await openShareLinkTarget(repositories, link, { sourceId: source.id, status: source.status }, now, ownerId);
  }
  const target = link.target.kind === "DOCUMENT"
    ? await repositories.documents.findById(link.target.documentId)
    : await repositories.tree.findById(link.target.folderNodeId);
  return !!target && !!await openShareLinkTarget(repositories, link, target, now, ownerId);
}

/** `linkOpensForOwner`, answering a link that does not open as not-found. */
async function requireLiveLink(repositories: KnowledgeRepositories, link: DocumentShareLink, now: Date, ownerId: string): Promise<void> {
  if (!await linkOpensForOwner(repositories, link, now, ownerId)) throw new ShareLinkNotFoundError();
}

/**
 * Whether the link opens now (spec §5.2) for this viewer, with its target — a
 * document or a folder node — in the document's place. Returns the target's Workspace.
 */
async function requireOpenLink(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  target: { sourceId: string; status: "ACTIVE" | "ARCHIVED" },
  now: Date,
  viewerId: string | null,
): Promise<{ workspaceId: string }> {
  const open = await openShareLinkTarget(repositories, link, target, now, viewerId);
  if (!open) throw new ShareLinkNotFoundError();
  return open;
}

async function requireCreator(repositories: KnowledgeRepositories, link: DocumentShareLink) {
  const creator = await repositories.users.findById(link.createdBy);
  if (!creator) throw new IntegrityViolationError("Share link creator is missing.");
  return creator;
}

/**
 * A folder link's view (folder share spec §2, §3, §5), called only from
 * readShared. The tree is the folder's ACTIVE subtree as it is now; the
 * document shown is re-proven reachable through the stored chain, not
 * through the tree built here.
 */
async function readSharedFolder(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  folderNodeId: string,
  documentId: string | undefined,
  now: Date,
  viewerId: string | null,
): Promise<SharedFolderView & { audience: ShareAudience }> {
  const folder = await repositories.tree.findById(folderNodeId);
  if (!folder || folder.nodeType !== "FOLDER") throw new ShareLinkNotFoundError();
  const { workspaceId } = await requireOpenLink(repositories, link, folder, now, viewerId);
  const sourceNodes = await repositories.tree.listSubtree(folder.sourceId, folder.id);
  const tree = sharedSubtree(sourceNodes, folder.id);
  const creator = await requireCreator(repositories, link);
  const view = { kind: "FOLDER" as const, rootName: folder.name ?? "", tree, sharedByName: creator.name, expiresAt: link.expiresAt, audience: link.audience };
  // An unreachable requested id is refused, never replaced by the landing document.
  const targetId = documentId ?? tree.find((node) => node.documentId !== null)?.documentId ?? null;
  if (targetId === null) return { ...view, document: null };

  const document = await repositories.documents.findById(targetId);
  const chain = document && await reachableChain(repositories, folder, document);
  if (!document || !chain) throw new ShareLinkNotFoundError();
  const revision = await repositories.revisions.findCurrent(document.id);
  if (!revision) throw new IntegrityViolationError("Document current revision is missing.");

  const names = new Map(sourceNodes.map((candidate) => [candidate.id, candidate.name ?? ""]));
  const between = chain.slice(1, chain.findIndex((candidate) => candidate.id === folder.id));
  const reachable = new Set(tree.flatMap((candidate) => (candidate.documentId === null ? [] : [candidate.documentId])));
  return {
    ...view,
    document: {
      documentId: document.id,
      revisionId: revision.id,
      title: revision.title,
      markdown: revision.markdown,
      pageIcon: document.pageIcon ?? null,
      sharedByName: creator.name,
      updatedAt: revision.createdAt,
      expiresAt: link.expiresAt,
      path: between.reverse().map((ancestor) => ({ id: ancestor.id, name: names.get(ancestor.id) ?? "" })),
      links: await reachableLinks(repositories, workspaceId, document, revision.markdown, reachable),
    },
  };
}

/**
 * A Source link's view (source share spec §3), called only from readShared. The tree is the Source's
 * ACTIVE forest as it is now, capped at the depth the chain check can prove; the document shown is
 * re-proven reachable through the stored chain (`reachableChainForSource`), never through the tree
 * built here. Wikilinks resolve exactly as the owner's reader resolves them, then keep only targets
 * whose document is in the forest's document set.
 */
async function readSharedSource(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  sourceId: string,
  documentId: string | undefined,
  now: Date,
  viewerId: string | null,
): Promise<SharedSourceView & { audience: ShareAudience }> {
  const source = await repositories.sourcePolicy.findById(sourceId);
  if (!source) throw new ShareLinkNotFoundError();
  const { workspaceId } = await requireOpenLink(repositories, link, { sourceId: source.id, status: source.status }, now, viewerId);
  const sourceNodes = await repositories.tree.listBySource(source.id);
  const tree = sharedForest(sourceNodes, SHARED_TREE_MAX_DEPTH);
  const creator = await requireCreator(repositories, link);
  const view = { kind: "SOURCE" as const, rootName: source.name, tree, sharedByName: creator.name, expiresAt: link.expiresAt, audience: link.audience };
  // An unreachable requested id is refused, never replaced by the landing document.
  const targetId = documentId ?? tree.find((node) => node.documentId !== null)?.documentId ?? null;
  if (targetId === null) return { ...view, document: null };

  const document = await repositories.documents.findById(targetId);
  const chain = document && await reachableChainForSource(repositories, source, document);
  if (!document || !chain) throw new ShareLinkNotFoundError();
  const revision = await repositories.revisions.findCurrent(document.id);
  if (!revision) throw new IntegrityViolationError("Document current revision is missing.");

  const names = new Map(sourceNodes.map((candidate) => [candidate.id, candidate.name ?? ""]));
  const reachable = new Set(tree.flatMap((candidate) => (candidate.documentId === null ? [] : [candidate.documentId])));
  return {
    ...view,
    document: {
      documentId: document.id,
      revisionId: revision.id,
      title: revision.title,
      markdown: revision.markdown,
      pageIcon: document.pageIcon ?? null,
      sharedByName: creator.name,
      updatedAt: revision.createdAt,
      expiresAt: link.expiresAt,
      // The Source itself is not in `path` (the page adds its name); ancestors run from the root down.
      path: chain.slice(1).reverse().map((ancestor) => ({ id: ancestor.id, name: names.get(ancestor.id) ?? "" })),
      links: await reachableLinks(repositories, workspaceId, document, revision.markdown, reachable),
    },
  };
}

/**
 * The folder's ACTIVE nodes, depth-first. Siblings keep `listBySource`'s
 * order (position, then id), which is the owner's tree order; a node under
 * an inactive folder is not reached.
 */
function sharedSubtree(nodes: readonly TreeViewNode[], folderId: string): SharedTreeNode[] {
  const children = new Map<string, TreeViewNode[]>();
  for (const node of nodes) {
    if (node.parentId === null || !isShownInSharedTree(node)) continue;
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node);
    else children.set(node.parentId, [node]);
  }
  const ordered: SharedTreeNode[] = [];
  const pending = [...(children.get(folderId) ?? [])].reverse();
  const seen = new Set<string>([folderId]);
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push({
      id: node.id,
      parentId: node.parentId === folderId ? null : node.parentId,
      kind: node.nodeType,
      name: (node.nodeType === "FOLDER" ? node.name : node.title) ?? "",
      documentId: node.nodeType === "DOCUMENT" ? node.documentId : null,
      pageIcon: node.nodeType === "DOCUMENT" ? node.pageIcon ?? null : null,
    });
    pending.push(...[...(children.get(node.id) ?? [])].reverse());
  }
  return ordered;
}

/**
 * A Source's ACTIVE nodes, depth-first, re-rooted at `parentId === null` (a Source has no root node).
 * Siblings keep `listBySource`'s order (position, then id); an archived node and everything under it
 * are absent, and nothing deeper than `maxDepth` (a top-level node is depth 0) is listed — the cap
 * `listSubtree` uses, so every shown document is one the reachability check can still prove.
 */
export function sharedForest(nodes: readonly TreeViewNode[], maxDepth: number): SharedTreeNode[] {
  const children = new Map<string | null, TreeViewNode[]>();
  for (const node of nodes) {
    if (!isShownInSharedTree(node)) continue;
    const siblings = children.get(node.parentId);
    if (siblings) siblings.push(node);
    else children.set(node.parentId, [node]);
  }
  // Siblings come out in the owner's tree order (position, then id), whatever order the rows arrived in.
  const bySiblingOrder = (a: TreeViewNode, b: TreeViewNode) => a.position - b.position || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const siblings of children.values()) siblings.sort(bySiblingOrder);

  const ordered: SharedTreeNode[] = [];
  const pending: { node: TreeViewNode; depth: number }[] = [];
  const seen = new Set<string>();
  const roots = children.get(null) ?? [];
  for (let index = roots.length - 1; index >= 0; index -= 1) pending.push({ node: roots[index], depth: 0 });
  while (pending.length > 0) {
    const { node, depth } = pending.pop()!;
    if (seen.has(node.id)) continue;
    seen.add(node.id);
    ordered.push({
      id: node.id,
      parentId: node.parentId,
      kind: node.nodeType,
      name: (node.nodeType === "FOLDER" ? node.name : node.title) ?? "",
      documentId: node.nodeType === "DOCUMENT" ? node.documentId : null,
      pageIcon: node.nodeType === "DOCUMENT" ? node.pageIcon ?? null : null,
    });
    if (depth >= maxDepth) continue;
    const kids = children.get(node.id) ?? [];
    for (let index = kids.length - 1; index >= 0; index -= 1) pending.push({ node: kids[index], depth: depth + 1 });
  }
  return ordered;
}

function isShownInSharedTree(node: TreeViewNode): boolean {
  if (node.status !== "ACTIVE") return false;
  if (node.nodeType === "FOLDER") return true;
  return node.documentId !== null && node.documentStatus === "ACTIVE" && node.currentRevisionId !== null;
}

/**
 * The document's links resolved as the owner's reader resolves them
 * (`KnowledgeLinkServiceImpl.getDocumentLinks`), then kept only when the
 * target is reachable through this link. Resolving against the subtree alone
 * would point a link somewhere it does not point for the owner.
 */
async function reachableLinks(
  repositories: KnowledgeRepositories,
  workspaceId: string,
  document: { id: string; sourceId: string },
  markdown: string,
  reachable: ReadonlySet<string>,
): Promise<SharedResolvedLink[]> {
  const extracted = extractDocumentLinks(markdown);
  if (extracted.length === 0) return [];
  const catalog = await repositories.links.loadCatalog(workspaceId);
  const resolver = buildLinkResolver(catalog);
  const byId = new Map(catalog.map((entry) => [entry.documentId, entry]));
  const origin = linkOrigin(document, byId.get(document.id));
  const seen = new Set<string>();
  const links: SharedResolvedLink[] = [];
  for (const link of extracted) {
    const lookupKey = linkLookupKey(link.kind, link.target);
    if (seen.has(lookupKey)) continue;
    seen.add(lookupKey);
    const resolution = resolver.resolve(link, origin);
    const target = resolution.status === "RESOLVED" ? byId.get(resolution.documentId) : undefined;
    if (target && reachable.has(target.documentId)) links.push({ lookupKey, documentId: target.documentId, title: target.title });
  }
  return links;
}

/**
 * Locks Source then Workspace (Phase 3 §14.2 "non-import existing Source")
 * and proves the caller is a member. Whether the workspace is the caller's
 * own My Space is a creation rule, decided by assertShareLinkCreation.
 */
async function lockOwnedSourceScope(repositories: KnowledgeRepositories, caller: CallerContext, sourceId: string) {
  const source = await repositories.sourcePolicy.lockById(sourceId);
  if (!source) throw new DocumentNotFoundError();
  // Shared, like every writer: the Source lock above already orders writes to its documents.
  const workspace = await repositories.workspaces.lockSharedById(source.workspaceId);
  if (!workspace) throw new DocumentNotFoundError();
  await repositories.workspaceAccess.requireMembership(caller, workspace.id);
  return { source, workspace };
}

async function lockOwnedScope(repositories: KnowledgeRepositories, caller: CallerContext, documentId: string) {
  const document = await repositories.documents.findById(documentId);
  if (!document) throw new DocumentNotFoundError();
  return { document, ...(await lockOwnedSourceScope(repositories, caller, document.sourceId)) };
}

/** Unlocked reads: the document, once the caller is a member of its Workspace and that is their own My Space. */
async function requireOwnedDocument(repositories: KnowledgeRepositories, caller: CallerContext, documentId: string) {
  const document = await repositories.documents.findById(documentId);
  if (!document) throw new DocumentNotFoundError();
  const source = await repositories.sourcePolicy.findById(document.sourceId);
  if (!source) throw new DocumentNotFoundError();
  await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
  const workspace = await repositories.workspaces.findById(source.workspaceId);
  if (!workspace || workspace.personalOwnerUserId !== caller.identity.id) throw new DocumentNotFoundError();
  return { document, workspace };
}

/** The node is routed unlocked to find its Source, then locked last, after Source and Workspace. */
async function lockOwnedFolderScope(repositories: KnowledgeRepositories, caller: CallerContext, nodeId: string) {
  const routed = await repositories.tree.findById(nodeId);
  if (!routed) throw new DocumentNotFoundError();
  const scope = await lockOwnedSourceScope(repositories, caller, routed.sourceId);
  const node = await repositories.tree.lockById(nodeId);
  if (!node) throw new DocumentNotFoundError();
  requireFolder(node);
  return { node, ...scope };
}

function lockLinkTargetScope(repositories: KnowledgeRepositories, caller: CallerContext, target: ShareLinkTarget) {
  return target.kind === "DOCUMENT"
    ? lockOwnedScope(repositories, caller, target.documentId)
    : target.kind === "FOLDER"
      ? lockOwnedFolderScope(repositories, caller, target.folderNodeId)
      : lockOwnedSourceScope(repositories, caller, target.sourceId);
}

function requireFolder(node: { nodeType: "FOLDER" | "DOCUMENT" }): void {
  if (node.nodeType !== "FOLDER") throw new ValidationError("Only a folder can be shared as a folder link.");
}

function targetPayload(target: ShareLinkTarget) {
  return target.kind === "DOCUMENT" ? { documentId: target.documentId } : target.kind === "FOLDER" ? { folderNodeId: target.folderNodeId } : { sourceId: target.sourceId };
}

function toView(link: DocumentShareLink, now: Date, totals: { totalViews: number; lastViewedAt: Date | null } | undefined, recipientCount: number | null): ShareLinkView {
  return {
    id: link.id,
    label: link.label,
    path: shareLinkPath(link.token),
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    active: isActiveShareLink(link, now),
    totalViews: totals?.totalViews ?? 0,
    lastViewedAt: totals?.lastViewedAt ?? null,
    audience: link.audience,
    recipientCount,
  };
}
