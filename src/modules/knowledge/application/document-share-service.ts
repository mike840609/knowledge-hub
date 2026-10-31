import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import { parseShareManagementQuery, SHARE_MANAGEMENT_PAGE_SIZE, type ShareManagementInput } from "../domain/share-management";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { isUuid, uuidv7 } from "@/shared/ids/uuidv7";
import {
  assertShareLinkCreation,
  isActiveShareLink,
  isShareToken,
  shareLinkExpiry,
  shareLinkPath,
  ShareLinkNotFoundError,
  type DocumentShareLink,
  type ShareLinkTarget,
} from "../domain/document-share-link";
import { extractDocumentLinks } from "../domain/document-links";
import { DocumentNotFoundError, IntegrityViolationError, SourceNotFoundError, ValidationError } from "../domain/errors";
import { linkLookupKey } from "../domain/link-graph";
import { buildLinkResolver } from "../domain/link-resolution";
import type { OpenFolderLink } from "../ports/document-share-link-repository";
import type { ShareTokenIssuer } from "../ports/share-token-issuer";
import { openShareLinkTarget, reachableChain } from "./internal/folder-link-reach";
import { linkOrigin } from "./internal/link-origin";
import type { TreeViewNode } from "../ports/tree-repository";
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
  revisionId: string;
  title: string;
  markdown: string;
  pageIcon: string | null;
  sharedByName: string;
  updatedAt: Date;
  expiresAt: Date;
};

/** One node of a shared folder's subtree: names and icons only, never a body. */
export type SharedTreeNode = {
  id: string;
  /** `null` for the shared folder's direct children. */
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
export type SharedTargetView = { kind: "DOCUMENT"; documentId: string } | { kind: "FOLDER"; documentId: string | null };

export type SharedFolderView = {
  kind: "FOLDER";
  folderName: string;
  /** Depth-first in the owner's tree order. */
  tree: SharedTreeNode[];
  /** `null` only when the folder holds no document. */
  document: SharedFolderDocument | null;
  sharedByName: string;
  expiresAt: Date;
};

export type SharedView = ({ kind: "DOCUMENT" } & SharedDocumentView) | SharedFolderView;

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
    return this.unitOfWork.run(async r => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const workspace = await r.workspaces.findById(workspaceId);
      if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") throw new DocumentNotFoundError();
      return r.shareLinks.listOpenFolderLinks(workspaceId, caller.identity.id, this.clock());
    });
  }

  /**
   * The shared folders a document is visible through: its ancestors, nearest first, that have a link open
   * now, reached through ACTIVE nodes only (folder share spec §8). Owner of the document's My Space only.
   */
  async foldersSharingDocument(caller: CallerContext, documentId: string): Promise<OpenFolderLink[]> {
    return this.unitOfWork.run(async r => {
      const { document, workspace } = await requireOwnedDocument(r, caller, documentId);
      if (document.status !== "ACTIVE") return [];
      const node = await r.tree.findByDocumentId(document.id);
      if (!node) return [];
      const open = new Map((await r.shareLinks.listOpenFolderLinks(workspace.id, caller.identity.id, this.clock())).map(folder => [folder.folderNodeId, folder]));
      if (open.size === 0) return [];
      const shared: OpenFolderLink[] = [];
      const seen = new Set<string>();
      for (const [index, ancestor] of (await r.tree.listChain(node.id)).entries()) {
        if (ancestor.status !== "ACTIVE" || seen.has(ancestor.id)) break;
        seen.add(ancestor.id);
        const folder = index > 0 ? open.get(ancestor.id) : undefined;
        if (folder) shared.push(folder);
      }
      return shared;
    });
  }

  async create(caller: CallerContext, input: { documentId: string; label?: unknown; expiresInDays?: unknown }): Promise<ShareLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { document, source, workspace } = await lockOwnedScope(repositories, caller, input.documentId);
      const target: ShareLinkTarget = { kind: "DOCUMENT", documentId: document.id };
      const activeLinkCount = await repositories.shareLinks.countActiveByDocument(document.id, this.clock());
      return this.issueLink(repositories, caller, { target, targetStatus: document.status, source, workspace, activeLinkCount, input });
    });
  }

  async createForFolder(caller: CallerContext, input: { folderNodeId: string; label?: unknown; expiresInDays?: unknown }): Promise<ShareLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { node, source, workspace } = await lockOwnedFolderScope(repositories, caller, input.folderNodeId);
      const target: ShareLinkTarget = { kind: "FOLDER", folderNodeId: node.id };
      const activeLinkCount = await repositories.shareLinks.countActiveByFolder(node.id, this.clock());
      return this.issueLink(repositories, caller, { target, targetStatus: node.status, source, workspace, activeLinkCount, input });
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
      input: { label?: unknown; expiresInDays?: unknown };
    },
  ): Promise<ShareLinkView> {
    const now = this.clock();
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
    const link: DocumentShareLink = {
      id: uuidv7(),
      target: scope.target,
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
      workspaceId: scope.workspace.id,
      actorUserId: caller.identity.id,
      actorKind: "USER",
      eventType: SHARE_LINK_CREATED_EVENT,
      targetType: "DOCUMENT_SHARE_LINK",
      targetId: link.id,
      payload: { ...targetPayload(link.target), expiresAt: link.expiresAt.toISOString(), label: link.label },
      correlationId: null,
      createdAt: now,
    });
    return toView(link, now, undefined);
  }

  async list(caller: CallerContext, documentId: string): Promise<ShareLinkView[]> {
    return this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      const { document } = await requireOwnedDocument(repositories, caller, documentId);
      const links = await repositories.shareLinks.listByDocument(document.id);
      const totals = await repositories.shareLinks.viewTotals(links.map((link) => link.id));
      const now = this.clock();
      return links.map((link) => toView(link, now, totals.get(link.id)));
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
      const links = await repositories.shareLinks.listByFolder(node.id);
      const totals = await repositories.shareLinks.viewTotals(links.map((link) => link.id));
      const now = this.clock();
      return links.map((link) => toView(link, now, totals.get(link.id)));
    });
  }

  async revoke(caller: CallerContext, linkId: string): Promise<void> {
    await this.unitOfWork.run(async (repositories) => {
      await syncCallerIdentity(repositories.users, caller);
      // No path locks a share link after Source/Workspace, so taking the link
      // first cannot invert the Phase 3 §14.2 order.
      const link = await repositories.shareLinks.lockById(linkId);
      if (!link || link.createdBy !== caller.identity.id) throw new ShareLinkNotFoundError();
      const { workspace } = await lockLinkTargetScope(repositories, caller, link.target).catch((error: unknown) => {
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
   */
  async readShared(token: string, { documentId, recordView = true }: { documentId?: string; recordView?: boolean } = {}): Promise<SharedView> {
    if (!isShareToken(token)) throw new ShareLinkNotFoundError();
    // A malformed id would make MariaDB's UUID column raise rather than match nothing.
    if (documentId !== undefined && !isUuid(documentId)) throw new ShareLinkNotFoundError();
    const now = this.clock();
    const { linkId, view } = await this.unitOfWork.run(async (repositories): Promise<{ linkId: string; view: SharedView }> => {
      const link = await repositories.shareLinks.findByToken(token);
      if (!link) throw new ShareLinkNotFoundError();
      if (link.target.kind === "FOLDER") return { linkId: link.id, view: await readSharedFolder(repositories, link, link.target.folderNodeId, documentId, now) };
      if (documentId !== undefined) throw new ShareLinkNotFoundError();
      const document = await repositories.documents.findById(link.target.documentId);
      if (!document) throw new ShareLinkNotFoundError();
      await requireOpenLink(repositories, link, document, now);
      const revision = await repositories.revisions.findCurrent(document.id);
      if (!revision) throw new IntegrityViolationError("Document current revision is missing.");
      const creator = await requireCreator(repositories, link);
      return {
        linkId: link.id,
        view: { kind: "DOCUMENT", revisionId: revision.id, title: revision.title, markdown: revision.markdown, pageIcon: document.pageIcon ?? null, sharedByName: creator.name, updatedAt: revision.createdAt, expiresAt: link.expiresAt },
      };
    });
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
   * no Markdown, creator or link catalog, and counts no view.
   */
  async readSharedTarget(token: string, { documentId }: { documentId?: string } = {}): Promise<SharedTargetView> {
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
        await requireOpenLink(repositories, link, document, now);
        return { kind: "DOCUMENT", documentId: document.id };
      }
      const folder = await repositories.tree.findById(link.target.folderNodeId);
      if (!folder || folder.nodeType !== "FOLDER") throw new ShareLinkNotFoundError();
      await requireOpenLink(repositories, link, folder, now);
      if (documentId !== undefined) {
        const document = await repositories.documents.findById(documentId);
        if (document && document.currentRevisionId !== null && await reachableChain(repositories, folder, document)) {
          return { kind: "FOLDER", documentId: document.id };
        }
      }
      const tree = sharedSubtree(await repositories.tree.listSubtree(folder.sourceId, folder.id), folder.id);
      return { kind: "FOLDER", documentId: tree.find((node) => node.documentId !== null)?.documentId ?? null };
    });
  }
}

/**
 * Whether the link opens now (spec §5.2), with its target — a document or a
 * folder node — in the document's place. Returns the target's Workspace.
 */
async function requireOpenLink(
  repositories: KnowledgeRepositories,
  link: DocumentShareLink,
  target: { sourceId: string; status: "ACTIVE" | "ARCHIVED" },
  now: Date,
): Promise<{ workspaceId: string }> {
  const open = await openShareLinkTarget(repositories, link, target, now);
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
): Promise<SharedFolderView> {
  const folder = await repositories.tree.findById(folderNodeId);
  if (!folder || folder.nodeType !== "FOLDER") throw new ShareLinkNotFoundError();
  const { workspaceId } = await requireOpenLink(repositories, link, folder, now);
  const sourceNodes = await repositories.tree.listSubtree(folder.sourceId, folder.id);
  const tree = sharedSubtree(sourceNodes, folder.id);
  const creator = await requireCreator(repositories, link);
  const view = { kind: "FOLDER" as const, folderName: folder.name ?? "", tree, sharedByName: creator.name, expiresAt: link.expiresAt };
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
    : lockOwnedFolderScope(repositories, caller, target.folderNodeId);
}

function requireFolder(node: { nodeType: "FOLDER" | "DOCUMENT" }): void {
  if (node.nodeType !== "FOLDER") throw new ValidationError("Only a folder can be shared as a folder link.");
}

function targetPayload(target: ShareLinkTarget) {
  return target.kind === "DOCUMENT" ? { documentId: target.documentId } : { folderNodeId: target.folderNodeId };
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
