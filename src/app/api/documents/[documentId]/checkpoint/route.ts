import { canonicalizeJsonObject } from '@/modules/knowledge/domain/content';
import { ValidationError } from '@/modules/knowledge/domain/errors';
import { requireRouteId } from '@/server/authoring-input';
import { workspaceHttp } from '@/server/workspace-http';

export async function POST(request: Request, context: { params: Promise<{ documentId: string }> }) {
  return workspaceHttp(async (services, caller) => {
    const { documentId } = await context.params;
    requireRouteId(documentId, 'documentId');
    const body = await request.json().catch(() => null);
    if (!body || typeof body.expectedCurrentRevisionId !== 'string' || typeof body.name !== 'string' || body.name.trim().length > 120) throw new ValidationError('Provide a version name of up to 120 characters and the current revision ID.');
    requireRouteId(body.expectedCurrentRevisionId, 'expectedCurrentRevisionId');
    const current = await services.queries.getCurrentRevision(caller, documentId, { includeArchived: true });
    return services.hub.createRevision(caller, {
      documentId, expectedCurrentRevisionId: body.expectedCurrentRevisionId,
      title: current.title, markdown: current.markdown, metadata: canonicalizeJsonObject(current.metadata),
      saveMode: 'CHECKPOINT', versionName: body.name.trim() || undefined,
    });
  });
}
