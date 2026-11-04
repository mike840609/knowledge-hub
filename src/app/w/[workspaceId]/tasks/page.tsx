import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { TaskList } from "@/components/task-knowledge/task-list";
import { buttonClasses } from "@/components/ui/button";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

type Props = { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ archived?: string; cursor?: string }> };

export default async function TaskResultsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const { archived, cursor } = await searchParams;
  const showArchived = archived === "1";
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let page;
  try {
    page = await services.taskResults.list(caller, workspaceId, { lifecycle: showArchived ? "ARCHIVED" : "ACTIVE", cursor: cursor ?? null });
  } catch (error) {
    // Task Results exist only in the caller's own active My Space; anything else reads as not found.
    if (error instanceof DomainError && (error.code === "WORKSPACE_NOT_FOUND" || error.code === "WORKSPACE_ARCHIVED")) notFound();
    throw error;
  }
  return (
    <main className="kh-page pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Tasks"
        description="Finished tasks your coding agents saved with /hub-export."
        actions={<Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/tasks/setup`}>Set up export</Link>}
      />
      <TaskList workspaceId={workspaceId} archived={showArchived} items={page.items} nextCursor={page.nextCursor} />
    </main>
  );
}
