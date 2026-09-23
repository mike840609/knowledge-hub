import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { uuidv7 } from "@/shared/ids/uuidv7";
import {
  assertShareLinkCreation,
  evaluateShareLinkValidity,
  isActiveShareLink,
  isShareToken,
  shareLinkExpiry,
  shareLinkPath,
  ShareLinkNotFoundError,
  type DocumentShareLink,
} from "../domain/document-share-link";
import { DocumentNotFoundError, IntegrityViolationError, SourceNotFoundError } from "../domain/errors";
import type { ShareTokenIssuer } from "../ports/share-token-issuer";
import type { KnowledgeRepositories, KnowledgeUnitOfWork } from "../ports/unit-of-work";

export type ShareLinkView = {
  id: string;
  label: string | null;
  /** `/s/<token>`; the browser composes the absolute URL (spec §9.4). */
  path: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  active: boolean;
  totalViews: number;
  lastViewedAt: Date | null;
};

export type SharedDocumentView = {
  title: string;
  markdown: string;
  sharedByName: string;
  updatedAt: Date;
  expiresAt: Date;
};

export const SHARE_LINK_CREATED_EVENT = "DOCUMENT_SHARE_LINK_CREATED";
export const SHARE_LINK_REVOKED_EVENT = "DOCUMENT_SHARE_LINK_REVOKED";

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

  async create(caller: CallerContext, input: { documentId: string; label?: unknown; expiresInDays?: unknown }): Promise<ShareLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const { document, source, workspace } = await lockOwnedScope(repositories, caller, input.documentId);
      const now = this.clock();
      const normalized = assertShareLinkCreation({
        callerId: caller.identity.id,
        documentStatus: document.status,
        sourceStatus: source.status,
        workspace,
        activeLinkCount: await repositories.shareLinks.countActiveByDocument(document.id, now),
        expiresInDays: input.expiresInDays,
        label: input.label,
      });
      const link: DocumentShareLink = {
        id: uuidv7(),
        documentId: document.id,
        token: this.tokens.issue(),
        label: normalized.label,
        createdBy: caller.identity.id,
        createdAt: now,
        expiresAt: shareLinkExpiry(now, normalized.expiresInDays),
        revokedBy: null,
        revokedAt: null,
      };
      // Guard the issuer: a sequential or derived token would be computable.
      if (!isShareToken(link.token)) throw new IntegrityViolationError("Share token issuer must return a random UUIDv4.");
      await repositories.shareLinks.insert(link);
      await repositories.auditEvents.append({
        id: uuidv7(),
        workspaceId: workspace.id,
        actorUserId: caller.identity.id,
        actorKind: "USER",
        eventType: SHARE_LINK_CREATED_EVENT,
        targetType: "DOCUMENT_SHARE_LINK",
        targetId: link.id,
        payload: { documentId: document.id, expiresAt: link.expiresAt.toISOString(), label: link.label },
        correlationId: null,
        createdAt: now,
      });
      return toView(link, now, undefined);
    });
  }

  async list(caller: CallerContext, documentId: string): Promise<ShareLinkView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      const document = await repositories.documents.findById(documentId);
      if (!document) throw new DocumentNotFoundError();
      const source = await repositories.sourcePolicy.findById(document.sourceId);
      if (!source) throw new DocumentNotFoundError();
      await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
      const workspace = await repositories.workspaces.findById(source.workspaceId);
      if (!workspace || workspace.personalOwnerUserId !== caller.identity.id) throw new DocumentNotFoundError();
      const links = await repositories.shareLinks.listByDocument(document.id);
      const totals = await repositories.shareLinks.viewTotals(links.map((link) => link.id));
      const now = this.clock();
      return links.map((link) => toView(link, now, totals.get(link.id)));
    });
  }

  async revoke(caller: CallerContext, linkId: string): Promise<void> {
    await this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      // No path locks a share link after Source/Workspace, so taking the link
      // first cannot invert the Phase 3 §14.2 order.
      const link = await repositories.shareLinks.lockById(linkId);
      if (!link || link.createdBy !== caller.identity.id) throw new ShareLinkNotFoundError();
      const { workspace } = await lockOwnedScope(repositories, caller, link.documentId).catch((error: unknown) => {
        if (error instanceof DocumentNotFoundError || error instanceof SourceNotFoundError) throw new ShareLinkNotFoundError();
        throw error;
      });
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
        payload: { documentId: link.documentId },
        correlationId: null,
        createdAt: now,
      });
    });
  }

  /**
   * The single caller-less content read (spec §6.1). Every failure is the
   * same ShareLinkNotFoundError so no response distinguishes a link that
   * once worked from one that never existed.
   */
  async readShared(token: string): Promise<SharedDocumentView> {
    if (!isShareToken(token)) throw new ShareLinkNotFoundError();
    const now = this.clock();
    const { linkId, view } = await this.unitOfWork.run(async (repositories) => {
      const link = await repositories.shareLinks.findByToken(token);
      if (!link) throw new ShareLinkNotFoundError();
      const document = await repositories.documents.findById(link.documentId);
      if (!document) throw new ShareLinkNotFoundError();
      const source = await repositories.sourcePolicy.findById(document.sourceId);
      if (!source) throw new ShareLinkNotFoundError();
      const workspace = await repositories.workspaces.findById(source.workspaceId);
      if (!workspace) throw new ShareLinkNotFoundError();
      const membership = await repositories.workspaceMemberships.find(workspace.id, link.createdBy);
      const verdict = evaluateShareLinkValidity({
        link,
        documentStatus: document.status,
        sourceStatus: source.status,
        workspaceLifecycle: workspace.lifecycleState,
        creatorDirectRole: membership ? membership.role ?? null : undefined,
        now,
      });
      if (!verdict.valid) throw new ShareLinkNotFoundError();
      const revision = await repositories.revisions.findCurrent(document.id);
      if (!revision) throw new IntegrityViolationError("Document current revision is missing.");
      const creator = await repositories.users.findById(link.createdBy);
      if (!creator) throw new IntegrityViolationError("Share link creator is missing.");
      return {
        linkId: link.id,
        view: { title: revision.title, markdown: revision.markdown, sharedByName: creator.name, updatedAt: revision.createdAt, expiresAt: link.expiresAt },
      };
    });
    try {
      // Separate transaction: the count is a statistic, not an audit record,
      // so failing to write it must not stop the reader (spec A5).
      await this.unitOfWork.run((repositories) => repositories.shareLinks.recordView(linkId, now));
    } catch {
      console.warn("Share link view count was not recorded.");
    }
    return view;
  }
}

/**
 * Locks Source then Workspace (Phase 3 §14.2 "non-import existing Source")
 * and proves the caller is a member. Whether the workspace is the caller's
 * own My Space is a creation rule, decided by assertShareLinkCreation.
 */
async function lockOwnedScope(repositories: KnowledgeRepositories, caller: CallerContext, documentId: string) {
  const document = await repositories.documents.findById(documentId);
  if (!document) throw new DocumentNotFoundError();
  const source = await repositories.sourcePolicy.lockById(document.sourceId);
  if (!source) throw new DocumentNotFoundError();
  const workspace = await repositories.workspaces.lockById(source.workspaceId);
  if (!workspace) throw new DocumentNotFoundError();
  await repositories.workspaceAccess.requireMembership(caller, workspace.id);
  return { document, source, workspace };
}

function toView(link: DocumentShareLink, now: Date, totals: { totalViews: number; lastViewedAt: Date | null } | undefined): ShareLinkView {
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
  };
}
