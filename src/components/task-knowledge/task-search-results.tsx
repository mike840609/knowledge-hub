"use client";

import Link from "next/link";
import { Fragment } from "react";
import { ListChecks } from "lucide-react";
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

const MAX_EXCERPT = 200;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keep the matched term in view, start and end on a word boundary where the
 * script has spaces, and make truncation visible. The projection already
 * provides a bounded excerpt; this trims the partial word it can start on.
 */
function excerpt(value: string, terms: string[]): string {
  const active = terms.filter((term) => term.trim().length > 0);
  const leading = value.startsWith("…") ? "…" : "";
  const source = leading ? value.slice(1) : value;
  const chars = Array.from(source);
  if (active.length === 0) {
    const text = chars.slice(0, MAX_EXCERPT).join("");
    return leading + text + (chars.length > MAX_EXCERPT ? "…" : "");
  }
  const lower = source.toLocaleLowerCase();
  let at = -1;
  for (const term of active) {
    const index = lower.indexOf(term.toLocaleLowerCase());
    if (index >= 0 && (at < 0 || index < at)) at = index;
  }
  if (at < 0) {
    const text = chars.slice(0, MAX_EXCERPT).join("");
    return leading + text + (chars.length > MAX_EXCERPT ? "…" : "");
  }
  const charAt = Array.from(source.slice(0, at)).length;
  const backoff = Math.max(0, charAt - 45);
  const window = chars.slice(backoff, charAt);
  const spaceIndex = window.findIndex((char) => /\s/.test(char));
  const start = spaceIndex >= 0 ? backoff + spaceIndex + 1 : backoff;
  const prefix = leading || start > 0 ? "…" : "";
  const suffix = start + MAX_EXCERPT < chars.length ? "…" : "";
  const text = chars.slice(start, start + MAX_EXCERPT - prefix.length - suffix.length).join("");
  return prefix + text + suffix;
}

/** Safe, inert emphasis: never interpret an Agent summary as HTML or Markdown. */
function Excerpt({ value, terms }: { value: string; terms: string[] }) {
  const text = excerpt(value, terms);
  const active = terms.filter((term) => term.trim().length > 0);
  if (active.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${active.map(escapeRegExp).join("|")})`, "giu");
  const normalized = new Set(active.map((term) => term.toLocaleLowerCase()));
  return (
    <>
      {text.split(pattern).map((part, index) =>
        normalized.has(part.toLocaleLowerCase())
          ? <mark key={index} className="rounded-sm bg-kh-bg-selected text-kh-text">{part}</mark>
          : <Fragment key={index}>{part}</Fragment>,
      )}
    </>
  );
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
          {nextCursor ? "50+ tasks" : `Showing ${items.length} ${items.length === 1 ? "task" : "tasks"}`}
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
            description={archived ? "Archived tasks stay readable here." : "Finish a task with Claude Code or OpenCode, then use /hub-export to save it."}
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
