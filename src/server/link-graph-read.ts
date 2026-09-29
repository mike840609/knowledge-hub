import type {
  DocumentLinkView,
  LocalGraphView,
  WorkspaceGraphView,
} from "@/modules/knowledge/application/knowledge-link-service";
import type { GraphOptions } from "@/modules/knowledge/domain/link-graph";
import { applicationServices } from "@/server/composition";

/**
 * Read models for the link features (graph spec §8). As with the other read
 * models, the trusted caller comes from the provider, route ids are only
 * navigation, and the service re-checks membership; a failure of any kind
 * becomes `null`, which the page answers by rendering without links rather
 * than not rendering.
 */

/** A document's links and backlinks. `workspaceId` is checked against the document's real Workspace. */
export async function getDocumentLinkModel(
  workspaceId: string,
  documentId: string,
  input: { includeArchived?: boolean; revisionNo?: number } = {},
): Promise<DocumentLinkView | null> {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const view = await services.links.getDocumentLinks(caller, documentId, input);
    return view.workspaceId === workspaceId ? view : null;
  } catch {
    return null;
  }
}

export async function getWorkspaceGraphModel(workspaceId: string, input: GraphOptions = {}): Promise<WorkspaceGraphView | null> {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    return await services.links.getWorkspaceGraph(caller, workspaceId, input);
  } catch {
    return null;
  }
}

export async function getLocalGraphModel(workspaceId: string, documentId: string, depth: 1 | 2 = 1): Promise<LocalGraphView | null> {
  try {
    const services = applicationServices();
    const { caller } = await services.establishTrustedCaller();
    const view = await services.links.getLocalGraph(caller, documentId, { depth });
    return view.workspaceId === workspaceId ? view : null;
  } catch {
    return null;
  }
}
