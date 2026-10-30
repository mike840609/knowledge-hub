import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { ValidationError } from "@/modules/knowledge/domain/errors";
import { MAX_FOLDER_NAME_LENGTH } from "@/modules/knowledge/domain/tree-rules";

export type PublicationKind = "FOLDER" | "DOCUMENT";

/**
 * A publication is the team-side container. Its name, workspace and lifecycle
 * are the joined `knowledge_sources` row, not copies: the repository view fills
 * them from that source so scope and lifecycle are never stored twice.
 */
export type Publication = {
  id: string;
  sourceId: string;
  teamWorkspaceId: string;
  name: string;
  kind: PublicationKind;
  creatorUserId: string;
  status: "ACTIVE" | "ARCHIVED";
};

/** Where a contributor's content comes from. Exactly one arm is set. */
export type PublishOrigin =
  | { kind: "FOLDER"; folderNodeId: string }
  | { kind: "DOCUMENT"; documentId: string };

/**
 * Leave, rights freeze and pending catch-up are independent facts. A single
 * enum would let one overwrite another, so they stay three fields.
 */
export type Contribution = {
  id: string;
  publicationId: string;
  userId: string;
  origin: PublishOrigin;
  leftAt: Date | null;
  rightsFrozenAt: Date | null;
  pendingCatchUp: boolean;
};

/**
 * A team document copy. `status` is read from `knowledge_documents`; the
 * publication tables never keep a second lifecycle.
 */
export type PublicationDocument = {
  teamDocumentId: string;
  publicationId: string;
  creatorContributionId: string;
  currentOriginalDocumentId: string;
  sourcePath: string | null;
  status: "ACTIVE" | "ARCHIVED";
};

/** contributor's original document → team document, remembered per contribution. */
export type DocumentBinding = {
  contributionId: string;
  originalDocumentId: string;
  teamDocumentId: string;
};

/**
 * Rights are judged either as the contributor themselves (their validated
 * groups are only available then) or without a caller (worker, restore,
 * catch-up), where only a direct membership row can be read.
 */
export type RightsJudge = { kind: "CALLER"; caller: CallerContext } | { kind: "NO_CALLER" };

export type PublicationNotice = {
  publicationId: string;
  originalDocumentId: string;
  code: "MAINTAINED_BY_OTHER" | "PATH_RESERVED" | "ORIGINAL_ALREADY_PUBLISHED";
  maintainerUserId?: string;
  existingPublicationName?: string;
};

export type ReconcileReport = {
  created: number;
  updated: number;
  moved: number;
  archived: number;
  restored: number;
  notices: PublicationNotice[];
};

export type PlannedMove = {
  teamDocumentId: string;
  fromPath: string | null;
  toPath: string | null;
};

/** A publication name follows the same limit as a folder name; no suffix is added. */
export function normalizePublicationName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_FOLDER_NAME_LENGTH) {
    throw new ValidationError(`Publication name must be between 1 and ${MAX_FOLDER_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

/**
 * The path of a Folder Sync original relative to the published folder.
 *
 * The comparison is on original segments: `docs/a.md` is inside `docs`, but
 * `docs2/a.md` is not. A `null` source path (a Hub-written original) has no
 * relative path and reserves nothing; whether an original is eligible is a
 * tree-ancestry question answered elsewhere, so `null` never doubles as
 * "not eligible".
 */
export function relativePublicationPath(sourcePath: string | null, rootPath: string): string | null {
  if (sourcePath === null) return null;
  const root = rootPath.replace(/\/+$/u, "");
  if (root === "") return sourcePath;
  if (sourcePath === root) return null;
  if (!sourcePath.startsWith(`${root}/`)) return null;
  const relative = sourcePath.slice(root.length + 1);
  return relative === "" ? null : relative;
}

/**
 * Resolve a contributor's simultaneous moves against the final state instead of
 * one at a time, so swaps and rotations (legal cycles) all apply.
 *
 * A move is refused when its final path is still occupied by another document:
 * either a document that does not move, or another move competing for the same
 * path. A refused document stays where it was, so its old path keeps blocking
 * moves that depend on it; the loop runs to a fixpoint. A `null` target (a
 * Hub-written document's path) reserves nothing and always applies. Paths are
 * compared byte-for-byte: case and original segments are preserved.
 */
export function planPublicationMoves(
  moves: readonly PlannedMove[],
  held: ReadonlyMap<string, PublicationDocument>,
): { applied: PlannedMove[]; blocked: PlannedMove[] } {
  if (moves.length === 0) return { applied: [], blocked: [] };

  // A mover's current place is the path it says it moves from; a document that
  // does not move keeps the path the caller read from the publication.
  const currentPath = new Map<string, string | null>();
  for (const [teamDocumentId, document] of held) currentPath.set(teamDocumentId, document.sourcePath);
  for (const move of moves) currentPath.set(move.teamDocumentId, move.fromPath);

  const moveById = new Map<string, PlannedMove>();
  for (const move of moves) moveById.set(move.teamDocumentId, move);

  const documents = [...currentPath.keys()];
  const blockedIds = new Set<string>();

  for (;;) {
    const occupants = new Map<string, string[]>();
    const finalPath = (teamDocumentId: string): string | null => {
      const move = moveById.get(teamDocumentId);
      if (move && !blockedIds.has(teamDocumentId)) return move.toPath;
      return currentPath.get(teamDocumentId) ?? null;
    };
    for (const teamDocumentId of documents) {
      const path = finalPath(teamDocumentId);
      if (path === null) continue;
      const group = occupants.get(path);
      if (group) group.push(teamDocumentId);
      else occupants.set(path, [teamDocumentId]);
    }

    let changed = false;
    for (const move of moves) {
      if (blockedIds.has(move.teamDocumentId) || move.toPath === null) continue;
      const group = occupants.get(move.toPath);
      if (group && group.some((teamDocumentId) => teamDocumentId !== move.teamDocumentId)) {
        blockedIds.add(move.teamDocumentId);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const applied: PlannedMove[] = [];
  const blocked: PlannedMove[] = [];
  for (const move of moves) {
    (blockedIds.has(move.teamDocumentId) ? blocked : applied).push(move);
  }
  return { applied, blocked };
}

/**
 * Share of relative paths the two sides agree on, over their union (Jaccard).
 * Empty either side means "nothing to compare" and therefore 0: a publication
 * of Hub-written documents offers no join suggestion. The join warning uses
 * `< 0.5` and the join suggestion `>= 0.5`.
 */
export function publicationOverlap(originPaths: readonly string[], teamPaths: readonly string[]): number {
  const origin = new Set(originPaths);
  const team = new Set(teamPaths);
  if (origin.size === 0 || team.size === 0) return 0;
  let shared = 0;
  for (const path of origin) if (team.has(path)) shared += 1;
  const union = origin.size + team.size - shared;
  return union === 0 ? 0 : shared / union;
}
