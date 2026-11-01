import type { CallerContext } from '@/modules/identity/domain/caller-context';
import { SourceNotFoundError } from '@/modules/knowledge/domain/errors';
import type { applicationServices } from './composition';
type Services = ReturnType<typeof applicationServices>;
export async function readSourceTree(services: Services, caller: CallerContext, workspaceId: string, sourceId: string) {
  const source = await services.queries.getSource(caller, sourceId, { includeArchived: true });
  if (source.workspaceId !== workspaceId) throw new SourceNotFoundError();
  // The lazy tree request is also the first time a collapsed publication is
  // opened. Return its document views so per-document maintainers ("由 Mike 維護")
  // are available immediately instead of only after the document is read. A
  // caption lookup must never fail the tree itself.
  const publications = (services as { publications?: Services["publications"] }).publications;
  const publication = publications === undefined
    ? null
    : await publications.list(caller, workspaceId, true, {
      includeDocuments: true,
      documentsSourceId: sourceId,
    }).then(
      (items) => items.find((item) => item.publication.sourceId === sourceId) ?? null,
      () => null,
    );
  return {
    source,
    tree: await services.queries.listTree(caller, sourceId, { includeArchived: true }),
    publication,
  };
}
export async function readSidebarShortcuts(services: Services, caller: CallerContext, workspaceId: string, ids: string[], includeArchived: boolean) {
  const sources = await services.queries.listSources(caller, workspaceId, { includeArchived });
  const names = new Map(sources.map(s => [s.id, s.name]));
  const wanted = new Set(ids);
  const documents = await services.queries.listDocumentSummaries(caller, workspaceId, { includeArchived, excludeArchivedAncestors: true });
  return documents.filter(d => wanted.has(d.documentId) && names.has(d.sourceId)).map(d => ({
    documentId: d.documentId, sourceId: d.sourceId, label: d.title, sourceName: names.get(d.sourceId)!, ownership: d.ownership, pageIcon: d.pageIcon ?? null,
  }));
}
