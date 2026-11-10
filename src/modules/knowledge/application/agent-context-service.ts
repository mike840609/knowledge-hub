import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { DocumentNotFoundError, IntegrityViolationError } from "../domain/errors";
import { DomainError } from "@/shared/domain/errors";
import { AgentContextFormatter, ContextTooLargeError, linkMapFor, validateContextSelection, type AgentContextLink } from "../domain/agent-context";
import { buildWorkspaceGraph, resolveEdges } from "../domain/link-graph";
import { requireVisibleDocument } from "./internal/require-visible-document";
import { assertActiveDocumentPlacement } from "./tree-validation";
import { byCreation, projectAgentDiscussion } from "../domain/agent-context-discussion";
import { createReviewAnchorRelocator } from "../domain/review-anchor";
import { isRetractedThread, type ReviewComment } from "../domain/document-review";
const COMMENT_BATCH_THREADS = 100;
export class AgentContextService {
  constructor(private readonly uow: KnowledgeUnitOfWork) {}
  async build(caller: CallerContext, workspaceId: string, rawIds: unknown, origin = "", options: { includeDiscussions?: boolean } = {}) {
    const includeDiscussions = options.includeDiscussions ?? true;
    const ids = validateContextSelection(rawIds);
    return this.uow.run(async r => {
      await r.workspaceAccess.requireWorkspaceRead(caller, workspaceId);
      const workspace = await r.workspaces.findById(workspaceId);
      if (!workspace || workspace.workspaceType !== "PERSONAL" || workspace.personalOwnerUserId !== caller.identity.id || workspace.lifecycleState !== "ACTIVE") throw new DomainError("WORKSPACE_NOT_FOUND", "Workspace unavailable.");
      const authors = new Map<string, string>();
      const catalog = await r.links.loadCatalog(workspaceId);
      const edges = resolveEdges(catalog, await r.links.loadValidEdges(workspaceId));
      const graph = buildWorkspaceGraph(catalog, edges, { includeUnresolved: true, includeOrphans: true, limit: Number.MAX_SAFE_INTEGER });
      // Only returned once every selected id passes the checks below, so the map discloses nothing a failed build would not.
      const links = linkMapFor(graph, ids, edges);
      const assemble = async (map: readonly AgentContextLink[] | null) => {
        const formatter = new AgentContextFormatter(workspaceId, origin, includeDiscussions);
        if (map) formatter.addLinks(map); else formatter.addLinkMapOmitted();
        for (const id of ids) {
          const { document, policy } = await requireVisibleDocument(r, caller, id, false);
          if (policy.workspaceId !== workspaceId) throw new DocumentNotFoundError();
          const tree = await r.tree.listBySource(document.sourceId);
          if (!tree.some(node => node.documentId === document.id && node.status === "ACTIVE")) throw new DocumentNotFoundError();
          await assertActiveDocumentPlacement(r, document.sourceId, document.id, tree);
          const revision = await r.revisions.findCurrent(document.id);
          if (!revision) throw new IntegrityViolationError("Saved revision unavailable.");
          const entry = await r.linkedEntries.findByDocumentId(document.id);
          formatter.addDocument({ documentId: document.id, sourceId: document.sourceId, sourceName: policy.name, sourcePath: entry?.sourcePath ?? null, revisionId: revision.id, revisionNo: revision.revisionNo, title: revision.title, markdown: revision.markdown, updatedAt: revision.createdAt });
          if (!includeDiscussions) continue;
          const relocate = createReviewAnchorRelocator(revision.markdown);
          const threads = (await r.reviewThreads.listByDocument(document.id)).filter(t => t.visibility !== "HIDDEN").sort(byCreation);
          // Memory is bounded per batch: the formatter throws on overflow before the next batch loads.
          for (let i = 0; i < threads.length; i += COMMENT_BATCH_THREADS) {
            const batch = threads.slice(i, i + COMMENT_BATCH_THREADS), byThread = new Map<string, ReviewComment[]>();
            for (const comment of await r.reviewComments.listByThreads(batch.map(t => t.id))) {
              const list = byThread.get(comment.threadId);
              if (list) list.push(comment); else byThread.set(comment.threadId, [comment]);
            }
            for (const thread of batch) {
              const comments = byThread.get(thread.id) ?? [];
              if (isRetractedThread(comments)) continue;
              for (const comment of comments) {
                if (!authors.has(comment.authorUserId)) authors.set(comment.authorUserId, (await r.users.findById(comment.authorUserId))?.name ?? "Unknown author");
              }
              const discussion = projectAgentDiscussion(thread, comments, relocate(thread.anchor, thread.createdRevisionId === revision.id), authors);
              if (discussion) formatter.addDiscussion(discussion);
            }
          }
        }
        return formatter.finish();
      };
      // A selection that fits without its map is still copied: the map never makes copyable content uncopyable.
      try { return await assemble(links); } catch (error) {
        if (!(error instanceof ContextTooLargeError) || !links.length) throw error;
        return assemble(null);
      }
    });
  }
}
