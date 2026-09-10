import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  HubManagedOperationRequiredError,
  SourceArchivedError,
  SourceNotFoundError,
  SourceReadOnlyError,
  TreeNodeNotFoundError,
} from "../../domain/errors";
import type { KnowledgeTreeNode } from "../../domain/tree-node";
import { assignContiguousPositions, orderSiblingsByPosition } from "../../domain/tree-rules";
import type { KnowledgeRepositories } from "../../ports/unit-of-work";
import type { SourcePolicy } from "../../domain/source-policy";

/**
 * Shared Tree mutation preamble (plan §6): trusted CallerContext → resolve
 * and lock Source on this connection → transaction-scoped Workspace access →
 * Source ACTIVE + HUB_MANAGED. No knowledge writes happen before authorization
 * (caller identity provisioning is not a knowledge write); every
 * hierarchy decision below re-reads the latest locked state, because READ
 * COMMITTED never relies on a pre-lock read for the final mutation.
 */
export async function requireHubManagedSource(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  sourceId: string,
): Promise<SourcePolicy> {
  return requireOwnedSource(repositories, caller, sourceId, "HUB_MANAGED");
}

/**
  * Source projection preamble (spec §15.3, plan §6): same ordering as the Hub
  * path — trusted CallerContext → resolve and lock Source on this connection
  * → transaction-scoped Workspace access → Source ACTIVE + SOURCE_MANAGED.
  * HUB_MANAGED sources are rejected with HUB_MANAGED_OPERATION_REQUIRED; no
  * force/bypass/isSync escape flag exists.
  */
export async function requireSourceManagedSource(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  sourceId: string,
): Promise<SourcePolicy> {
  return requireOwnedSource(repositories, caller, sourceId, "SOURCE_MANAGED");
}

async function requireOwnedSource(
  repositories: KnowledgeRepositories,
  caller: CallerContext,
  sourceId: string,
  ownership: "HUB_MANAGED" | "SOURCE_MANAGED",
): Promise<SourcePolicy> {
  await repositories.users.upsertIdentity(caller.identity);
  const source = await repositories.sourcePolicy.lockById(sourceId);
  if (!source) throw new SourceNotFoundError();
  await repositories.workspaceAccess.requireMembership(caller, source.workspaceId);
  if (source.status !== "ACTIVE") throw new SourceArchivedError();
  if (source.ownership !== ownership) {
    if (ownership === "HUB_MANAGED") throw new SourceReadOnlyError();
    throw new HubManagedOperationRequiredError();
  }
  return source;
}

/**
 * Latest locked Tree row for a node routed to `sourceId`. The pre-lock
 * `findById` in each operation only routes to the owning Source; this locked
 * re-read is the authoritative row for every validation and write.
 */
export async function requireLockedSourceNode(
  repositories: KnowledgeRepositories,
  sourceId: string,
  nodeId: string,
): Promise<KnowledgeTreeNode> {
  const node = await repositories.tree.lockById(nodeId);
  if (!node || node.sourceId !== sourceId) {
    throw new TreeNodeNotFoundError("Tree node was not found in this source.");
  }
  return node;
}

/**
 * Renumber one sibling group contiguously (spec §8: plain
 * `ORDER BY position, id`; no LexoRank or fractional indexing).
 */
export async function renumberSiblingPositions(
  repositories: KnowledgeRepositories,
  sourceId: string,
  parentId: string | null,
  actorId: string,
): Promise<void> {
  const nodes = await repositories.tree.listBySource(sourceId);
  const siblings = orderSiblingsByPosition(nodes.filter((node) => node.parentId === parentId));
  const positions = assignContiguousPositions(siblings);
  for (const sibling of siblings) {
    const position = positions.get(sibling.id)!;
    if (sibling.position !== position) {
      await repositories.tree.updatePosition(sibling.id, position, actorId);
    }
  }
}

/**
 * Deterministic placement: remove the node from its sibling group, insert it
 * at the clamped index of the `ORDER BY position, id` ordered group, then
 * renumber contiguously. Raw position values alone cannot place a node
 * because ties fall back to id order; index insertion makes move/reorder
 * targets unambiguous.
 */
export async function placeNodeAtIndex(
  repositories: KnowledgeRepositories,
  sourceId: string,
  nodeId: string,
  parentId: string | null,
  index: number,
  actorId: string,
): Promise<void> {
  const nodes = await repositories.tree.listBySource(sourceId);
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) throw new TreeNodeNotFoundError("Tree node was not found in this source.");
  const others = orderSiblingsByPosition(nodes.filter((candidate) => candidate.parentId === parentId && candidate.id !== nodeId));
  const at = Math.min(index, others.length);
  const merged = [...others.slice(0, at), node, ...others.slice(at)];
  for (const [position, sibling] of merged.entries()) {
    if (sibling.position !== position) {
      await repositories.tree.updatePosition(sibling.id, position, actorId);
    }
  }
}
