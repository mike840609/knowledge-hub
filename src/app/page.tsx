import { redirect } from "next/navigation";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { applicationServices } from "@/server/composition";
import { getDefaultKnowledgeTarget } from "@/server/knowledge-read";

// The resolver depends on per-request caller identity, so it must render
// on demand and never be statically prerendered (CI builds with no identity).
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  const workspaces = await services.workspaces.listWorkspaces(caller);
  for (const workspace of workspaces) {
    const target = await getDefaultKnowledgeTarget(workspace.id);
    if (target) redirect(`/w/${workspace.id}/knowledge/${target.sourceId}/${target.documentId}`);
  }
  const first = workspaces[0];
  if (!first) {
    return (
      <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold">No workspace access</h1>
      </main>
    );
  }
  redirect(`/w/${first.id}/knowledge`);
}
