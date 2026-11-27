"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Status } from "@/components/ui/status";
import { tabClasses, tabListClasses } from "@/components/ui/tab";
import { Timestamp } from "@/components/ui/timestamp";
import { navigateListRows } from "@/lib/list-row-navigation";
import { agentName } from "./agent-name";

export type TaskListItemView = {
  taskResultId: string;
  title: string;
  agent: string;
  completedAt: string;
  verificationStatus: string;
  latestRevisionNo: number;
  bindingLabel: string;
  bindingStatus: "ACTIVE" | "REVOKED";
};

export function TaskList({ workspaceId, archived, items, nextCursor }: { workspaceId: string; archived: boolean; items: TaskListItemView[]; nextCursor: string | null }) {
  const base = `/w/${workspaceId}/tasks`;
  return (
    <div className="space-y-4">
      <nav aria-label="Task lifecycle" className={tabListClasses}>
        <Link href={base} className={tabClasses(!archived)} aria-current={archived ? undefined : "page"}>Active</Link>
        <Link href={`${base}?archived=1`} className={tabClasses(archived)} aria-current={archived ? "page" : undefined}>Archived</Link>
      </nav>
      {items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={archived ? "No archived tasks" : "No tasks yet"}
          description={archived ? "Tasks you archive appear here and stay readable." : "Finish a task in Claude Code or OpenCode, then run /hub-export to save it here."}
          action={archived ? undefined : <Link className={buttonClasses({ variant: "primary" })} href={`${base}/setup`}>Set up export</Link>}
        />
      ) : (
        <ul className="-mx-3 flex flex-col" onKeyDown={navigateListRows}>
          {items.map((item) => {
            const revoked = item.bindingStatus === "REVOKED";
            return (
              <li key={item.taskResultId}>
                <Link
                  data-list-row
                  href={`${base}/${item.taskResultId}`}
                  className="kh-focus-ring flex min-h-8 items-center gap-3 rounded-md px-3 py-1.5 transition-colors hover:bg-kh-bg-hover focus-visible:bg-kh-bg-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body font-medium text-kh-text">{item.title}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-caption text-kh-text-muted sm:hidden">
                      <span>{agentName(item.agent)}</span>
                      {item.latestRevisionNo > 1 ? <span>revision {item.latestRevisionNo}</span> : null}
                      <span>via {item.bindingLabel}</span>
                      {revoked ? <Status kind="danger">Binding revoked</Status> : null}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-x-2 text-caption text-kh-text-muted sm:ml-4 sm:flex">
                    <span>{agentName(item.agent)}</span>
                    {item.latestRevisionNo > 1 ? <><span aria-hidden="true">·</span><span>revision {item.latestRevisionNo}</span></> : null}
                    <span aria-hidden="true">·</span>
                    <span className="max-w-[12rem] truncate">via {item.bindingLabel}</span>
                    {revoked ? <><span aria-hidden="true">·</span><Status kind="danger">Binding revoked</Status></> : null}
                  </span>
                  <Timestamp value={item.completedAt} variant="short" label="Completed" className="shrink-0 text-caption tabular-nums text-kh-text-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {nextCursor ? (
        <Link className="kh-focus-ring rounded-md text-body text-kh-link" href={`${base}?${archived ? "archived=1&" : ""}cursor=${nextCursor}`}>Older tasks</Link>
      ) : null}
    </div>
  );
}
