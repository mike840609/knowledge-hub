import { WorkspaceAccessDeniedError } from "@/modules/workspaces/domain/errors";
import { NotFoundError, SourceNotFoundError } from "@/modules/knowledge/domain/errors";
import type { KnowledgeRevision } from "@/modules/knowledge/domain/revision";
import {
  planPublicationMoves,
  relativePublicationPath,
  type Contribution,
  type PlannedMove,
  type Publication,
  type PublicationDocument,
  type PublicationNotice,
  type ReconcileReport,
  type RightsJudge,
} from "../domain/publication";
import type { SourceRepositories } from "../ports/unit-of-work";
import {
  bindPublicationProjection,
  publicationWriteRightsAllow,
  type PublicationProjection,
} from "./publication-write-authority";

export type ReconcileState = "APPLIED" | "FROZEN" | "PENDING" | "SKIPPED";

/** One eligible original with the placement its current state asks for. */
type EligibleOriginal = {
  documentId: string;
  revision: KnowledgeRevision;
  /** Publication-relative Folder Sync path; `null` for Hub-written documents and document publications. */
  teamPath: string | null;
  /** Personal-tree folder names for a `null` path, relative to the publication root. */
  folderNames: string[];
};

function emptyReport(): ReconcileReport {
  return { created: 0, updated: 0, moved: 0, archived: 0, restored: 0, notices: [] };
}

function sortByDocumentId(originals: EligibleOriginal[]): EligibleOriginal[] {
  return originals.sort((left, right) => left.documentId.localeCompare(right.documentId));
}

/**
 * The source must still be a personal workspace of the contribution's user, be
 * ACTIVE, and belong to that user. A publication origin lives in My Space even
 * when the team side is frozen or archived.
 */
async function personalSourceOf(
  repositories: SourceRepositories,
  sourceId: string,
  userId: string,
): Promise<boolean> {
  const source = await repositories.sources.findById(sourceId);
  if (!source || source.status !== "ACTIVE") return false;
  const workspace = await repositories.workspaces.findById(source.workspaceId);
  return workspace?.workspaceType === "PERSONAL"
    && workspace.personalOwnerUserId === userId
    && workspace.lifecycleState === "ACTIVE";
}

function pathFolderNames(teamPath: string): string[] {
  const segments = teamPath.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

/**
 * Every document currently eligible for one contribution, from current source,
 * document, tree and ancestor state. Nothing here trusts an event payload.
 */
async function loadEligibleOriginals(
  repositories: SourceRepositories,
  publication: Publication,
  contribution: Contribution,
): Promise<EligibleOriginal[]> {
  if (publication.kind === "DOCUMENT") {
    if (contribution.origin.kind !== "DOCUMENT") return [];
    const document = await repositories.documents.findById(contribution.origin.documentId);
    if (!document || document.status !== "ACTIVE" || document.currentRevisionId === null) return [];
    if (!(await personalSourceOf(repositories, document.sourceId, contribution.userId))) return [];
    const node = await repositories.tree.findByDocumentId(document.id);
    if (!node || node.status !== "ACTIVE") return [];
    const chain = await repositories.tree.listChain(node.id);
    if (chain.length === 0 || chain.some((entry) => entry.status !== "ACTIVE")) return [];
    const revision = await repositories.revisions.findById(document.currentRevisionId);
    if (!revision) return [];
    // A single-document publication has no path and does not care which folder
    // currently holds the original.
    return [{ documentId: document.id, revision, teamPath: null, folderNames: [] }];
  }

  if (contribution.origin.kind !== "FOLDER") return [];
  const folder = await repositories.tree.findById(contribution.origin.folderNodeId);
  if (!folder || folder.nodeType !== "FOLDER" || folder.status !== "ACTIVE") return [];
  if (!(await personalSourceOf(repositories, folder.sourceId, contribution.userId))) return [];

  const nodes = await repositories.tree.listSubtree(folder.sourceId, folder.id);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const documentNodes = nodes.filter((node) =>
    node.nodeType === "DOCUMENT"
    && node.documentId !== null
    && node.status === "ACTIVE"
    && node.documentStatus === "ACTIVE"
    && node.currentRevisionId !== null);
  if (documentNodes.length === 0) return [];

  const documentIds = documentNodes.map((node) => node.documentId as string);
  const chains = await repositories.tree.listChainsByDocumentIds(documentIds, folder.sourceId);
  const revisions = await repositories.revisions.findByIds(
    documentNodes.map((node) => node.currentRevisionId as string),
  );
  const revisionById = new Map(revisions.map((revision) => [revision.id, revision]));
  const entries = await repositories.entries.findByDocumentIds(documentIds);
  const entryByDocument = new Map(
    entries.filter((entry) => entry.documentId !== null).map((entry) => [entry.documentId as string, entry]),
  );
  const rootEntry = await repositories.entries.findByTreeNodeId(folder.id);
  const rootPath = rootEntry?.sourcePath ?? null;

  const eligible: EligibleOriginal[] = [];
  for (const node of documentNodes) {
    const documentId = node.documentId as string;
    const chain = chains.get(documentId) ?? [];
    if (chain.length === 0 || chain.some((entry) => entry.status !== "ACTIVE")) continue;
    const originIndex = chain.findIndex((entry) => entry.id === folder.id);
    if (originIndex < 0) continue;
    const revision = revisionById.get(node.currentRevisionId as string);
    if (!revision) continue;

    const entry = entryByDocument.get(documentId) ?? null;
    const teamPath = rootPath === null
      ? null
      : relativePublicationPath(entry?.sourcePath ?? null, rootPath);
    let folderNames: string[] = [];
    if (teamPath === null) {
      const names: string[] = [];
      for (let index = 1; index < originIndex; index += 1) {
        const name = nodeById.get(chain[index].id)?.name;
        if (name !== null && name !== undefined) names.push(name);
      }
      folderNames = names.reverse();
    }
    eligible.push({ documentId, revision, teamPath, folderNames });
  }
  return sortByDocumentId(eligible);
}

function notice(
  publicationId: string,
  originalDocumentId: string,
  code: PublicationNotice["code"],
  maintainerUserId?: string,
): PublicationNotice {
  return maintainerUserId === undefined
    ? { publicationId, originalDocumentId, code }
    : { publicationId, originalDocumentId, code, maintainerUserId };
}

/**
 * Reconcile one contribution from the current state of its originals.
 *
 * Runs inside the caller's single transaction (no nested unit of work): claims,
 * paths, tree, revisions, links and the report commit or roll back together.
 * Rights are judged first; a contributor who lost them is frozen, a caller-less
 * run that cannot prove a direct grant (or meets a rights freeze) is pending.
 */
export async function reconcileContribution(
  repositories: SourceRepositories,
  input: { publicationId: string; contributionId: string; judge: RightsJudge; now: Date },
): Promise<{ state: ReconcileState; report: ReconcileReport }> {
  const routed = await repositories.publications.findById(input.publicationId);
  if (!routed) throw new NotFoundError("Publication was not found.");
  const source = await repositories.sources.lockById(routed.sourceId);
  if (!source) throw new SourceNotFoundError();
  const publication = await repositories.publications.findBySourceId(source.id);
  if (
    !publication
    || publication.id !== input.publicationId
    || publication.status !== "ACTIVE"
    || source.status !== "ACTIVE"
  ) {
    // Archived publications are sticky: a save or a worker never restores one.
    return { state: "SKIPPED", report: emptyReport() };
  }

  const contributions = await repositories.publications.listContributions(publication.id);
  const contribution = contributions.find((candidate) => candidate.id === input.contributionId);
  if (!contribution || contribution.publicationId !== publication.id) {
    throw new NotFoundError("Publication contribution was not found.");
  }
  if (contribution.leftAt !== null) return { state: "SKIPPED", report: emptyReport() };

  if (input.judge.kind === "CALLER" && input.judge.caller.identity.id !== contribution.userId) {
    throw new WorkspaceAccessDeniedError("A caller can only reconcile their own contribution.");
  }
  const allowed = await publicationWriteRightsAllow(repositories, publication, contribution, input.judge);
  if (!allowed) {
    if (input.judge.kind === "CALLER") {
      const frozenAt = contribution.rightsFrozenAt ?? input.now;
      if (contribution.rightsFrozenAt === null) {
        await repositories.publications.setContributionState(contribution.id, {
          leftAt: contribution.leftAt,
          rightsFrozenAt: frozenAt,
          pendingCatchUp: contribution.pendingCatchUp,
        });
      }
      return { state: "FROZEN", report: emptyReport() };
    }
    // Without a caller only a direct grant can apply, and only the contributor's
    // own request may clear a rights freeze.
    if (contribution.rightsFrozenAt === null && !contribution.pendingCatchUp) {
      await repositories.publications.setContributionState(contribution.id, {
        leftAt: contribution.leftAt,
        rightsFrozenAt: null,
        pendingCatchUp: true,
      });
    }
    return { state: "PENDING", report: emptyReport() };
  }
  if (contribution.rightsFrozenAt !== null && input.judge.kind === "NO_CALLER") {
    return { state: "PENDING", report: emptyReport() };
  }

  const projection = await bindPublicationProjection(repositories, {
    publicationId: publication.id,
    contributionId: contribution.id,
    judge: input.judge,
  });

  const originals = await loadEligibleOriginals(repositories, publication, contribution);
  const report = await applyReconciliation(repositories, projection, publication, contribution, originals);

  const previous = await repositories.publications.findReport(contribution.id);
  const quiet = report.created === 0
    && report.updated === 0
    && report.moved === 0
    && report.archived === 0
    && report.restored === 0
    && previous !== null
    && JSON.stringify(previous.notices) === JSON.stringify(report.notices);
  if (!quiet) await repositories.publications.saveReport(contribution.id, report);

  if (contribution.rightsFrozenAt !== null || contribution.pendingCatchUp) {
    await repositories.publications.setContributionState(contribution.id, {
      leftAt: contribution.leftAt,
      rightsFrozenAt: null,
      pendingCatchUp: false,
    });
  }
  return { state: "APPLIED", report };
}

/**
 * Read every current fact before writing: eligible originals, persisted
 * bindings and all team copies. Restore/reattach the creator's own archived
 * holder, resolve legal moves against the simultaneous final state, then apply
 * creation, refresh, placement and archival.
 */
async function applyReconciliation(
  repositories: SourceRepositories,
  projection: PublicationProjection,
  publication: Publication,
  contribution: Contribution,
  originals: readonly EligibleOriginal[],
): Promise<ReconcileReport> {
  const report = emptyReport();
  const documents = await repositories.publications.listDocuments(publication.id);
  let bindings = await repositories.publications.listBindings(contribution.id);
  const contributions = await repositories.publications.listContributions(publication.id);
  const movedDocumentIds = new Set<string>();

  const documentOf = (teamDocumentId: string) => documents.find((document) => document.teamDocumentId === teamDocumentId);
  const bindingOf = (originalDocumentId: string) =>
    bindings.find((binding) => binding.originalDocumentId === originalDocumentId);
  const isOwn = (document: PublicationDocument) => document.creatorContributionId === contribution.id;
  const activeOwnFedBy = (originalDocumentId: string) => documents.find((document) =>
    isOwn(document) && document.status === "ACTIVE" && document.currentOriginalDocumentId === originalDocumentId);
  const holderOfPath = (teamPath: string | null) => teamPath === null
    ? undefined
    : documents.find((document) => document.sourcePath === teamPath);
  const maintainerOf = (document: PublicationDocument) =>
    contributions.find((candidate) => candidate.id === document.creatorContributionId)?.userId;

  async function rememberBinding(originalDocumentId: string, teamDocumentId: string): Promise<void> {
    const existing = bindingOf(originalDocumentId);
    if (existing?.teamDocumentId === teamDocumentId) return;
    if (existing) {
      await repositories.publications.unbind(contribution.id, originalDocumentId);
      bindings = bindings.filter((binding) => binding.originalDocumentId !== originalDocumentId);
    }
    await repositories.publications.bind({
      contributionId: contribution.id,
      originalDocumentId,
      teamDocumentId,
    });
    bindings.push({ contributionId: contribution.id, originalDocumentId, teamDocumentId });
  }

  async function restore(document: PublicationDocument): Promise<void> {
    if (document.status === "ACTIVE") return;
    await projection.setDocumentStatus(document.teamDocumentId, "ACTIVE");
    document.status = "ACTIVE";
    report.restored += 1;
  }

  async function archive(document: PublicationDocument): Promise<void> {
    if (document.status === "ARCHIVED") return;
    await projection.setDocumentStatus(document.teamDocumentId, "ARCHIVED");
    document.status = "ARCHIVED";
    report.archived += 1;
  }

  /**
   * The incoming original lands on the creator's own archived copy: the old copy
   * is archived (its path stays reserved), the archived copy is repointed,
   * restored and keeps its discussion threads.
   */
  async function reattach(
    holder: PublicationDocument,
    original: EligibleOriginal,
    current: PublicationDocument | undefined,
  ): Promise<void> {
    if (current && current.teamDocumentId !== holder.teamDocumentId) {
      await archive(current);
      await repositories.publications.unbind(contribution.id, original.documentId);
      bindings = bindings.filter((binding) => binding.originalDocumentId !== original.documentId);
    } else if (bindingOf(original.documentId)) {
      await repositories.publications.unbind(contribution.id, original.documentId);
      bindings = bindings.filter((binding) => binding.originalDocumentId !== original.documentId);
    }
    await repositories.publications.repoint(holder.teamDocumentId, original.documentId);
    // repoint replaced the holder's previous creator binding.
    bindings = bindings.filter((binding) =>
      !(binding.contributionId === contribution.id && binding.teamDocumentId === holder.teamDocumentId));
    bindings.push({
      contributionId: contribution.id,
      originalDocumentId: original.documentId,
      teamDocumentId: holder.teamDocumentId,
    });
    holder.currentOriginalDocumentId = original.documentId;
    await restore(holder);
  }

  const mapped: { original: EligibleOriginal; teamDocumentId: string }[] = [];
  const toCreate: EligibleOriginal[] = [];

  for (const original of originals) {
    const binding = bindingOf(original.documentId);
    const bound = binding === undefined ? undefined : documentOf(binding.teamDocumentId);
    if (bound && !isOwn(bound)) {
      // Mapped to another creator's copy: only report it, never create or
      // overwrite. The remembered binding is what keeps the message stable.
      report.notices.push(notice(
        publication.id, original.documentId, "MAINTAINED_BY_OTHER", maintainerOf(bound)));
      continue;
    }

    let target = bound;
    if (binding && !bound) {
      // Defensive: the binding points at no team copy of this publication.
      await repositories.publications.unbind(contribution.id, original.documentId);
      bindings = bindings.filter((candidate) => candidate.originalDocumentId !== original.documentId);
    } else if (target && target.currentOriginalDocumentId !== original.documentId) {
      // Defensive: a stale binding never lets one original feed two copies.
      await repositories.publications.unbind(contribution.id, original.documentId);
      bindings = bindings.filter((candidate) => candidate.originalDocumentId !== original.documentId);
      target = undefined;
    }
    const holder = holderOfPath(original.teamPath);

    if (target) {
      if (
        holder
        && holder.teamDocumentId !== target.teamDocumentId
        && isOwn(holder)
        && holder.status === "ARCHIVED"
      ) {
        await reattach(holder, original, target);
        target = holder;
      } else {
        await restore(target);
      }
      mapped.push({ original, teamDocumentId: target.teamDocumentId });
      continue;
    }

    const activeOwn = activeOwnFedBy(original.documentId);
    if (holder && isOwn(holder) && holder.status === "ARCHIVED" && holder.teamDocumentId !== activeOwn?.teamDocumentId) {
      // A move onto the creator's own archived copy: the archived copy is
      // restored and repointed, and its old copy (if any) is archived keeping
      // its own path.
      await reattach(holder, original, activeOwn);
      mapped.push({ original, teamDocumentId: holder.teamDocumentId });
      continue;
    }
    if (activeOwn) {
      // A remembered binding is missing, but the current original still feeds
      // this copy; repair the memory instead of creating a duplicate.
      await rememberBinding(original.documentId, activeOwn.teamDocumentId);
      mapped.push({ original, teamDocumentId: activeOwn.teamDocumentId });
      continue;
    }
    if (holder) {
      if (!isOwn(holder)) {
        await rememberBinding(original.documentId, holder.teamDocumentId);
        report.notices.push(notice(
          publication.id, original.documentId, "MAINTAINED_BY_OTHER", maintainerOf(holder)));
        continue;
      }
      // The creator's own active copy already holds this path for another
      // original; this one cannot take it.
      report.notices.push(notice(publication.id, original.documentId, "PATH_RESERVED"));
      continue;
    }

    toCreate.push(original);
  }

  // An original that is no longer eligible — archived, removed, moved out of the
  // folder, or its source archived — archives the copy it used to feed.
  const kept = new Set(mapped.map((entry) => entry.teamDocumentId));
  for (const document of documents) {
    if (isOwn(document) && document.status === "ACTIVE" && !kept.has(document.teamDocumentId)) {
      await archive(document);
    }
  }

  // Resolve the creator's moves against the simultaneous final state, so swaps
  // and rotations apply; a conflict keeps the old path and is reported.
  const held = new Map(documents.map((document) => [document.teamDocumentId, document]));
  const planned: PlannedMove[] = [];
  const originalByDocument = new Map(mapped.map((entry) => [entry.teamDocumentId, entry.original]));
  for (const entry of mapped) {
    const document = documentOf(entry.teamDocumentId);
    if (!document) continue;
    if (document.sourcePath !== entry.original.teamPath) {
      planned.push({
        teamDocumentId: document.teamDocumentId,
        fromPath: document.sourcePath,
        toPath: entry.original.teamPath,
      });
    }
  }
  const { applied, blocked } = planPublicationMoves(planned, held);
  if (applied.length > 0) await repositories.publications.applyPaths(applied);
  for (const move of applied) {
    const document = documentOf(move.teamDocumentId);
    if (!document) continue;
    document.sourcePath = move.toPath;
    movedDocumentIds.add(document.teamDocumentId);
  }
  for (const move of blocked) {
    const original = originalByDocument.get(move.teamDocumentId);
    if (!original) continue;
    report.notices.push(notice(publication.id, original.documentId, "PATH_RESERVED"));
  }

  const teamNodes = await repositories.tree.listBySource(publication.sourceId);
  const teamNodeByDocument = new Map(
    teamNodes
      .filter((node) => node.nodeType === "DOCUMENT" && node.documentId !== null)
      .map((node) => [node.documentId as string, node]),
  );

  async function ensureFolders(names: readonly string[]): Promise<string | null> {
    let parentId: string | null = null;
    for (const name of names) parentId = await projection.ensureFolder(parentId, name);
    return parentId;
  }

  function placementNames(original: EligibleOriginal, storedTeamPath: string | null): string[] {
    if (publication.kind === "DOCUMENT") return [];
    if (storedTeamPath !== null) return pathFolderNames(storedTeamPath);
    return original.folderNames;
  }

  for (const entry of mapped) {
    const document = documentOf(entry.teamDocumentId);
    if (!document || document.status !== "ACTIVE") continue;
    const parentId = await ensureFolders(placementNames(entry.original, document.sourcePath));
    const node = teamNodeByDocument.get(document.teamDocumentId)
      ?? await repositories.tree.findByDocumentId(document.teamDocumentId);
    if (!node || node.parentId !== parentId) {
      await projection.place({
        teamDocumentId: document.teamDocumentId,
        parentId,
        nodeName: entry.original.revision.title,
      });
      movedDocumentIds.add(document.teamDocumentId);
    }
    const refreshed = await projection.refresh(document.teamDocumentId, entry.original.documentId);
    if (refreshed.changed) report.updated += 1;
  }

  for (const original of toCreate) {
    const parentId = await ensureFolders(placementNames(original, original.teamPath));
    await projection.copy({
      originalDocumentId: original.documentId,
      parentId,
      nodeName: original.revision.title,
      sourcePath: original.teamPath,
    });
    // `copy` inserts the binding in the same transaction.
    report.created += 1;
  }

  await projection.pruneEmptyFolders();
  report.moved = movedDocumentIds.size;
  return report;
}
