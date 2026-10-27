import { parseDocumentIdList, requireRouteId } from '@/server/authoring-input';
import { readSidebarShortcuts } from '@/server/source-tree-read';
import { workspaceHttp } from '@/server/workspace-http';
export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const workspaceId = requireRouteId((await context.params).workspaceId, 'workspace');
    const query = new URL(request.url).searchParams;
    return { documents: await readSidebarShortcuts(services, caller, workspaceId, parseDocumentIdList(query.get('ids'), 100), query.get('includeArchived') === 'true') };
  });
}
