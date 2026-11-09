import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { TaskList } from "@/components/task-knowledge/task-list";
import { TaskSearchForm } from "@/components/task-knowledge/task-search-form";
import { TaskSearchResults } from "@/components/task-knowledge/task-search-results";
import { TaskSearchOffsetHydrator } from "@/components/task-knowledge/task-search-offset-hydrator";
import { taskSearchHref } from "@/components/task-knowledge/task-search-url";
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
  const cursor = typeof raw.cursor === "string" ? raw.cursor : raw.cursor === undefined ? null : "";
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let page: Awaited<ReturnType<typeof services.taskResults.list>> | null = null;
  let searchError: string | null = null;
  try {
    if (enabled && validationError) {
      // An invalid query is not a search, but must still authorize the
      // workspace before revealing any Tasks page or validation state.
      await services.taskResults.assertOwnedMySpace(caller, workspaceId);
    } else {
      page = await services.taskResults.list(caller, workspaceId, {
        lifecycle: showArchived ? "ARCHIVED" : "ACTIVE",
        cursor,
        ...(enabled ? { search } : {}),
      });
    }
  } catch (error) {
    // Task Results exist only in the caller's own active My Space; anything else reads as not found.
    if (error instanceof DomainError && (error.code === "WORKSPACE_NOT_FOUND" || error.code === "WORKSPACE_ARCHIVED")) notFound();
    if (enabled && error instanceof DomainError && error.code === "TASK_SEARCH_UNAVAILABLE") {
      searchError = error.message;
      page = { items: [], nextCursor: null, hasTasksInLifecycle: true };
    } else {
      throw error;
    }
  }
  // Avoid a bookmark showing the wrong cursor while rendering first-page
  // results. The service already checked ownership before returning reset.
  if (enabled && !validationError && page?.resetCursor) {
    redirect(taskSearchHref(`/w/${workspaceId}/tasks`, search));
  }
  // The empty state carries the one setup action; repeating it in the header would be two of the same.
  const showSetupAction = showArchived || (page?.items.length ?? 0) > 0;
  // With search enabled, an empty workspace is a setup state, not a filter bar over nothing.
  const hasCriteria = Boolean(search.q || search.agent || search.verification || search.from || search.to);
  const hasTasks = page?.hasTasksInLifecycle ?? true;
  const showSearchForm = Boolean(validationError) || hasTasks || hasCriteria;
  return (
    <main className="kh-page pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Tasks"
        actions={showSetupAction ? <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/tasks/setup`}>Set up export</Link> : undefined}
      />
      <div className="mt-6">
        {enabled ? (
          <>
            <TaskSearchOffsetHydrator hasDateFilter={Boolean(search.from || search.to)} explicitOffset={typeof raw.offset === "string" && raw.offset !== ""} />
            {showSearchForm ? <TaskSearchForm workspaceId={workspaceId} query={search} error={validationError} /> : null}
            {!validationError && page ? (
              <TaskSearchResults workspaceId={workspaceId} query={search} items={page.items}
                nextCursor={page.nextCursor} hasTasksInLifecycle={page.hasTasksInLifecycle} error={searchError} />
            ) : null}
          </>
        ) : page ? (
          <TaskList workspaceId={workspaceId} archived={showArchived} items={page.items} nextCursor={page.nextCursor} />
        ) : null}
      </div>
    </main>
  );
}
