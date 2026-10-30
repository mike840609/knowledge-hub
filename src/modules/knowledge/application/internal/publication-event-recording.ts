import type { Workspace } from "@/modules/workspaces/domain/workspace";
import type { PublicationEventInput } from "../../ports/publication-event-repository";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";

/**
 * Team-space publishing spec, "When the team updates": a change to a *personal*
 * original is recorded as an append-only event in the same transaction as the
 * change itself, so an event and its revision/move/lifecycle commit or roll
 * back together. Sources consume the events and update their team documents;
 * Knowledge never imports Sources and never reads them back.
 *
 * A write in a Team workspace is a team write — including every write of the
 * publication projection, whose source lives in the team — and records nothing
 * here. That is the whole rule; there is no per-caller or per-operation switch.
 *
 * Duplicates are acceptable (consumption reconciles the original's current
 * state, so a repeated event cannot regress a team document); a missing event
 * is not, because nothing else tells the team that an original changed.
 */

type WorkspaceKind = Pick<Workspace, "workspaceType">;

export function isPersonalWorkspace(workspace: WorkspaceKind | null | undefined): boolean {
  return workspace?.workspaceType === "PERSONAL";
}

/** The read a source-side writer makes after locking its Source, on the same connection. */
export async function workspaceOfSource(
  repositories: KnowledgeRepositories,
  workspaceId: string,
): Promise<Workspace | null> {
  return repositories.workspaces.findById(workspaceId);
}

export async function recordPersonalPublicationEvent(
  repositories: KnowledgeRepositories,
  workspace: WorkspaceKind | null | undefined,
  event: PublicationEventInput,
): Promise<void> {
  if (!isPersonalWorkspace(workspace)) return;
  await repositories.publicationEvents.record(event);
}

export async function recordManyPersonalPublicationEvents(
  repositories: KnowledgeRepositories,
  workspace: WorkspaceKind | null | undefined,
  events: readonly PublicationEventInput[],
): Promise<void> {
  if (!isPersonalWorkspace(workspace) || events.length === 0) return;
  await repositories.publicationEvents.recordMany(events);
}
