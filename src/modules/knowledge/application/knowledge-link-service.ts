import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { IntegrityViolationError, RevisionNotFoundError } from "../domain/errors";
import { extractDocumentLinks, type LinkKind } from "../domain/document-links";
import { linkContext } from "../domain/link-context";
import {
  GRAPH_NODE_LIMIT,
  backlinksTo,
  buildLocalGraph,
  buildWorkspaceGraph,
  linkLookupKey,
  resolveEdges,
  type GraphOptions,
  type LinkGraph,
  type WorkspaceGraph,
} from "../domain/link-graph";
import { buildLinkResolver, type CatalogDocument, type LinkOrigin } from "../domain/link-resolution";
import type { LinkIndexState } from "../ports/document-link-repository";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { requireVisibleDocument } from "./internal/require-visible-document";

/** A backlink list longer than this is cut; the total is still reported. */
export const BACKLINK_LIMIT = 200;
/** Only this many backlinks get a line of context, which costs a Markdown read each. */
export const BACKLINK_CONTEXT_LIMIT = 50;
/** The most documents offered as link targets at once; past it the list is the most recently edited, and says so. */
export const LINK_TARGET_LIMIT = 5000;

export type ResolvedLinkTarget = {
  status: "RESOLVED";
  documentId: string;
  sourceId: string;
  title: string;
  /** Other documents that matched the name equally well. */
  ambiguousWith: number;
};

/** One distinct link a document writes, and what it points at today. */
export type OutgoingLinkView = {
  kind: LinkKind;
  target: string;
  fragment: string | null;
  display: string | null;
  /** How a renderer finds this link's resolution: see `linkLookupKey`. */
  lookupKey: string;
  /** How many times the document writes it. */
  count: number;
  resolution: ResolvedLinkTarget | { status: "UNRESOLVED" };
};

export type BacklinkView = {
  documentId: string;
  sourceId: string;
  sourceName: string;
  title: string;
  count: number;
  /** The line the first link sits on, reduced to what a reader reads. */
  context: string | null;
};

export type DocumentLinkView = {
  documentId: string;
  workspaceId: string;
  outgoing: OutgoingLinkView[];
  unresolved: OutgoingLinkView[];
  backlinks: BacklinkView[];
  backlinkTotal: number;
  index: LinkIndexState;
  /** The document's neighbourhood, when asked for (`localGraphDepth`); `null` if it is not in the graph (archived). */
  localGraph: LinkGraph | null;
};

export type WorkspaceGraphView = WorkspaceGraph & {
  workspaceId: string;
  sources: { id: string; name: string }[];
  index: LinkIndexState;
};

export type LocalGraphView = LinkGraph & {
  workspaceId: string;
  focusId: string;
  index: LinkIndexState;
};

/** One document the editor may offer for `[[…`. */
export type LinkTargetView = {
  documentId: string;
  sourceId: string;
  /** Said next to the title so two documents that share one can be told apart. */
  sourceName: string;
  title: string;
  /** ISO 8601: when the document's current revision was written. */
  editedAt: string;
};

export type LinkTargetsView = {
  workspaceId: string;
  targets: LinkTargetView[];
  /** More documents could be linked to than are listed: these are the most recently edited `LINK_TARGET_LIMIT`. */
  truncated: boolean;
};

export interface KnowledgeLinkService {
  /**
   * What a document links to and what links to it. `revisionNo` selects the
   * revision whose links are shown (the one on screen when a historical
   * revision is being read); the default is the current one.
   */
  getDocumentLinks(
    caller: CallerContext,
    documentId: string,
    input?: { revisionNo?: number; includeArchived?: boolean; localGraphDepth?: 1 | 2 },
  ): Promise<DocumentLinkView>;
  /**
   * The documents of a Workspace a link can be written to — the ones it would resolve to, no more —
   * for the editor's `[[` list. Only for someone who is a member; the list is what they may link, and
   * it never grants a read of anything in it.
   */
  listLinkTargets(caller: CallerContext, workspaceId: string): Promise<LinkTargetsView>;
  getWorkspaceGraph(caller: CallerContext, workspaceId: string, input?: GraphOptions): Promise<WorkspaceGraphView>;
  getLocalGraph(caller: CallerContext, documentId: string, input?: { depth?: 1 | 2 }): Promise<LocalGraphView>;
}

function originOf(catalog: readonly CatalogDocument[], document: { id: string; sourceId: string }): LinkOrigin {
  const entry = catalog.find((candidate) => candidate.documentId === document.id);
  return { documentId: document.id, sourceId: document.sourceId, sourcePath: entry?.sourcePath ?? null };
}

/**
 * Backlinks, outgoing links and the graph, read from the link index (graph
 * spec §8). The index holds what was written; this decides what it points at,
 * against the Workspace's documents as they are now.
 *
 * Every method resolves the Workspace first and reads only that Workspace's
 * catalog and edges, under the same membership check the query service makes.
 * The index never grants access: with it empty, these return less, and nothing
 * else changes.
 */
export class KnowledgeLinkServiceImpl implements KnowledgeLinkService {
  /** `linkTargetLimit` is the product's `LINK_TARGET_LIMIT`; a test that asks what happens past it does not need five thousand documents. */
  constructor(
    private readonly unitOfWork: KnowledgeUnitOfWork,
    private readonly options: { linkTargetLimit?: number } = {},
  ) {}

  async getDocumentLinks(
    caller: CallerContext,
    documentId: string,
    input: { revisionNo?: number; includeArchived?: boolean; localGraphDepth?: 1 | 2 } = {},
  ): Promise<DocumentLinkView> {
    return this.unitOfWork.run(async (repositories) => {
      const { document, policy } = await requireVisibleDocument(repositories, caller, documentId, input.includeArchived ?? false);
      const workspaceId = policy.workspaceId;
      const revision = input.revisionNo === undefined
        ? await repositories.revisions.findCurrent(document.id)
        : await repositories.revisions.findByRevisionNo(document.id, input.revisionNo);
      if (!revision) {
        if (input.revisionNo !== undefined) throw new RevisionNotFoundError();
        throw new IntegrityViolationError("Document current revision is missing.");
      }

      const catalog = await repositories.links.loadCatalog(workspaceId);
      const resolver = buildLinkResolver(catalog);
      const byId = new Map(catalog.map((entry) => [entry.documentId, entry]));
      const origin = originOf(catalog, document);

      const outgoing = new Map<string, OutgoingLinkView>();
      for (const link of extractDocumentLinks(revision.markdown)) {
        const lookupKey = linkLookupKey(link.kind, link.target);
        const existing = outgoing.get(lookupKey);
        if (existing) {
          existing.count += 1;
          continue;
        }
        const resolution = resolver.resolve(link, origin);
        const target = resolution.status === "RESOLVED" ? byId.get(resolution.documentId) : undefined;
        outgoing.set(lookupKey, {
          kind: link.kind,
          target: link.target,
          fragment: link.fragment,
          display: link.display,
          lookupKey,
          count: 1,
          resolution: resolution.status === "RESOLVED" && target
            ? { status: "RESOLVED", documentId: target.documentId, sourceId: target.sourceId, title: target.title, ambiguousWith: resolution.ambiguousWith }
            : { status: "UNRESOLVED" },
        });
      }
      const outgoingViews = [...outgoing.values()];

      const edges = resolveEdges(catalog, await repositories.links.loadValidEdges(workspaceId));
      const backlinks = backlinksTo(document.id, catalog, edges);
      const shown = backlinks.slice(0, BACKLINK_LIMIT);
      const sourceNames = new Map((await repositories.sourcePolicy.listByWorkspaceId(workspaceId, {})).map((source) => [source.id, source.name]));
      const markdown = await repositories.links.loadCurrentMarkdown(workspaceId, shown.slice(0, BACKLINK_CONTEXT_LIMIT).map((backlink) => backlink.documentId));

      return {
        documentId: document.id,
        workspaceId,
        outgoing: outgoingViews,
        unresolved: outgoingViews.filter((link) => link.resolution.status === "UNRESOLVED"),
        backlinks: shown.flatMap((backlink) => {
          const entry = byId.get(backlink.documentId);
          if (!entry) return [];
          const body = markdown.get(backlink.documentId);
          return [{
            documentId: entry.documentId,
            sourceId: entry.sourceId,
            sourceName: sourceNames.get(entry.sourceId) ?? "",
            title: entry.title,
            count: backlink.count,
            context: body === undefined ? null : linkContext(body, backlink.firstLine),
          }];
        }),
        backlinkTotal: backlinks.length,
        index: await repositories.links.countIndexState(workspaceId),
        // From the same catalog and edges already resolved for this request, so
        // asking for the neighbourhood costs no second read of the Workspace.
        localGraph: input.localGraphDepth === undefined
          ? null
          : buildLocalGraph(
              buildWorkspaceGraph(catalog, edges, { includeUnresolved: true, includeOrphans: true, limit: Number.MAX_SAFE_INTEGER }),
              document.id,
              input.localGraphDepth,
            ),
      };
    });
  }

  async listLinkTargets(caller: CallerContext, workspaceId: string): Promise<LinkTargetsView> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      await repositories.workspaceAccess.requireMembership(caller, workspaceId);
      const limit = this.options.linkTargetLimit ?? LINK_TARGET_LIMIT;
      // One more than the limit: whether there is one more is what "truncated" says.
      const rows = await repositories.links.loadLinkTargets(workspaceId, limit + 1);
      const sourceNames = new Map((await repositories.sourcePolicy.listByWorkspaceId(workspaceId, {})).map((source) => [source.id, source.name]));
      return {
        workspaceId,
        targets: rows.slice(0, limit).map((row) => ({
          documentId: row.documentId,
          sourceId: row.sourceId,
          sourceName: sourceNames.get(row.sourceId) ?? "",
          title: row.title,
          editedAt: row.editedAt.toISOString(),
        })),
        truncated: rows.length > limit,
      };
    });
  }

  async getWorkspaceGraph(caller: CallerContext, workspaceId: string, input: GraphOptions = {}): Promise<WorkspaceGraphView> {
    return this.unitOfWork.run(async (repositories) => {
      await repositories.users.upsertIdentity(caller.identity);
      await repositories.workspaceAccess.requireMembership(caller, workspaceId);
      const catalog = await repositories.links.loadCatalog(workspaceId);
      const edges = resolveEdges(catalog, await repositories.links.loadValidEdges(workspaceId));
      const limit = Math.min(Math.max(1, Math.floor(input.limit ?? GRAPH_NODE_LIMIT)), GRAPH_NODE_LIMIT);
      const graph = buildWorkspaceGraph(catalog, edges, { ...input, limit });
      const sources = (await repositories.sourcePolicy.listByWorkspaceId(workspaceId, {})).map((source) => ({ id: source.id, name: source.name }));
      return { ...graph, workspaceId, sources, index: await repositories.links.countIndexState(workspaceId) };
    });
  }

  async getLocalGraph(caller: CallerContext, documentId: string, input: { depth?: 1 | 2 } = {}): Promise<LocalGraphView> {
    return this.unitOfWork.run(async (repositories) => {
      const { document, policy } = await requireVisibleDocument(repositories, caller, documentId, false);
      const workspaceId = policy.workspaceId;
      const catalog = await repositories.links.loadCatalog(workspaceId);
      const edges = resolveEdges(catalog, await repositories.links.loadValidEdges(workspaceId));
      const whole = buildWorkspaceGraph(catalog, edges, { includeUnresolved: true, includeOrphans: true, limit: Number.MAX_SAFE_INTEGER });
      const local = buildLocalGraph(whole, document.id, input.depth === 2 ? 2 : 1);
      return { ...local, workspaceId, focusId: document.id, index: await repositories.links.countIndexState(workspaceId) };
    });
  }
}
