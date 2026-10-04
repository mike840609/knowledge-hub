import { applicationServices } from "./composition";
export async function getSourceHealth(
  workspaceId: string,
  sourceId: string,
  afterId?: string,
) {
  const s = applicationServices();
  const { caller } = await s.establishTrustedCaller();
  try {
    return await s.sourceHealth.get(caller, workspaceId, sourceId, afterId);
  } catch {
    return null;
  }
}
