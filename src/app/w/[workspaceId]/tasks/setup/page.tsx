import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { TaskExportSetup } from "@/components/task-knowledge/task-export-setup";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

export default async function TaskExportSetupPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let bindings;
  try {
    bindings = await services.taskExportBindings.list(caller, workspaceId);
  } catch (error) {
    // Bindings exist only in the caller's own My Space; anything else reads as not found.
    if (error instanceof DomainError && error.code === "WORKSPACE_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="kh-page pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Task export"
        description="Let Claude Code or OpenCode save finished tasks to My Space with /hub-export."
      />
      <div className="mt-6">
        <TaskExportSetup
          workspaceId={workspaceId}
          bindings={bindings.map((binding) => ({ ...binding, createdAt: binding.createdAt.toISOString(), revokedAt: binding.revokedAt?.toISOString() ?? null }))}
        />
      </div>
    </main>
  );
}
