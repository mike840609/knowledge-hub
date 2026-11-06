import Link from "next/link";
import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { Timestamp } from "@/components/ui/timestamp";
import type { TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import type { TaskListItemView } from "./task-list";
import { agentName } from "./task-list";
import { taskSearchHref } from "./task-search-url";

function Verification({ status }: { status: string }) {
  const text = status === "passed" ? "Passed" : status === "failed" ? "Failed" : status === "not_run" ? "Not run" : "Not applicable";
  return <span title="Agent-reported verification, not independently certified by Knowledge Hub">{text} <span className="sr-only">(Agent-reported)</span></span>;
}

/** Safe, inert emphasis: never interpret an Agent summary as HTML or Markdown. */
function Excerpt({ value, terms }: { value: string; terms: string[] }) {
  const truncated = [...value].slice(0, 200).join("");
  const source = truncated.toLocaleLowerCase();
  const pieces: React.ReactNode[] = [];
  let start = 0;
  while (start < truncated.length) {
    const matches = terms.map((term) => {
      const at = source.indexOf(term.toLocaleLowerCase(), start);
      return at < 0 ? null : { at, length: term.length };
    }).filter((m): m is { at: number; length: number } => m !== null).sort((a, b) => a.at - b.at);
    const next = matches[0];
    if (!next) { pieces.push(truncated.slice(start)); break; }
    if (next.at > start) pieces.push(truncated.slice(start, next.at));
    pieces.push(<mark key={next.at} className="rounded-sm bg-kh-bg-selected text-kh-text">{truncated.slice(next.at, next.at + next.length)}</mark>);
    start = next.at + next.length;
  }
  return <>{pieces}</>;
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
  const tab = (active: boolean) => `kh-focus-ring rounded-md px-3 py-1.5 text-body-sm ${active ? "bg-kh-bg-hover font-medium text-kh-text" : "text-kh-text-muted hover:bg-kh-bg-subtle"}`;
  return (
    <section className="kh-reading-column max-w-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3 border-b border-kh-border pb-2">
        <nav aria-label="Task lifecycle" className="flex gap-1">
          <Link href={taskSearchHref(base, query, { lifecycle: "ACTIVE" })} className={tab(!archived)} aria-current={!archived ? "page" : undefined}>Active</Link>
          <Link href={taskSearchHref(base, query, { lifecycle: "ARCHIVED" })} className={tab(archived)} aria-current={archived ? "page" : undefined}>Archived</Link>
        </nav>
        <span className="text-caption text-kh-text-muted">
          {nextCursor ? "50+ tasks" : `Showing ${items.length} ${items.length === 1 ? "task" : "tasks"}`}
        </span>
      </div>
      {error ? (
        <div role="alert" className="rounded-md border border-kh-border p-4 text-body text-kh-text">
          <p>{error}</p>
          <Link className="kh-focus-ring mt-2 inline-block text-kh-link" href={taskSearchHref(base, query)}>Retry</Link>
        </div>
      ) : items.length === 0 ? (
        !hasTasksInLifecycle ? (
          <EmptyState icon={ListChecks} title={archived ? "No archived tasks" : "No tasks yet"}
            description={archived ? "Archived tasks stay readable here." : "Finish a task with Claude Code or OpenCode, then use /hub-export to save it."}
            action={archived ? undefined : <Link className="kh-focus-ring rounded-md text-body text-kh-link" href={`${base}/setup`}>Set up task export</Link>} />
        ) : (
          <EmptyState icon={ListChecks} title="No matching tasks"
            description="Try a different search or fewer filters."
            action={<Link className="kh-focus-ring rounded-md text-body text-kh-link" href={taskSearchHref(base, query, { clear: true })}>Clear filters</Link>} />
        )
      ) : (
        <ul className="divide-y divide-kh-border border-y border-kh-border">
          {items.map((item) => (
            <li key={item.taskResultId} className="min-w-0">
              <Link href={`${base}/${item.taskResultId}`} className="kh-focus-ring block min-w-0 px-3 py-3 hover:bg-kh-bg-subtle">
                <p className="break-words text-body font-medium text-kh-text">{item.title}</p>
                {item.summary ? <p className="mt-1 line-clamp-2 break-all text-body-sm text-kh-text-muted"><Excerpt value={item.summary} terms={query.terms} /></p> : null}
                <p className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-kh-text-muted">
                  <span>{agentName(item.agent)}</span><span aria-hidden="true">·</span>
                  <Verification status={item.verificationStatus} /><span aria-hidden="true">·</span>
                  <Timestamp value={item.completedAt} label="Completed" variant="date" />
                  {item.latestRevisionNo > 1 ? <span>revision {item.latestRevisionNo}</span> : null}
                  {item.bindingStatus === "REVOKED" ? <span>Binding revoked</span> : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? <Link className="kh-focus-ring mt-4 inline-flex rounded-md px-1 text-body text-kh-link"
        href={taskSearchHref(base, query, { cursor: nextCursor })}>Older tasks</Link> : null}
    </section>
  );
}

