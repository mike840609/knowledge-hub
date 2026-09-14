import { redirect } from "next/navigation";
import { getDefaultKnowledgeTarget, getKnowledgeExplorerModel } from "@/server/knowledge-read";
import { applicationServices } from "@/server/composition";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";

export default async function WorkspaceKnowledgePage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  const workspaces = await services.workspaces.listWorkspaces(caller);
  if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">No workspace access</h1>
      </main>
    );
  }
  const sources = await services.queries
    .listSources(caller, workspaceId)
    .catch(() => []);
  if (sources.length === 0) redirect(`/w/${workspaceId}/sources`);
  const target = await getDefaultKnowledgeTarget(workspaceId);
  if (target) redirect(`/w/${workspaceId}/knowledge/${target.sourceId}/${target.documentId}`);
  const firstByName = [...sources].sort((left, right) =>
    left.name !== right.name
      ? left.name < right.name
        ? -1
        : 1
      : left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0,
  )[0];
  if (firstByName) {
    const model = await getKnowledgeExplorerModel(workspaceId, firstByName.id);
    if (model) redirect(`/w/${workspaceId}/knowledge/${firstByName.id}`);
  }
  redirect(`/w/${workspaceId}/sources`);
}
