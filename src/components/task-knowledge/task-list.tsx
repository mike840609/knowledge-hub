import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Timestamp } from "@/components/ui/timestamp";
import { tabClasses, tabListClasses } from "@/components/ui/tab";

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

const AGENT_NAMES: Record<string, string> = { "claude-code": "Claude Code", opencode: "OpenCode" };
export const agentName = (agent: string) => AGENT_NAMES[agent] ?? agent;

export function TaskList({ workspaceId, archived, items, nextCursor }: { workspaceId: string; archived: boolean; items: TaskListItemView[]; nextCursor: string | null }) {
  const base = `/w/${workspaceId}/tasks`;
  return (
    <div className="max-w-panel space-y-4">
      <nav aria-label="Task filter" className={tabListClasses}>
        <Link href={base} className={tabClasses(!archived)} aria-current={archived ? undefined : "page"}>Active</Link>
        <Link href={`${base}?archived=1`} className={tabClasses(archived)} aria-current={archived ? "page" : undefined}>Archived</Link>
      </nav>
      {items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={archived ? "No archived tasks" : "No tasks yet"}
          description={archived ? "Tasks you archive appear here and stay readable." : "Finish a task in Claude Code or OpenCode and type /hub-export to save it here."}
          action={archived ? undefined : <Link className="kh-focus-ring rounded-md text-body text-kh-link" href={`${base}/setup`}>Set up task export</Link>}
        />
      ) : (
        <ul className="divide-y divide-kh-border rounded-md border border-kh-border">
          {items.map((item) => (
            <li key={item.taskResultId}>
              <Link href={`${base}/${item.taskResultId}`} className="kh-focus-ring block px-3 py-2 hover:bg-kh-bg-subtle">
                <p className="truncate text-body font-medium text-kh-text">{item.title}</p>
                <p className="flex flex-wrap items-center gap-2 text-caption text-kh-text-muted">
                  <span>{agentName(item.agent)}</span>
                  <Timestamp value={item.completedAt} label="Completed" />
                  {item.latestRevisionNo > 1 ? <span>revision {item.latestRevisionNo}</span> : null}
                  <span>{item.bindingLabel}</span>
                  {item.bindingStatus === "REVOKED" ? <Badge variant="outline">Binding revoked</Badge> : null}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {nextCursor ? (
        <Link className="kh-focus-ring rounded-md text-body text-kh-link" href={`${base}?${archived ? "archived=1&" : ""}cursor=${nextCursor}`}>Older tasks</Link>
      ) : null}
    </div>
  );
}
