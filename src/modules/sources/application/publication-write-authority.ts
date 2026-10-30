import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import { ROLE_WORKSPACE_CAPABILITIES } from "@/modules/workspaces/domain/workspace-capability";
import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { extractDocumentLinks } from "@/modules/knowledge/domain/document-links";
import {
  DocumentNotFoundError,
  InvalidParentError,
  NotFoundError,
  SourceArchivedError,
  TreeNodeNotFoundError,
  ValidationError,
} from "@/modules/knowledge/domain/errors";
import { fingerprintRevisionContent } from "@/modules/knowledge/domain/content";
import { isRevisionContentUnchanged as unchangedRevision } from "@/modules/knowledge/domain/revision";
import { normalizeFolderName, orderSiblingsByPosition } from "@/modules/knowledge/domain/tree-rules";
import { placeNodeAtIndex, renumberSiblingPositions } from "@/modules/knowledge/application/internal/tree-transaction";
import { uuidv7 } from "@/shared/ids/uuidv7";
import type {
  Contribution,
  Publication,
  RightsJudge,
} from "../domain/publication";
import type { SourceRepositories } from "../ports/unit-of-work";

/** The publication-side writers every later task uses. Their authority is opaque and binder-made. */
export interface PublicationProjection {
  copy(input: {
    originalDocumentId: string;
    parentId: string | null;
    nodeName: string;
    sourcePath: string | null;
  }): Promise<{ documentId: string; treeNodeId: string }>;
  refresh(teamDocumentId: string, originalDocumentId: string): Promise<{ changed: boolean }>;
  place(input: { teamDocumentId: string; parentId: string | null; nodeName: string }): Promise<void>;
  setDocumentStatus(teamDocumentId: string, status: "ACTIVE" | "ARCHIVED"): Promise<void>;
  ensureFolder(parentId: string | null, name: string): Promise<string>;
  pruneEmptyFolders(): Promise<void>;
}

const AUTHORITY = Symbol("publication-write-authority");

/**
 * Opaque capability handed back by `bindPublicationProjection`. There is no
 * public constructor and no `force`/`isSync` switch: a caller either holds one
 * made by the binder after the rights check, or cannot write at all.
 */
type PublicationAuthority = {
  readonly [AUTHORITY]: true;
  readonly publication: Publication;
  readonly contribution: Contribution;
  readonly sourceId: string;
  readonly workspaceId: string;
  /** The contributor whose original first produced a team copy; recorded as its creator. */
  readonly actorId: string;
};

/**
 * The one rights rule, shared with the later reconciler (Task 5).
 *
 * CALLER: the contributor's own request, judged with their validated groups; an
 * active Team workspace and `source.manage` are required.
 * NO_CALLER: a worker, restore or catch-up cannot judge groups, so only a direct
 * membership row holding `source.manage` in an active Team is accepted;
 * everything else is left to be reconciled on that contributor's next request.
 */
export async function publicationWriteRightsAllow(
  repositories: SourceRepositories,
  publication: Publication,
  contribution: Contribution,
  judge: RightsJudge,
): Promise<boolean> {
  if (contribution.leftAt !== null) return false;
  const workspace = await repositories.workspaces.findById(publication.teamWorkspaceId);
  if (!workspace || workspace.workspaceType !== "TEAM" || workspace.lifecycleState !== "ACTIVE") return false;

  if (judge.kind === "CALLER") {
    if (judge.caller.identity.id !== contribution.userId) return false;
    const capabilities = await evaluateWorkspaceCapabilities(repositories, judge.caller, publication.teamWorkspaceId);
    return capabilities.has("source.manage");
  }

  const membership = await repositories.workspaceMemberships.find(publication.teamWorkspaceId, contribution.userId);
  if (!membership || membership.role === null || membership.role === undefined) return false;
  return ROLE_WORKSPACE_CAPABILITIES[membership.role].includes("source.manage");
}

export async function requirePublicationWriteRights(
  repositories: SourceRepositories,
  publication: Publication,
  contribution: Contribution,
  judge: RightsJudge,
): Promise<void> {
  if (!(await publicationWriteRightsAllow(repositories, publication, contribution, judge))) {
    throw new WorkspaceAccessDeniedError("Updating this publication requires source.manage in its active team.");
  }
}

function requireActiveParent(
  nodes: readonly { id: string; sourceId: string; nodeType: string; status: string; parentId: string | null; position: number }[],
  sourceId: string,
  parentId: string | null,
): void {
  if (parentId === null) return;
  const parent = nodes.find((node) => node.id === parentId);
  if (!parent || parent.sourceId !== sourceId) throw new TreeNodeNotFoundError("Parent folder was not found in this publication.");
  if (parent.nodeType !== "FOLDER" || parent.status !== "ACTIVE") throw new InvalidParentError();
}

function requireFolderName(name: string): string {
  return normalizeFolderName(name);
}

/**
 * Binds the publication-only writers to the caller's open transaction and the
 * authorized publication source. Reads publication, contribution and source
 * under the Source lock, then judges the contributor's rights. No nested unit
 * of work is opened; the owning orchestration commits once.
 */
export async function bindPublicationProjection(
  repositories: SourceRepositories,
  input: { publicationId: string; contributionId: string; judge: RightsJudge },
): Promise<PublicationProjection> {
  const publication = await repositories.publications.findById(input.publicationId);
  if (!publication) throw new NotFoundError("Publication was not found.");

  const source = await repositories.sources.lockById(publication.sourceId);
  if (!source || source.sourceType !== "PUBLICATION") {
    throw new NotFoundError("Publication source was not found.");
  }
  if (publication.status !== "ACTIVE") throw new SourceArchivedError("This publication is archived.");

  const contributions = await repositories.publications.listContributions(publication.id);
  const contribution = contributions.find((candidate) => candidate.id === input.contributionId);
  if (!contribution || contribution.publicationId !== publication.id) {
    throw new NotFoundError("Publication contribution was not found.");
  }

  await requirePublicationWriteRights(repositories, publication, contribution, input.judge);

  const authority: PublicationAuthority = {
    [AUTHORITY]: true,
    publication,
    contribution,
    sourceId: source.id,
    workspaceId: publication.teamWorkspaceId,
    actorId: contribution.userId,
  };

  function requireSameSource(node: { sourceId: string } | null): void {
    if (!node || node.sourceId !== authority.sourceId) throw new DocumentNotFoundError();
  }

  async function nodes(): Promise<Awaited<ReturnType<SourceRepositories["tree"]["listBySource"]>>> {
    return repositories.tree.listBySource(authority.sourceId);
  }

  async function requireOriginalInContribution(originalDocumentId: string): Promise<void> {
    const document = await repositories.documents.findById(originalDocumentId);
    if (!document || document.status !== "ACTIVE") throw new DocumentNotFoundError();
    if (authority.contribution.origin.kind === "DOCUMENT") {
      if (authority.contribution.origin.documentId !== originalDocumentId) {
        throw new DocumentNotFoundError("This original does not belong to the contribution.");
      }
      return;
    }
    const node = await repositories.tree.findByDocumentId(originalDocumentId);
    if (!node) throw new DocumentNotFoundError();
    const chain = await repositories.tree.listChain(node.id);
    if (!chain.some((entry) => entry.id === (authority.contribution.origin as { folderNodeId: string }).folderNodeId)) {
      throw new DocumentNotFoundError("This original is not inside the contribution's published folder.");
    }
  }

  async function currentRevision(documentId: string) {
    const revision = await repositories.revisions.findCurrent(documentId);
    if (!revision) throw new DocumentNotFoundError("Document current revision is missing.");
    return revision;
  }

  async function createRevisionCopy(teamDocumentId: string, originalRevision: Awaited<ReturnType<typeof currentRevision>>): Promise<string> {
    const content = {
      title: originalRevision.title,
      markdown: originalRevision.markdown,
      metadata: originalRevision.metadata,
    };
    const { contentHash } = fingerprintRevisionContent(content);
    const revisionId = uuidv7();
    const revisionNo = await repositories.revisions.nextRevisionNumber(teamDocumentId);
    await repositories.revisions.insert({
      id: revisionId,
      documentId: teamDocumentId,
      revisionNo,
      ...content,
      contentHash,
      createdBy: authority.actorId,
      createdAt: new Date(),
    });
    await repositories.documents.setCurrentRevision(teamDocumentId, revisionId, authority.actorId);
    await repositories.links.replaceForDocument({
      documentId: teamDocumentId,
      revisionId,
      links: extractDocumentLinks(content.markdown),
    });
    await repositories.documents.assertComplete(teamDocumentId);
    return revisionId;
  }

  return {
    async copy(input) {
      await requireOriginalInContribution(input.originalDocumentId);
      if (!input.nodeName.trim()) throw new ValidationError("A copied document needs a non-empty name.");
      const original = await currentRevision(input.originalDocumentId);
      const allNodes = await nodes();
      requireActiveParent(allNodes, authority.sourceId, input.parentId);

      const siblings = allNodes.filter((node) => node.parentId === input.parentId);
      const index = siblings.length;
      const now = new Date();
      const documentId = uuidv7();
      const treeNodeId = uuidv7();

      await repositories.documents.insertDraft({
        id: documentId,
        sourceId: authority.sourceId,
        currentRevisionId: null,
        status: "ACTIVE",
        createdBy: authority.actorId,
        updatedBy: authority.actorId,
        archivedBy: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await createRevisionCopy(documentId, original);
      await repositories.tree.insert({
        id: treeNodeId,
        sourceId: authority.sourceId,
        parentId: input.parentId,
        nodeType: "DOCUMENT",
        name: null,
        documentId,
        position: index,
        status: "ACTIVE",
        updatedBy: authority.actorId,
        archivedBy: null,
        archivedAt: null,
      });
      await placeNodeAtIndex(repositories, authority.sourceId, treeNodeId, input.parentId, index, authority.actorId);

      await repositories.publications.insertDocument({
        teamDocumentId: documentId,
        publicationId: authority.publication.id,
        creatorContributionId: authority.contribution.id,
        currentOriginalDocumentId: input.originalDocumentId,
        sourcePath: input.sourcePath,
        status: "ACTIVE",
      });
      return { documentId, treeNodeId };
    },

    async refresh(teamDocumentId, originalDocumentId) {
      const documents = await repositories.publications.listDocuments(authority.publication.id);
      const teamDocument = documents.find((candidate) => candidate.teamDocumentId === teamDocumentId);
      if (!teamDocument || teamDocument.currentOriginalDocumentId !== originalDocumentId) {
        throw new NotFoundError("This team document is not fed by that original.");
      }
      // The copy must live in the publication source this authority owns.
      const stored = await repositories.documents.findById(teamDocumentId);
      requireSameSource(stored);

      const original = await currentRevision(originalDocumentId);
      const teamCurrent = await currentRevision(teamDocumentId);
      if (unchangedRevision(teamCurrent, {
        title: original.title,
        markdown: original.markdown,
        metadata: original.metadata,
      })) {
        return { changed: false };
      }
      await createRevisionCopy(teamDocumentId, original);
      return { changed: true };
    },

    async place(input) {
      const stored = await repositories.documents.findById(input.teamDocumentId);
      requireSameSource(stored);
      const node = await repositories.tree.findByDocumentId(input.teamDocumentId);
      if (!node || node.sourceId !== authority.sourceId) throw new TreeNodeNotFoundError();
      const allNodes = await nodes();
      requireActiveParent(allNodes, authority.sourceId, input.parentId);
      if (!input.nodeName.trim()) throw new ValidationError("A placed document needs a non-empty name.");
      const previousParentId = node.parentId;
      if (previousParentId !== input.parentId) {
        await repositories.tree.updateParent(node.id, input.parentId, authority.actorId);
      }
      const siblings = orderSiblingsByPosition(allNodes.filter((candidate) => candidate.parentId === input.parentId && candidate.id !== node.id));
      // A document node stores no name (its title is the revision's); `nodeName`
      // is the placement label the caller must supply, never persisted here.
      await placeNodeAtIndex(repositories, authority.sourceId, node.id, input.parentId, siblings.length, authority.actorId);
      if (previousParentId !== input.parentId) {
        await renumberSiblingPositions(repositories, authority.sourceId, previousParentId, authority.actorId);
      }
    },

    async setDocumentStatus(teamDocumentId, status) {
      const stored = await repositories.documents.findById(teamDocumentId);
      requireSameSource(stored);
      if (stored?.status === status) return;
      await repositories.documents.updateStatus(teamDocumentId, status, authority.actorId);
      await repositories.tree.updateStatusForDocument(teamDocumentId, status, authority.actorId);
    },

    async ensureFolder(parentId, name) {
      const normalized = requireFolderName(name);
      const allNodes = await nodes();
      requireActiveParent(allNodes, authority.sourceId, parentId);
      const existing = allNodes.find((node) =>
        node.parentId === parentId && node.nodeType === "FOLDER" && node.status === "ACTIVE" && node.name === normalized);
      if (existing) return existing.id;
      const siblings = allNodes.filter((node) => node.parentId === parentId);
      const treeNodeId = uuidv7();
      await repositories.tree.insert({
        id: treeNodeId,
        sourceId: authority.sourceId,
        parentId,
        nodeType: "FOLDER",
        name: normalized,
        documentId: null,
        position: siblings.length,
        status: "ACTIVE",
        updatedBy: authority.actorId,
        archivedBy: null,
        archivedAt: null,
      });
      await placeNodeAtIndex(repositories, authority.sourceId, treeNodeId, parentId, siblings.length, authority.actorId);
      return treeNodeId;
    },

    async pruneEmptyFolders() {
      for (;;) {
        const allNodes = await nodes();
        const activeChildren = new Set(allNodes.filter((node) => node.status === "ACTIVE" && node.parentId !== null).map((node) => node.parentId!));
        const empty = allNodes.filter((node) => node.nodeType === "FOLDER" && node.status === "ACTIVE" && !activeChildren.has(node.id));
        if (empty.length === 0) return;
        for (const folder of empty) {
          await repositories.tree.updateStatus(folder.id, "ARCHIVED", authority.actorId);
        }
      }
    },
  };
}
