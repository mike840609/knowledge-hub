import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { TaskList } from "@/components/task-knowledge/task-list";
import { TaskSearchForm } from "@/components/task-knowledge/task-search-form";
import { TaskSearchResults } from "@/components/task-knowledge/task-search-results";
import { TaskSearchOffsetHydrator } from "@/components/task-knowledge/task-search-offset-hydrator";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { buttonClasses } from "@/components/ui/button";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

type Props = { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TaskResultsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const raw = await searchParams;
  const showArchived = raw.archived === "1";
  const enabled = process.env.TASK_SEARCH_READ_ENABLED === "true";
  let search = parseTaskSearchQuery({ archived: showArchived ? "1" : undefined });
  let validationError: string | null = null;
  if (enabled) {
    try {
      search = parseTaskSearchQuery(raw);
    } catch (error) {
      if (error instanceof DomainError && error.code === "INVALID_TASK_SEARCH") {
        validationError = error.message;
      } else {
        throw error;
      }
    }
  }
  const cursor = typeof raw.cursor === "string" ? raw.cursor : null;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let page;
  try {
    page = await services.taskResults.list(caller, workspaceId, {
      lifecycle: showArchived ? "ARCHIVED" : "ACTIVE",
      cursor: validationError ? null : cursor,
      ...(enabled ? { search } : {}),
    });
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
      {enabled ? (
        <>
          <TaskSearchOffsetHydrator hasDateFilter={Boolean(search.from || search.to)} explicitOffset={typeof raw.offset === "string" && raw.offset !== ""} />
          <TaskSearchForm workspaceId={workspaceId} query={search} error={validationError} />
          <TaskSearchResults workspaceId={workspaceId} query={search} items={page.items}
            nextCursor={page.nextCursor} hasTasksInLifecycle={page.hasTasksInLifecycle} />
        </>
      ) : (
        <TaskList workspaceId={workspaceId} archived={showArchived} items={page.items} nextCursor={page.nextCursor} />
      )}
    </main>
  );
}
