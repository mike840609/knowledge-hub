"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { HighlightedSearchText } from "@/components/search/highlighted-search-text";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Status } from "@/components/ui/status";
import { tabClasses, tabListClasses } from "@/components/ui/tab";
import { Timestamp } from "@/components/ui/timestamp";
import { navigateListRows } from "@/lib/list-row-navigation";
import type { TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { agentName } from "./agent-name";
import type { TaskListItemView } from "./task-list";
import { taskSearchHref } from "./task-search-url";
import { verificationKind, verificationLabel } from "./task-verification";

/**
 * The read service already bounds this preview and windows it around the
 * matched term. Render it as-is so the client never re-trims the server's
 * leading word or adds a second ellipsis.
 */
function Excerpt({ value, terms }: { value: string; terms: string[] }) {
  return <HighlightedSearchText text={value} terms={terms} />;
}

export function TaskSearchResults({
  workspaceId, query, items, nextCursor, hasTasksInLifecycle = true, error,
}: {
  workspaceId: string; query: TaskSearchQuery;
  items: (TaskListItemView & { summary?: string })[];
  nextCursor: string | null;
  hasTasksInLifecycle?: boolean;
  error?: string | null;
}) {
  const base = `/w/${workspaceId}/tasks`;
  const archived = query.lifecycle === "ARCHIVED";
  return (
    <section className="space-y-2">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <nav aria-label="Task lifecycle" className={tabListClasses}>
          <Link href={taskSearchHref(base, query, { lifecycle: "ACTIVE" })} className={tabClasses(!archived)} aria-current={!archived ? "page" : undefined}>Active</Link>
          <Link href={taskSearchHref(base, query, { lifecycle: "ARCHIVED" })} className={tabClasses(archived)} aria-current={archived ? "page" : undefined}>Archived</Link>
        </nav>
        <span className="self-center text-caption text-kh-text-muted">
          {nextCursor ? "50+ tasks" : items.length > 0 ? `Showing ${items.length} ${items.length === 1 ? "task" : "tasks"}` : null}
        </span>
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-kh-border p-4 text-body text-kh-text">
          <p>{error}</p>
          <Link className={`${buttonClasses({ variant: "secondary" })} mt-2`} href={taskSearchHref(base, query)}>Retry</Link>
        </div>
      ) : items.length === 0 ? (
        !hasTasksInLifecycle ? (
          <EmptyState icon={ListChecks} title={archived ? "No archived tasks" : "No tasks yet"}
            description={archived ? "Tasks you archive appear here and stay readable." : "Finish a task with Claude Code or OpenCode, then use /hub-export to save it."}
            action={archived ? undefined : <Link className={buttonClasses({ variant: "primary" })} href={`${base}/setup`}>Set up task export</Link>} />
        ) : (
          <EmptyState icon={ListChecks} title="No matching tasks"
            description="Try a different search or fewer filters."
            action={<Link className={buttonClasses({ variant: "secondary" })} href={taskSearchHref(base, query, { clear: true })}>Clear filters</Link>} />
        )
      ) : (
        <ul className="-mx-3 flex flex-col divide-y divide-kh-border" onKeyDown={navigateListRows}>
          {items.map((item) => (
            <li key={item.taskResultId} className="min-w-0">
              <Link
                data-list-row
                href={`${base}/${item.taskResultId}`}
                className="kh-focus-ring flex min-w-0 flex-col gap-1 rounded-md px-3 py-3 transition-colors hover:bg-kh-bg-hover focus-visible:bg-kh-bg-hover"
              >
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className="line-clamp-2 min-w-0 flex-1 text-body font-medium text-kh-text sm:line-clamp-1">{item.title}</span>
                  <Timestamp value={item.completedAt} variant="short" label="Completed" className="shrink-0 text-caption tabular-nums text-kh-text-muted" />
                </span>
                {item.summary ? (
                  <span className="line-clamp-2 max-w-measure break-words text-body-sm text-kh-text-muted">
                    <Excerpt value={item.summary} terms={query.terms} />
                  </span>
                ) : null}
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
                  <span>{agentName(item.agent)}</span>
                  <span aria-hidden="true">·</span>
                  <span title="Agent-reported verification, not independently certified by Knowledge Hub">
                    <Status kind={verificationKind(item.verificationStatus)}>{verificationLabel(item.verificationStatus)}</Status>
                    <span className="sr-only"> (Agent-reported)</span>
                  </span>
                  {item.latestRevisionNo > 1 ? <><span aria-hidden="true">·</span><span>revision {item.latestRevisionNo}</span></> : null}
                  {item.bindingStatus === "REVOKED" ? <><span aria-hidden="true">·</span><Status kind="danger">Binding revoked</Status></> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Link className="kh-focus-ring mt-2 inline-flex rounded-md text-body text-kh-link" href={taskSearchHref(base, query, { cursor: nextCursor })}>Older tasks</Link>
      ) : null}
    </section>
  );
}
