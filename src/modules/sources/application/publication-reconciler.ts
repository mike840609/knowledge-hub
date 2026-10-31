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
  extra?: { maintainerUserId?: string; existingPublicationName?: string },
): PublicationNotice {
  return {
    publicationId,
    originalDocumentId,
    code,
    ...(extra?.maintainerUserId === undefined ? {} : { maintainerUserId: extra.maintainerUserId }),
    ...(extra?.existingPublicationName === undefined
      ? {}
      : { existingPublicationName: extra.existingPublicationName }),
  };
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
 * bindings and all team copies. Lifecycle and moves are decided before matching:
 * copies fed by ineligible originals are archived first, mapped moves are
 * resolved against the simultaneous final state, and only then do unbound
 * originals match a holder (a holder moving away or archived is free).
 * Creation, refresh, placement and archival follow.
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
  /** Copies archived by this run that still need a net count at the end. */
  const archivedThisRun = new Set<string>();
  let restoredCount = 0;
  const eligibleIds = new Set(originals.map((original) => original.documentId));

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

  /** The other active publication claiming this original in this team, if any. */
  async function findClaimName(originalDocumentId: string): Promise<string | null> {
    const claim = await repositories.publications.findClaim(
      originalDocumentId, publication.teamWorkspaceId, publication.id);
    return claim?.publicationName ?? null;
  }

  function pushClaimNotice(originalDocumentId: string, existingPublicationName: string): void {
    report.notices.push(notice(
      publication.id, originalDocumentId, "ORIGINAL_ALREADY_PUBLISHED", { existingPublicationName }));
  }

  /**
   * Remembers an original → team copy pairing. A cross-publication claim
   * conflict is isolated in a savepoint and reported, never allowed to abort the
   * contribution's other originals.
   */
  async function rememberBinding(originalDocumentId: string, teamDocumentId: string): Promise<boolean> {
    const existing = bindingOf(originalDocumentId);
    if (existing?.teamDocumentId === teamDocumentId) return true;
    const claim = await findClaimName(originalDocumentId);
    if (claim !== null) {
      pushClaimNotice(originalDocumentId, claim);
      return false;
    }
    const attempt = await repositories.publications.runClaimAttempt(async () => {
      if (existing) {
        await repositories.publications.unbind(publication.id, contribution.id, originalDocumentId);
      }
      await repositories.publications.bind({
        contributionId: contribution.id,
        originalDocumentId,
        teamDocumentId,
      });
    });
    if (!attempt.ok) {
      const winner = await findClaimName(originalDocumentId);
      if (winner !== null) {
        pushClaimNotice(originalDocumentId, winner);
        return false;
      }
      throw attempt.error;
    }
    bindings = bindings.filter((binding) => binding.originalDocumentId !== originalDocumentId);
    bindings.push({ contributionId: contribution.id, originalDocumentId, teamDocumentId });
    return true;
  }

  async function restore(document: PublicationDocument): Promise<void> {
    if (document.status === "ACTIVE") return;
    await projection.setDocumentStatus(document.teamDocumentId, "ACTIVE");
    document.status = "ACTIVE";
    restoredCount += 1;
  }

  async function archive(document: PublicationDocument): Promise<void> {
    if (document.status === "ARCHIVED") return;
    await projection.setDocumentStatus(document.teamDocumentId, "ARCHIVED");
    document.status = "ARCHIVED";
    archivedThisRun.add(document.teamDocumentId);
  }

  /**
   * The incoming original lands on the creator's own archived copy: the old copy
   * is archived (its path stays reserved), the archived copy is repointed,
   * restored and keeps its discussion threads. The whole reattach is one
   * savepoint, so a claim conflict leaves every row as it was.
   */
  async function reattach(
    holder: PublicationDocument,
    original: EligibleOriginal,
    current: PublicationDocument | undefined,
  ): Promise<boolean> {
    const claim = await findClaimName(original.documentId);
    if (claim !== null) {
      pushClaimNotice(original.documentId, claim);
      return false;
    }
    const checkpoint = projection.checkpointTreeView();
    const attempt = await repositories.publications.runClaimAttempt(async () => {
      if (current && current.teamDocumentId !== holder.teamDocumentId) {
        if (current.status === "ACTIVE") {
          await projection.setDocumentStatus(current.teamDocumentId, "ARCHIVED");
        }
        await repositories.publications.unbind(publication.id, contribution.id, original.documentId);
      }
      await repositories.publications.repoint(holder.teamDocumentId, original.documentId);
      if (holder.status === "ARCHIVED") {
        await projection.setDocumentStatus(holder.teamDocumentId, "ACTIVE");
      }
    });
    if (!attempt.ok) {
      // The savepoint rolled the database back; drop the statuses this attempt
      // changed in the tx-local view too.
      projection.restoreTreeView(checkpoint);
      const winner = await findClaimName(original.documentId);
      if (winner !== null) {
        pushClaimNotice(original.documentId, winner);
        return false;
      }
      throw attempt.error;
    }

    if (current && current.teamDocumentId !== holder.teamDocumentId && current.status === "ACTIVE") {
      current.status = "ARCHIVED";
      archivedThisRun.add(current.teamDocumentId);
    }
    // repoint replaced both the holder's previous creator binding and the
    // incoming original's old binding.
    bindings = bindings.filter((binding) => !(
      binding.contributionId === contribution.id
      && (binding.originalDocumentId === original.documentId
        || binding.teamDocumentId === holder.teamDocumentId)
    ));
    bindings.push({
      contributionId: contribution.id,
      originalDocumentId: original.documentId,
      teamDocumentId: holder.teamDocumentId,
    });
    holder.currentOriginalDocumentId = original.documentId;
    if (holder.status === "ARCHIVED") {
      holder.status = "ACTIVE";
      restoredCount += 1;
    }
    return true;
  }

  // 1. Lifecycle first: a copy whose original is no longer eligible (deleted,
  // archived, moved out, source archived) is archived before matching, so a
  // same-sync delete+add can reattach it in this same run.
  for (const document of documents) {
    if (isOwn(document) && document.status === "ACTIVE" && !eligibleIds.has(document.currentOriginalDocumentId)) {
      await archive(document);
    }
  }

  // 2. Decide already-mapped originals. Their copies may be restored or moved
  // onto the creator's own archived holder before any move is planned.
  const mapped: { original: EligibleOriginal; teamDocumentId: string }[] = [];
  const toMatch: EligibleOriginal[] = [];
  for (const original of originals) {
    const binding = bindingOf(original.documentId);
    const bound = binding === undefined ? undefined : documentOf(binding.teamDocumentId);
    if (bound && !isOwn(bound)) {
      // Mapped to another creator's copy: only report it, never create or
      // overwrite. The remembered binding is what keeps the message stable.
      report.notices.push(notice(
        publication.id, original.documentId, "MAINTAINED_BY_OTHER", { maintainerUserId: maintainerOf(bound) }));
      continue;
    }

    let target = bound;
    if (binding && !bound) {
      // Defensive: the binding points at no team copy of this publication.
      await repositories.publications.unbind(publication.id, contribution.id, original.documentId);
      bindings = bindings.filter((candidate) => candidate.originalDocumentId !== original.documentId);
    } else if (target && target.currentOriginalDocumentId !== original.documentId) {
      // Defensive: a stale binding never lets one original feed two copies.
      await repositories.publications.unbind(publication.id, contribution.id, original.documentId);
      bindings = bindings.filter((candidate) => candidate.originalDocumentId !== original.documentId);
      target = undefined;
    }
    if (!target) target = activeOwnFedBy(original.documentId);
    if (!target) {
      toMatch.push(original);
      continue;
    }

    const holder = holderOfPath(original.teamPath);
    if (
      holder
      && holder.teamDocumentId !== target.teamDocumentId
      && isOwn(holder)
      && holder.status === "ARCHIVED"
    ) {
      if (!(await reattach(holder, original, target))) continue;
      target = holder;
    } else {
      await restore(target);
    }
    if (!(await rememberBinding(original.documentId, target.teamDocumentId))) continue;
    mapped.push({ original, teamDocumentId: target.teamDocumentId });
  }

  // 3. Resolve the creator's moves against the simultaneous final state, so
  // swaps and rotations apply; a conflict keeps the old path and is reported.
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
  if (applied.length > 0) await repositories.publications.applyPaths(publication.id, applied);
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

  // 4. Match originals without a copy against the final path state. A path
  // vacated by an applied move is free, so a same-sync move plus add works.
  const toCreate: EligibleOriginal[] = [];
  for (const original of toMatch) {
    const holder = original.teamPath === null
      ? undefined
      : documents.find((document) => document.sourcePath === original.teamPath);
    if (!holder) {
      toCreate.push(original);
      continue;
    }
    if (!isOwn(holder)) {
      if (!(await rememberBinding(original.documentId, holder.teamDocumentId))) continue;
      report.notices.push(notice(
        publication.id, original.documentId, "MAINTAINED_BY_OTHER", { maintainerUserId: maintainerOf(holder) }));
      continue;
    }
    if (holder.status === "ARCHIVED") {
      if (!(await reattach(holder, original, undefined))) continue;
      mapped.push({ original, teamDocumentId: holder.teamDocumentId });
      continue;
    }
    // The creator's own active copy holds this path in the final state.
    report.notices.push(notice(publication.id, original.documentId, "PATH_RESERVED"));
  }

  // 5. Any own active copy not kept by a mapping is stale.
  const kept = new Set(mapped.map((entry) => entry.teamDocumentId));
  for (const document of documents) {
    if (isOwn(document) && document.status === "ACTIVE" && !kept.has(document.teamDocumentId)) {
      await archive(document);
    }
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
    const claim = await findClaimName(original.documentId);
    if (claim !== null) {
      pushClaimNotice(original.documentId, claim);
      continue;
    }
    const parentId = await ensureFolders(placementNames(original, original.teamPath));
    const checkpoint = projection.checkpointTreeView();
    const attempt = await repositories.publications.runClaimAttempt(() => projection.copy({
      originalDocumentId: original.documentId,
      parentId,
      nodeName: original.revision.title,
      sourcePath: original.teamPath,
    }));
    if (!attempt.ok) {
      // The savepoint dropped the document and tree node rows; remove the same
      // node from the tx-local view before a later copy or prune reads it.
      projection.restoreTreeView(checkpoint);
      const winner = await findClaimName(original.documentId);
      if (winner !== null) {
        pushClaimNotice(original.documentId, winner);
        continue;
      }
      throw attempt.error;
    }
    // `copy` inserts the binding in the same transaction.
    report.created += 1;
  }

  await projection.pruneEmptyFolders();
  report.moved = movedDocumentIds.size;
  // A copy archived and reattached in this one transaction never reaches the
  // team as archived, so it is not counted as an archive.
  report.archived = [...archivedThisRun]
    .filter((teamDocumentId) => documentOf(teamDocumentId)?.status === "ARCHIVED")
    .length;
  report.restored = restoredCount;
  return report;
}
