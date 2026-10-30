import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { evaluateWorkspaceCapabilities } from "@/modules/workspaces/application/workspace-authorization";
import type {
  CanonicalDocumentLocation,
  FolderImportPlan,
} from "../domain/import-plan";
import type { ImportSnapshot } from "../domain/import-snapshot";
import {
  relativePublicationPath,
  type Contribution,
  type PublicationNotice,
} from "../domain/publication";
import type { SourceRepositories } from "../ports/unit-of-work";

/**
 * One original as it will look after the import plan is applied. A newly added
 * document has no id yet, so only its final source path is known.
 */
export type ProposedOriginal = {
  documentId?: string;
  sourcePath: string | null;
  active: boolean;
};

/**
 * The import plan's proposed final originals. The persisted plan names the
 * document ids for moves/restores/archives; plan-created documents contribute
 * their final path so a new file landing on another maintainer's path can still
 * be reported before it exists.
 */
export function proposedOriginalsFromPlan(
  current: { documents: readonly CanonicalDocumentLocation[] },
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

  const originals = [...byDocumentId.values()];
  const finalPaths = new Set(originals.filter((original) => original.active).map((original) => original.sourcePath));
  for (const create of plan.documents.create) {
    // After Apply the created document is already in `current`; do not report
    // the same final path twice.
    if (finalPaths.has(create.sourcePath)) continue;
    finalPaths.add(create.sourcePath);
    originals.push({ sourcePath: create.sourcePath, active: true });
  }

  return originals.sort((left, right) =>
    (left.documentId ?? left.sourcePath ?? "").localeCompare(right.documentId ?? right.sourcePath ?? ""));
}

function notice(
  publicationId: string,
  code: PublicationNotice["code"],
  extra: {
    originalDocumentId?: string;
    sourcePath?: string;
    maintainerUserId?: string;
  } = {},
): PublicationNotice {
  return {
    publicationId,
    code,
    ...(extra.originalDocumentId === undefined ? {} : { originalDocumentId: extra.originalDocumentId }),
    ...(extra.sourcePath === undefined ? {} : { sourcePath: extra.sourcePath }),
    ...(extra.maintainerUserId === undefined ? {} : { maintainerUserId: extra.maintainerUserId }),
  };
}

type ContributionScope =
  | { kind: "DOCUMENT"; documentId: string }
  | { kind: "FOLDER"; rootPath: string };

/**
 * The one folder/document a contribution publishes. The folder and its root
 * entry are resolved once per contribution, not once per original.
 */
async function contributionScope(
  repositories: SourceRepositories,
  contribution: Contribution,
  sourceId: string,
): Promise<ContributionScope | null> {
  if (contribution.origin.kind === "DOCUMENT") {
    return { kind: "DOCUMENT", documentId: contribution.origin.documentId };
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
  return { kind: "FOLDER", rootPath: rootEntry.sourcePath };
}

/** `null` means the original is outside this contribution. */
function relativePathOf(
  scope: ContributionScope,
  original: ProposedOriginal,
): { relativePath: string | null } | null {
  if (scope.kind === "DOCUMENT") {
    return original.documentId === scope.documentId ? { relativePath: null } : null;
  }
  if (original.sourcePath === null) return null;
  const relativePath = relativePublicationPath(original.sourcePath, scope.rootPath);
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
    const key = `${value.publicationId}:${value.originalDocumentId ?? value.sourcePath ?? ""}:${value.code}`;
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

    const scope = await contributionScope(repositories, contribution, input.sourceId);
    if (!scope) continue;
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
      const membership = relativePathOf(scope, original);
      if (!membership) continue;

      const boundTeamDocumentId = original.documentId === undefined
        ? undefined
        : teamDocumentByOriginal.get(original.documentId);
      const bound = boundTeamDocumentId === undefined
        ? undefined
        : documents.find((document) => document.teamDocumentId === boundTeamDocumentId);

      if (bound && bound.creatorContributionId !== contribution.id) {
        push(notice(publication.id, "MAINTAINED_BY_OTHER", {
          originalDocumentId: original.documentId,
          maintainerUserId: maintainerOf.get(bound.creatorContributionId),
        }));
        continue;
      }

      if (!bound && membership.relativePath !== null) {
        const holder = documents.find((document) => document.sourcePath === membership.relativePath);
        if (holder && holder.creatorContributionId !== contribution.id) {
          push(notice(publication.id, "MAINTAINED_BY_OTHER", {
            originalDocumentId: original.documentId,
            sourcePath: original.sourcePath ?? undefined,
            maintainerUserId: maintainerOf.get(holder.creatorContributionId),
          }));
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
          push(notice(publication.id, "PATH_RESERVED", {
            originalDocumentId: original.documentId,
          }));
        }
      }
    }
  }

  const maintainerIds = [...new Set(notices.flatMap((notice) =>
    notice.maintainerUserId === undefined ? [] : [notice.maintainerUserId]))];
  if (maintainerIds.length > 0) {
    const maintainers = new Map((await repositories.users.findByIds(maintainerIds)).map((user) => [user.id, user.name]));
    for (const notice of notices) {
      if (notice.maintainerUserId !== undefined) {
        notice.maintainerName = maintainers.get(notice.maintainerUserId);
      }
    }
  }

  return notices.sort((left, right) =>
    left.publicationId.localeCompare(right.publicationId)
    || (left.originalDocumentId ?? left.sourcePath ?? "").localeCompare(
      right.originalDocumentId ?? right.sourcePath ?? "",
    )
    || left.code.localeCompare(right.code));
}
/**
 * Notices for a plan plus a state the caller already holds (Apply's `before`
 * snapshot). No canonical document bodies are read here.
 */
export async function publicationNoticesForPlan(
  repositories: SourceRepositories,
  caller: CallerContext,
  input: {
    sourceId: string;
    current: { documents: readonly CanonicalDocumentLocation[] };
    plan: FolderImportPlan;
    includePathReserved?: boolean;
  },
): Promise<PublicationNotice[]> {
  if (input.plan.summary.blockers > 0) return [];
  return collectPublicationNotices(repositories, caller, {
    sourceId: input.sourceId,
    originals: proposedOriginalsFromPlan(input.current, input.plan),
    includePathReserved: input.includePathReserved,
  });
}

/**
 * Notices for a persisted snapshot plan using a light identity/path/lifecycle
 * query. Preview and finalize never load revision bodies for this.
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
  let current: { documents: readonly CanonicalDocumentLocation[] };
  try {
    current = {
      documents: await repositories.importCanonicalState.listDocumentLocations(snapshot.sourceId),
    };
  } catch {
    // A preview whose canonical state cannot be read is already a blocking
    // preview; publication notices must not turn it into a failed request.
    return [];
  }
  return publicationNoticesForPlan(repositories, caller, {
    sourceId: snapshot.sourceId,
    current,
    plan: snapshot.plan,
    includePathReserved: options.includePathReserved,
  });
}
