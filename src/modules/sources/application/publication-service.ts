import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  DocumentNotFoundError,
  DomainError,
  NotFoundError,
  SourceArchivedError,
  TreeNodeNotFoundError,
  ValidationError,
} from "@/modules/knowledge/domain/errors";
import type { KnowledgeTreeNode } from "@/modules/knowledge/domain/tree-node";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import { WorkspaceAccessDeniedError, WorkspaceNotFoundError } from "@/modules/workspaces/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import {
  normalizePublicationName,
  publicationOverlap,
  relativePublicationPath,
  type Contribution,
  type Publication,
  type PublicationKind,
  type PublishOrigin,
  type ReconcileReport,
} from "../domain/publication";
import { publicationError } from "../domain/publication-errors";
import type { SourceRepositories, SourceUnitOfWork } from "../ports/unit-of-work";
import { reconcileContribution } from "./publication-reconciler";

export type PublishPreview = {
  nameTaken: boolean;
  refusedOriginals: { documentId: string; publicationName: string }[];
  joinSuggestion: { publicationId: string; name: string; overlap: number } | null;
  lowOverlapWarning: boolean;
};

/** The plan's user-facing wording for a duplicate active publication name. */
const PUBLICATION_NAME_TAKEN_MESSAGE = "已有同名發佈，請取一個能說明內容的名字";

/** A claim lookup that must not exclude any publication yet to exist. */
const NO_PUBLICATION_ID = "00000000-0000-7000-8000-000000000000";

type OriginOriginal = {
  documentId: string;
  /** Publication-relative Folder Sync path; `null` for Hub-written and document origins. */
  path: string | null;
};

/**
 * The team side of publishing: publish, join, leave and resume.
 *
 * Every command opens exactly one transaction and re-checks ownership,
 * capabilities, names and claims under it; a preview is a read and never
 * authorizes a write. The reconciliation itself lives in
 * `reconcileContribution`, so publish and join share one update rule.
 */
export class PublicationService {
  constructor(private readonly uow: SourceUnitOfWork) {}

  async preview(
    caller: CallerContext,
    input: { teamWorkspaceId: string; name: string; origin: PublishOrigin },
  ): Promise<PublishPreview> {
    const name = normalizePublicationName(input.name);
    return this.uow.run(async (repositories) => {
      await requireActiveTeamWithSourceManage(repositories, caller, input.teamWorkspaceId);
      const originals = await resolveOrigin(repositories, caller, input.origin);

      const publications = await repositories.publications.listByTeam(input.teamWorkspaceId);
      const nameTaken = publications.some((publication) => publication.name === name);

      const refusedOriginals: PublishPreview["refusedOriginals"] = [];
      for (const original of originals) {
        const claim = await repositories.publications.findClaim(
          original.documentId, input.teamWorkspaceId, NO_PUBLICATION_ID);
        if (claim) {
          refusedOriginals.push({
            documentId: original.documentId,
            publicationName: claim.publicationName,
          });
        }
      }

      const originPaths = originals.flatMap((original) => (original.path === null ? [] : [original.path]));
      // An origin with no synced paths still has overlap 0 against every folder
      // candidate, which is exactly what join enforces, so preview must report
      // the same warning instead of hiding the candidate.
      let best: PublishPreview["joinSuggestion"] = null;
      for (const publication of publications) {
        if (publication.kind !== "FOLDER") continue;
        const overlap = publicationOverlap(originPaths, await activeSyncedPaths(repositories, publication.id));
        if (best === null || overlap > best.overlap) {
          best = { publicationId: publication.id, name: publication.name, overlap };
        }
      }

      return {
        nameTaken,
        refusedOriginals,
        joinSuggestion: best !== null && best.overlap >= 0.5 ? best : null,
        lowOverlapWarning: best !== null && best.overlap < 0.5,
      };
    });
  }

  async publish(
    caller: CallerContext,
    input: { teamWorkspaceId: string; name: string; origin: PublishOrigin },
  ): Promise<{ publicationId: string; report: ReconcileReport }> {
    const name = normalizePublicationName(input.name);
    try {
      return await this.uow.run(async (repositories) => {
        await requireActiveTeamWithSourceManage(repositories, caller, input.teamWorkspaceId);
        const originals = await resolveOrigin(repositories, caller, input.origin);

        const publicationId = uuidv7();
        const claims = await claimsByName(repositories, originals, input.teamWorkspaceId, publicationId);
        if (originals.length > 0 && claims.size === originals.length) {
          throw originalTaken(originals[0].documentId, claims.get(originals[0].documentId));
        }

        // Names are unique among a team's active publications. This read makes
        // the common case a named error; the generated-column unique key decides
        // a race and is mapped by the catch below.
        if (await activeNameTaken(repositories, input.teamWorkspaceId, name)) {
          throw nameTaken();
        }

        const now = new Date();
        const sourceId = uuidv7();
        const kind: PublicationKind = input.origin.kind;
        await repositories.sources.insert({
          id: sourceId,
          name,
          workspaceId: input.teamWorkspaceId,
          sourceType: "PUBLICATION",
          ownership: "SOURCE_MANAGED",
          status: "ACTIVE",
          syncVersion: 0,
          createdBy: caller.identity.id,
          updatedBy: caller.identity.id,
          archivedBy: null,
          archivedAt: null,
          createdAt: now,
          updatedAt: now,
        });

        const publication: Publication = {
          id: publicationId,
          sourceId,
          teamWorkspaceId: input.teamWorkspaceId,
          name,
          kind,
          creatorUserId: caller.identity.id,
          status: "ACTIVE",
        };
        await repositories.publications.insert(publication);

        const contribution: Contribution = {
          id: uuidv7(),
          publicationId,
          userId: caller.identity.id,
          origin: input.origin,
          leftAt: null,
          rightsFrozenAt: null,
          pendingCatchUp: false,
        };
        await repositories.publications.insertContribution(contribution);

        const reconciled = await reconcileContribution(repositories, {
          publicationId,
          contributionId: contribution.id,
          judge: { kind: "CALLER", caller },
          now: new Date(),
        });
        if (reconciled.state === "FROZEN") {
          throw new WorkspaceAccessDeniedError(
            "Publishing requires source.manage in the team's active workspace.");
        }
        if (reconciled.state === "SKIPPED") {
          throw new SourceArchivedError("This publication is archived.");
        }
        // A claim race can consume every original after the read above. Refuse
        // the empty publication instead of committing one with no documents.
        if (allOriginalsRefused(reconciled.report, originals)) {
          const refused = reconciled.report.notices.find(
            (notice) => notice.code === "ORIGINAL_ALREADY_PUBLISHED");
          throw originalTaken(refused?.originalDocumentId ?? originals[0].documentId,
            refused?.existingPublicationName);
        }

        return { publicationId, report: reconciled.report };
      });
    } catch (error) {
      if (isIntegrityViolation(error)) {
        // The insert lost a race on the active-name unique key. Re-read outside
        // the rolled-back transaction and report the named outcome; never add a
        // suffix on the publisher's behalf.
        const taken = await this.uow.run((repositories) =>
          activeNameTaken(repositories, input.teamWorkspaceId, name));
        if (taken) throw nameTaken();
      }
      throw error;
    }
  }

  async join(
    caller: CallerContext,
    input: { publicationId: string; folderNodeId: string; acknowledgeLowOverlap?: boolean },
  ): Promise<{ contributionId: string; report: ReconcileReport }> {
    try {
      return await this.uow.run(async (repositories) => {
        const routed = await repositories.publications.findById(input.publicationId);
        if (!routed) throw new NotFoundError("Publication was not found.");
        if (routed.kind !== "FOLDER") {
          throw new ValidationError("Only folder publications can be joined.");
        }

        const source = await repositories.sources.lockById(routed.sourceId);
        if (!source || source.sourceType !== "PUBLICATION") {
          throw new NotFoundError("Publication source was not found.");
        }
        const publication = await repositories.publications.findBySourceId(source.id);
        if (
          !publication
          || publication.id !== input.publicationId
          || publication.status !== "ACTIVE"
          || source.status !== "ACTIVE"
        ) {
          throw new SourceArchivedError("This publication is archived.");
        }

        await requireActiveTeamWithSourceManage(repositories, caller, publication.teamWorkspaceId);
        const folder = await requireOwnedFolder(repositories, caller, input.folderNodeId);
        const contributions = await repositories.publications.listContributions(publication.id);
        const existing = contributions.find((candidate) => candidate.userId === caller.identity.id);

        if (existing) {
          if (existing.origin.kind !== "FOLDER" || existing.origin.folderNodeId !== folder.id) {
            throw new ValidationError(
              "You already joined this publication from another folder; leave it before joining from a different one.");
          }
          // Re-joining the same origin reuses the contribution and never rebinds
          // it to a different folder.
          const reconciled = await reconcileContribution(repositories, {
            publicationId: publication.id,
            contributionId: existing.id,
            judge: { kind: "CALLER", caller },
            now: new Date(),
          });
          return { contributionId: existing.id, report: reconciled.report };
        }

        const originPaths = (await loadFolderOriginals(repositories, folder))
          .flatMap((original) => (original.path === null ? [] : [original.path]));
        const overlap = publicationOverlap(originPaths, await activeSyncedPaths(repositories, publication.id));
        if (overlap < 0.5 && input.acknowledgeLowOverlap !== true) {
          throw publicationError(
            "PUBLICATION_JOIN_LOW_OVERLAP",
            "This folder overlaps little with the publication; confirm joining it anyway.",
            { overlap },
          );
        }

        const contribution: Contribution = {
          id: uuidv7(),
          publicationId: publication.id,
          userId: caller.identity.id,
          origin: { kind: "FOLDER", folderNodeId: folder.id },
          leftAt: null,
          rightsFrozenAt: null,
          pendingCatchUp: false,
        };
        await repositories.publications.insertContribution(contribution);
        const reconciled = await reconcileContribution(repositories, {
          publicationId: publication.id,
          contributionId: contribution.id,
          judge: { kind: "CALLER", caller },
          now: new Date(),
        });
        return { contributionId: contribution.id, report: reconciled.report };
      });
    } catch (error) {
      if (isIntegrityViolation(error)) {
        // Two concurrent joins can both pass the read above; the unique
        // (publication, user) key decides. Re-read in a fresh transaction (the
        // failed one rolled back) and return the winner's contribution.
        const reused = await reuseRacedJoin(this.uow, caller, input);
        if (reused !== null) return reused;
      }
      throw error;
    }
  }

  /** Marks only the caller's contribution as left; bindings and copies keep their claims. */
  async leave(caller: CallerContext, publicationId: string): Promise<void> {
    await this.uow.run(async (repositories) => {
      const publication = await repositories.publications.findById(publicationId);
      if (!publication) throw new NotFoundError("Publication was not found.");
      await repositories.sources.lockById(publication.sourceId);

      const contributions = await repositories.publications.listContributions(publicationId);
      const contribution = contributions.find((candidate) => candidate.userId === caller.identity.id);
      if (!contribution) {
        throw new NotFoundError("You are not a contributor to this publication.");
      }
      if (contribution.leftAt !== null) return;
      await repositories.publications.setContributionState(contribution.id, {
        leftAt: new Date(),
        rightsFrozenAt: contribution.rightsFrozenAt,
        pendingCatchUp: contribution.pendingCatchUp,
      });
    });
  }

  /** Clears only the caller's voluntary leave, then fully reconciles under their rights. */
  async resume(caller: CallerContext, publicationId: string): Promise<ReconcileReport> {
    return this.uow.run(async (repositories) => {
      const routed = await repositories.publications.findById(publicationId);
      if (!routed) throw new NotFoundError("Publication was not found.");
      await repositories.sources.lockById(routed.sourceId);
      const publication = await repositories.publications.findBySourceId(routed.sourceId);
      if (!publication || publication.id !== publicationId) {
        throw new NotFoundError("Publication was not found.");
      }

      const contributions = await repositories.publications.listContributions(publication.id);
      const contribution = contributions.find((candidate) => candidate.userId === caller.identity.id);
      if (!contribution) {
        throw new NotFoundError("You are not a contributor to this publication.");
      }

      if (contribution.leftAt !== null) {
        await repositories.publications.setContributionState(contribution.id, {
          leftAt: null,
          rightsFrozenAt: contribution.rightsFrozenAt,
          pendingCatchUp: contribution.pendingCatchUp,
        });
        contribution.leftAt = null;
      }

      const reconciled = await reconcileContribution(repositories, {
        publicationId: publication.id,
        contributionId: contribution.id,
        judge: { kind: "CALLER", caller },
        now: new Date(),
      });
      // A rights failure is returned as the reconciler decided it (frozen,
      // empty report); resume never fabricates a successful pass.
      return reconciled.report;
    });
  }

  /**
   * Archives the whole publication source (joiners included), freeing its name
   * and every original claim. Documents, threads, path reservations and
   * bindings stay; only the source lifecycle gates their visibility, and the
   * reconciler refuses to revive an archived publication.
   */
  async unpublish(caller: CallerContext, publicationId: string): Promise<void> {
    await this.uow.run(async (repositories) => {
      const publication = await this.lockPublication(repositories, publicationId);
      const contributions = await repositories.publications.listContributions(publication.id);
      await requirePublicationLifecycleRights(repositories, caller, publication, contributions);
      if (publication.status === "ARCHIVED") return;
      await repositories.publications.setPublicationStatus(
        publication.id, "ARCHIVED", caller.identity.id);
    });
  }

  /**
   * Re-claims the publication name and every original, then reconciles each
   * non-left contributor under the caller-less rule: a direct grant applies,
   * everything else waits for that contributor's own request. A conflict rolls
   * back the whole restore instead of leaving a half-active publication.
   */
  async restore(caller: CallerContext, publicationId: string): Promise<void> {
    await this.uow.run(async (repositories) => {
      const publication = await this.lockPublication(repositories, publicationId);
      const contributions = await repositories.publications.listContributions(publication.id);
      await requirePublicationLifecycleRights(repositories, caller, publication, contributions);
      if (publication.status === "ACTIVE") return;

      // Name first: it is the cheapest conflict and names the outcome the
      // person sees. The generated unique key still decides a race.
      if (await activeNameTaken(repositories, publication.teamWorkspaceId, publication.name)) {
        throw nameTaken();
      }
      for (const contribution of contributions) {
        for (const binding of await repositories.publications.listBindings(contribution.id)) {
          const claim = await repositories.publications.findClaim(
            binding.originalDocumentId, publication.teamWorkspaceId, publication.id);
          if (claim) throw originalTaken(binding.originalDocumentId, claim.publicationName);
        }
      }

      try {
        await repositories.publications.setPublicationStatus(
          publication.id, "ACTIVE", caller.identity.id);
      } catch (error) {
        // The generated active-name key lost a race the read above could not
        // see; the repository already names an original-claim race.
        if (isIntegrityViolation(error)) throw nameTaken();
        throw error;
      }

      // The restorer cannot judge anyone else's group-derived rights, so every
      // contribution is reconciled with NO_CALLER: direct grants apply,
      // group-only/removed contributors become pending, and an existing rights
      // freeze is never cleared.
      for (const contribution of contributions) {
        if (contribution.leftAt !== null) continue;
        await reconcileContribution(repositories, {
          publicationId: publication.id,
          contributionId: contribution.id,
          judge: { kind: "NO_CALLER" },
          now: new Date(),
        });
      }
    });
  }

  /**
   * Renames only the publication source's canonical name (no revision). The
   * generic source rename refuses publication sources, so this is the one
   * entry point with its creator/admin rules and active-name uniqueness.
   */
  async rename(caller: CallerContext, publicationId: string, name: string): Promise<void> {
    const next = normalizePublicationName(name);
    await this.uow.run(async (repositories) => {
      const publication = await this.lockPublication(repositories, publicationId);
      const contributions = await repositories.publications.listContributions(publication.id);
      await requirePublicationLifecycleRights(repositories, caller, publication, contributions);
      if (publication.name === next) return;
      if (
        publication.status === "ACTIVE"
        && await activeNameTaken(repositories, publication.teamWorkspaceId, next)
      ) {
        throw nameTaken();
      }
      try {
        await repositories.sources.updateName(publication.sourceId, next, caller.identity.id);
      } catch (error) {
        // Another active publication took the name between the read and the
        // write; the generated key is the final judge.
        if (isIntegrityViolation(error)) throw nameTaken();
        throw error;
      }
    });
  }

  /**
   * Reads a publication under its source lock and returns the current row. A
   * lifecycle command must never act on the pre-lock routing read.
   */
  private async lockPublication(
    repositories: SourceRepositories,
    publicationId: string,
  ): Promise<Publication> {
    const routed = await repositories.publications.findById(publicationId);
    if (!routed) throw new NotFoundError("Publication was not found.");
    const source = await repositories.sources.lockById(routed.sourceId);
    if (!source || source.sourceType !== "PUBLICATION") {
      throw new NotFoundError("Publication source was not found.");
    }
    const publication = await repositories.publications.findBySourceId(source.id);
    if (!publication || publication.id !== publicationId) {
      throw new NotFoundError("Publication was not found.");
    }
    return publication;
  }
}

/**
 * A concurrent duplicate join lost the unique (publication, user) key. The
 * failed transaction is gone; re-read in a fresh one and reuse the winner's
 * contribution when it is the same origin, reconciling it as a normal repeat
 * join would. Anything else keeps the original failure.
 */
async function reuseRacedJoin(
  uow: SourceUnitOfWork,
  caller: CallerContext,
  input: { publicationId: string; folderNodeId: string; acknowledgeLowOverlap?: boolean },
): Promise<{ contributionId: string; report: ReconcileReport } | null> {
  return uow.run(async (repositories) => {
    const publication = await repositories.publications.findById(input.publicationId);
    if (!publication || publication.kind !== "FOLDER" || publication.status !== "ACTIVE") return null;
    await requireActiveTeamWithSourceManage(repositories, caller, publication.teamWorkspaceId);
    const folder = await requireOwnedFolder(repositories, caller, input.folderNodeId);

    const contributions = await repositories.publications.listContributions(publication.id);
    const existing = contributions.find((candidate) => candidate.userId === caller.identity.id);
    if (!existing) return null;
    if (existing.origin.kind !== "FOLDER" || existing.origin.folderNodeId !== folder.id) {
      throw new ValidationError(
        "You already joined this publication from another folder; leave it before joining from a different one.");
    }

    const reconciled = await reconcileContribution(repositories, {
      publicationId: publication.id,
      contributionId: existing.id,
      judge: { kind: "CALLER", caller },
      now: new Date(),
    });
    return { contributionId: existing.id, report: reconciled.report };
  });
}

async function requireActiveTeamWithSourceManage(
  repositories: SourceRepositories,
  caller: CallerContext,
  teamWorkspaceId: string,
): Promise<void> {
  const workspace = await repositories.workspaces.findById(teamWorkspaceId);
  if (!workspace || workspace.workspaceType !== "TEAM") throw new WorkspaceNotFoundError();
  if (workspace.lifecycleState !== "ACTIVE") {
    throw new WorkspaceAccessDeniedError("Publishing requires an active team workspace.");
  }
  const capabilities = await evaluateWorkspaceCapabilities(repositories, caller, teamWorkspaceId);
  if (!capabilities.has("source.manage")) {
    throw new WorkspaceAccessDeniedError("Publishing to a team requires source.manage.");
  }
}

async function requirePublicationLifecycleRights(
  repositories: SourceRepositories,
  caller: CallerContext,
  publication: Publication,
  contributions: readonly Contribution[],
): Promise<void> {
  const workspace = await repositories.workspaces.findById(publication.teamWorkspaceId);
  if (!workspace || workspace.workspaceType !== "TEAM") throw new WorkspaceNotFoundError();
  const capabilities = await evaluateWorkspaceCapabilities(
    repositories, caller, publication.teamWorkspaceId);
  // Admin rights are effective rights: OWNER/ADMIN directly or through a
  // validated group. They survive the creator leaving.
  if (capabilities.has("membership.manage_basic")) return;

  const own = contributions.find((contribution) => contribution.userId === caller.identity.id);
  const isCreator = caller.identity.id === publication.creatorUserId
    && own !== undefined
    && own.leftAt === null;
  if (
    workspace.lifecycleState !== "ACTIVE"
    || !capabilities.has("source.manage")
    || !isCreator
  ) {
    throw new WorkspaceAccessDeniedError(
      "Unpublishing, restoring or renaming this publication requires its creator or a team admin.");
  }
}

async function requireOwnedPersonalSource(
  repositories: SourceRepositories,
  sourceId: string,
  userId: string,
  notFound: () => Error,
): Promise<void> {
  const source = await repositories.sources.findById(sourceId);
  if (!source || source.status !== "ACTIVE") throw notFound();
  const workspace = await repositories.workspaces.findById(source.workspaceId);
  if (
    !workspace
    || workspace.workspaceType !== "PERSONAL"
    || workspace.personalOwnerUserId !== userId
    || workspace.lifecycleState !== "ACTIVE"
  ) {
    throw notFound();
  }
}

async function requireOwnedFolder(
  repositories: SourceRepositories,
  caller: CallerContext,
  folderNodeId: string,
): Promise<KnowledgeTreeNode> {
  const folder = await repositories.tree.findById(folderNodeId);
  if (!folder || folder.nodeType !== "FOLDER" || folder.status !== "ACTIVE") {
    throw new TreeNodeNotFoundError("Folder was not found in your personal workspace.");
  }
  await requireOwnedPersonalSource(
    repositories,
    folder.sourceId,
    caller.identity.id,
    () => new TreeNodeNotFoundError("Folder was not found in your personal workspace."),
  );
  return folder;
}

async function requireOwnedDocument(
  repositories: SourceRepositories,
  caller: CallerContext,
  documentId: string,
): Promise<void> {
  const document = await repositories.documents.findById(documentId);
  if (!document || document.status !== "ACTIVE" || document.currentRevisionId === null) {
    throw new DocumentNotFoundError("Document was not found in your personal workspace.");
  }
  await requireOwnedPersonalSource(
    repositories,
    document.sourceId,
    caller.identity.id,
    () => new DocumentNotFoundError("Document was not found in your personal workspace."),
  );
  const node = await repositories.tree.findByDocumentId(document.id);
  if (!node || node.status !== "ACTIVE") {
    throw new DocumentNotFoundError("Document was not found in your personal workspace.");
  }
  const chain = await repositories.tree.listChain(node.id);
  if (chain.length === 0 || chain.some((entry) => entry.status !== "ACTIVE")) {
    throw new DocumentNotFoundError("Document was not found in your personal workspace.");
  }
}

async function resolveOrigin(
  repositories: SourceRepositories,
  caller: CallerContext,
  origin: PublishOrigin,
): Promise<OriginOriginal[]> {
  if (origin.kind === "DOCUMENT") {
    await requireOwnedDocument(repositories, caller, origin.documentId);
    return [{ documentId: origin.documentId, path: null }];
  }
  const folder = await requireOwnedFolder(repositories, caller, origin.folderNodeId);
  return loadFolderOriginals(repositories, folder);
}

/**
 * Eligible synced originals of a folder, with their publication-relative path.
 * Mirrors the reconciler's eligibility: ACTIVE folder descendants whose source
 * is the caller's personal workspace; Hub-written originals keep a `null` path.
 */
async function loadFolderOriginals(
  repositories: SourceRepositories,
  folder: KnowledgeTreeNode,
): Promise<OriginOriginal[]> {
  const nodes = await repositories.tree.listSubtree(folder.sourceId, folder.id);
  const documentNodes = nodes.filter((node) =>
    node.nodeType === "DOCUMENT"
    && node.documentId !== null
    && node.status === "ACTIVE"
    && node.documentStatus === "ACTIVE"
    && node.currentRevisionId !== null);
  if (documentNodes.length === 0) return [];

  const documentIds = documentNodes.map((node) => node.documentId as string);
  const entries = await repositories.entries.findByDocumentIds(documentIds);
  const entryByDocument = new Map(
    entries
      .filter((entry) => entry.documentId !== null)
      .map((entry) => [entry.documentId as string, entry]),
  );
  const rootEntry = await repositories.entries.findByTreeNodeId(folder.id);
  const rootPath = rootEntry?.sourcePath ?? null;

  return documentNodes
    .map((node) => {
      const documentId = node.documentId as string;
      const entry = entryByDocument.get(documentId) ?? null;
      const path = rootPath === null
        ? null
        : relativePublicationPath(entry?.sourcePath ?? null, rootPath);
      return { documentId, path };
    })
    .sort((left, right) => left.documentId.localeCompare(right.documentId));
}

async function activeSyncedPaths(
  repositories: SourceRepositories,
  publicationId: string,
): Promise<string[]> {
  const documents = await repositories.publications.listDocuments(publicationId);
  return documents
    .filter((document) => document.status === "ACTIVE" && document.sourcePath !== null)
    .map((document) => document.sourcePath as string);
}

async function claimsByName(
  repositories: SourceRepositories,
  originals: readonly OriginOriginal[],
  teamWorkspaceId: string,
  excludePublicationId: string,
): Promise<Map<string, string>> {
  const claims = new Map<string, string>();
  for (const original of originals) {
    const claim = await repositories.publications.findClaim(
      original.documentId, teamWorkspaceId, excludePublicationId);
    if (claim) claims.set(original.documentId, claim.publicationName);
  }
  return claims;
}

async function activeNameTaken(
  repositories: SourceRepositories,
  teamWorkspaceId: string,
  name: string,
): Promise<boolean> {
  const publications = await repositories.publications.listByTeam(teamWorkspaceId);
  return publications.some((publication) => publication.name === name);
}

function allOriginalsRefused(
  report: ReconcileReport,
  originals: readonly OriginOriginal[],
): boolean {
  if (originals.length === 0 || report.created !== 0) return false;
  const refused = new Set(
    report.notices.flatMap((notice) =>
      notice.code === "ORIGINAL_ALREADY_PUBLISHED" && notice.originalDocumentId !== undefined
        ? [notice.originalDocumentId]
        : []),
  );
  return originals.every((original) => refused.has(original.documentId));
}

function nameTaken(): Error {
  return publicationError("PUBLICATION_NAME_TAKEN", PUBLICATION_NAME_TAKEN_MESSAGE);
}

function originalTaken(documentId: string, publicationName?: string): Error {
  const message = publicationName === undefined
    ? "This original is already published in this team."
    : `This original is already published in "${publicationName}" in this team.`;
  return publicationError("PUBLICATION_ORIGINAL_TAKEN", message, {
    originalDocumentId: documentId,
    ...(publicationName === undefined ? {} : { publicationName }),
  });
}

function isIntegrityViolation(error: unknown): boolean {
  return error instanceof DomainError && error.code === "INTEGRITY_VIOLATION";
}
