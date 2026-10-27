import type { CallerContext } from '@/modules/identity/domain/caller-context';
import { SourceNotFoundError } from '@/modules/knowledge/domain/errors';
import type { applicationServices } from './composition';
type Services = ReturnType<typeof applicationServices>;
export async function readSourceTree(services: Services, caller: CallerContext, workspaceId: string, sourceId: string) {
  const source = await services.queries.getSource(caller, sourceId, { includeArchived: true });
  if (source.workspaceId !== workspaceId) throw new SourceNotFoundError();
  return { source, tree: await services.queries.listTree(caller, sourceId, { includeArchived: true }) };
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
