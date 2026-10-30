import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import type { CanonicalImportState, FolderImportPlan } from "../domain/import-plan";
import type { ImportSnapshot } from "../domain/import-snapshot";
import {
  relativePublicationPath,
  type Contribution,
  type PublicationNotice,
} from "../domain/publication";
import type { SourceRepositories } from "../ports/unit-of-work";

/** One existing original as it will look after the import plan is applied. */
export type ProposedOriginal = {
  documentId: string;
  sourcePath: string | null;
  active: boolean;
};

/**
 * The import plan's proposed final originals. The persisted plan names the
 * document ids for moves/restores/archives; new documents have no id yet, so
 * they only appear once the apply has created them. Using this instead of just
 * the current rows is what makes a rename into another maintainer's path show
 * the notice before the sync runs.
 */
export function proposedOriginalsFromPlan(
  current: CanonicalImportState,
  plan: FolderImportPlan,
): ProposedOriginal[] {
  const byDocumentId = new Map<string, ProposedOriginal>();
  const documentIdByEntryId = new Map<string, string>();
  for (const document of current.documents) {
    byDocumentId.set(document.documentId, {
      documentId: document.documentId,
      sourcePath: document.sourcePath,
      active: document.status === "ACTIVE",
    });
    documentIdByEntryId.set(document.entryId, document.documentId);
  }

  for (const move of plan.documents.move) {
    const documentId = documentIdByEntryId.get(move.entryId);
    if (documentId === undefined) continue;
    const original = byDocumentId.get(documentId);
    if (original) original.sourcePath = move.toPath;
  }
  for (const restore of plan.documents.restore) {
    const original = byDocumentId.get(restore.documentId);
    if (original) original.active = true;
  }
  for (const archive of plan.documents.archive) {
    const original = byDocumentId.get(archive.documentId);
    if (original) original.active = false;
  }

  return [...byDocumentId.values()].sort((left, right) =>
    left.documentId.localeCompare(right.documentId));
}

function notice(
  publicationId: string,
  originalDocumentId: string,
  code: PublicationNotice["code"],
  maintainerUserId?: string,
): PublicationNotice {
  return {
    publicationId,
    originalDocumentId,
    code,
    ...(maintainerUserId === undefined ? {} : { maintainerUserId }),
  };
}

type Membership = { relativePath: string | null };

/**
 * Whether one proposed original belongs to a contribution, and its
 * publication-relative path. A folder contribution is a source-path prefix
 * question; a document contribution is exactly its one document.
 */
async function membershipOf(
  repositories: SourceRepositories,
  contribution: Contribution,
  sourceId: string,
  original: ProposedOriginal,
): Promise<Membership | null> {
  if (contribution.origin.kind === "DOCUMENT") {
    return contribution.origin.documentId === original.documentId ? { relativePath: null } : null;
  }
  const folder = await repositories.tree.findById(contribution.origin.folderNodeId);
  if (
    !folder
    || folder.nodeType !== "FOLDER"
    || folder.status !== "ACTIVE"
    || folder.sourceId !== sourceId
  ) {
    return null;
  }
  const rootEntry = await repositories.entries.findByTreeNodeId(folder.id);
  if (!rootEntry) return null;
  const relativePath = relativePublicationPath(original.sourcePath, rootEntry.sourcePath);
  return relativePath === null ? null : { relativePath };
}

/**
 * Publication notices a contributor's sync preview/result should carry.
 *
 * Only the caller's own contributions are considered. A publication whose team
 * the caller can no longer read is skipped entirely, so a lost team never
 * leaks its maintainer through a personal sync response. Publication names are
 * never included here.
 */
export async function collectPublicationNotices(
  repositories: SourceRepositories,
  caller: CallerContext,
  input: {
    sourceId: string;
    originals: readonly ProposedOriginal[];
    /** Apply results also predict a move blocked by a reserved path. */
    includePathReserved?: boolean;
  },
): Promise<PublicationNotice[]> {
  if (input.originals.length === 0) return [];

  const notices: PublicationNotice[] = [];
  const seen = new Set<string>();
  const push = (value: PublicationNotice): void => {
    const key = `${value.publicationId}:${value.originalDocumentId}:${value.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    notices.push(value);
  };

  const contributions = await repositories.publications.listByContributor(caller.identity.id);
  for (const contribution of contributions) {
    if (contribution.leftAt !== null) continue;
    const publication = await repositories.publications.findById(contribution.publicationId);
    if (!publication || publication.status !== "ACTIVE") continue;
    const workspace = await repositories.workspaces.findById(publication.teamWorkspaceId);
    if (
      !workspace
      || workspace.workspaceType !== "TEAM"
      || workspace.lifecycleState !== "ACTIVE"
    ) {
      continue;
    }

    const capabilities = await evaluateWorkspaceCapabilities(
      repositories,
      caller,
      publication.teamWorkspaceId,
    );
    // A contributor who lost access to the team gets no publication details.
    if (!capabilities.has("document.read")) continue;

    const documents = await repositories.publications.listDocuments(publication.id);
    const teamContributions = await repositories.publications.listContributions(publication.id);
    const maintainerOf = new Map(
      teamContributions.map((candidate) => [candidate.id, candidate.userId]),
    );
    const bindings = await repositories.publications.listBindings(contribution.id);
    const teamDocumentByOriginal = new Map(
      bindings.map((binding) => [binding.originalDocumentId, binding.teamDocumentId]),
    );

    for (const original of input.originals) {
      if (!original.active) continue;
      const membership = await membershipOf(
        repositories,
        contribution,
        input.sourceId,
        original,
      );
      if (!membership) continue;

      const boundTeamDocumentId = teamDocumentByOriginal.get(original.documentId);
      const bound = boundTeamDocumentId === undefined
        ? undefined
        : documents.find((document) => document.teamDocumentId === boundTeamDocumentId);

      if (bound && bound.creatorContributionId !== contribution.id) {
        push(notice(
          publication.id,
          original.documentId,
          "MAINTAINED_BY_OTHER",
          maintainerOf.get(bound.creatorContributionId),
        ));
        continue;
      }

      if (!bound && membership.relativePath !== null) {
        const holder = documents.find((document) => document.sourcePath === membership.relativePath);
        if (holder && holder.creatorContributionId !== contribution.id) {
          push(notice(
            publication.id,
            original.documentId,
            "MAINTAINED_BY_OTHER",
            maintainerOf.get(holder.creatorContributionId),
          ));
        }
        continue;
      }

      if (
        input.includePathReserved === true
        && bound
        && bound.creatorContributionId === contribution.id
        && membership.relativePath !== null
        && membership.relativePath !== bound.sourcePath
      ) {
        const holder = documents.find((document) =>
          document.teamDocumentId !== bound.teamDocumentId
          && document.sourcePath === membership.relativePath);
        // The creator's own archived holder is reattached, not blocked.
        const reattachable = holder !== undefined
          && holder.creatorContributionId === contribution.id
          && holder.status === "ARCHIVED";
        if (holder && !reattachable) {
          push(notice(publication.id, original.documentId, "PATH_RESERVED"));
        }
      }
    }
  }

  return notices.sort((left, right) =>
    left.publicationId.localeCompare(right.publicationId)
    || left.originalDocumentId.localeCompare(right.originalDocumentId)
    || left.code.localeCompare(right.code));
}

/**
 * Notices for a persisted snapshot plan. When called after Apply, `current` is
 * the final state, so applying the plan to it again is idempotent and includes
 * documents the plan created.
 */
export async function publicationNoticesForSnapshot(
  repositories: SourceRepositories,
  caller: CallerContext,
  snapshot: Pick<ImportSnapshot, "sourceId" | "plan">,
  options: { includePathReserved?: boolean } = {},
): Promise<PublicationNotice[]> {
  if (
    snapshot.sourceId === null
    || !snapshot.plan
    || snapshot.plan.summary.blockers > 0
  ) {
    return [];
  }
  let current: CanonicalImportState;
  try {
    current = await repositories.importCanonicalState.load(snapshot.sourceId);
  } catch {
    // A preview whose canonical state cannot be read is already a blocking
    // preview; publication notices must not turn it into a failed request.
    return [];
  }
  return collectPublicationNotices(repositories, caller, {
    sourceId: snapshot.sourceId,
    originals: proposedOriginalsFromPlan(current, snapshot.plan),
    includePathReserved: options.includePathReserved,
  });
}
