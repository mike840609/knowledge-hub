import { requireRouteId } from '@/server/authoring-input';
import { readSourceTree } from '@/server/source-tree-read';
import { workspaceHttp } from '@/server/workspace-http';
export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string; sourceId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const { workspaceId, sourceId } = await context.params;
    return readSourceTree(services, caller, requireRouteId(workspaceId, 'workspace'), requireRouteId(sourceId, 'source'));
  });
}
