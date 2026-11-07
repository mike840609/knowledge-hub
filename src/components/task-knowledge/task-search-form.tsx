import Link from "next/link";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TaskSearchDateOffsetSubmit } from "./task-search-date-offset-submit";
import type { TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { taskSearchHref } from "./task-search-url";

export function TaskSearchForm({
  workspaceId, query, error,
}: { workspaceId: string; query: TaskSearchQuery; error?: string | null }) {
  const base = `/w/${workspaceId}/tasks`;
  const chips = [
    ...(query.q ? [{ key: "q" as const, label: `Search: ${query.q}` }] : []),
    ...(query.agent ? [{ key: "agent" as const, label: `Agent: ${query.agent === "opencode" ? "OpenCode" : "Claude Code"}` }] : []),
    ...(query.verification ? [{ key: "verification" as const, label: `Verification: ${query.verification.replaceAll("_", " ")}` }] : []),
    ...(query.from || query.to ? [{ key: "completed" as const, label: `Completed: ${query.from || "Any"} – ${query.to || "Any"}` }] : []),
  ];
  const field = "min-w-0 rounded-md border border-kh-border-strong bg-kh-bg px-2.5 py-1.5 text-body text-kh-text kh-focus-ring";
  return (
    <section aria-label="Task search and filters" className="kh-reading-column max-w-panel px-0 pb-3">
      <form id="task-search-filter-form" method="get" action={base} role="search" className="space-y-3">
        <TaskSearchDateOffsetSubmit formId="task-search-filter-form" />
        {query.lifecycle === "ARCHIVED" ? <Input type="hidden" name="archived" value="1" /> : null}
        {(query.from || query.to) ? <Input type="hidden" name="offset" value={String(query.offsetMinutes)} /> : null}
        <div className="relative">
          <label htmlFor="task-search-q" className="sr-only">Search tasks</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kh-text-muted" />
          <Input id="task-search-q" name="q" type="search" defaultValue={query.q}
            placeholder="Search tasks…" className={`kh-focus-ring w-full rounded-md border border-kh-border bg-kh-bg py-2 pl-9 pr-3 text-body text-kh-text placeholder:text-kh-text-muted`} />
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor="task-search-agent" className="flex min-w-0 flex-col gap-1 text-caption text-kh-text-muted">
            Agent
            <Select id="task-search-agent" name="agent" defaultValue={query.agent ?? ""} className={field}>
              <option value="">All agents</option>
              <option value="claude-code">Claude Code</option>
              <option value="opencode">OpenCode</option>
            </Select>
          </label>
          <label htmlFor="task-search-verification" className="flex min-w-0 flex-col gap-1 text-caption text-kh-text-muted">
            Verification
            <Select id="task-search-verification" name="verification" defaultValue={query.verification ?? ""} className={field}>
              <option value="">Any verification</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="not_run">Not run</option>
              <option value="not_applicable">Not applicable</option>
            </Select>
          </label>
          <details open={Boolean(query.from || query.to)} className="group min-w-0 rounded-md border border-kh-border px-2.5 py-1.5 text-body text-kh-text">
            <summary className="kh-focus-ring cursor-pointer select-none">Completed</summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <label className="flex flex-col gap-1 text-caption text-kh-text-muted">From
                <Input name="from" type="date" defaultValue={query.from ?? ""} className={field} />
              </label>
              <label className="flex flex-col gap-1 text-caption text-kh-text-muted">To
                <Input name="to" type="date" defaultValue={query.to ?? ""} className={field} />
              </label>
              <p className="w-full text-caption text-kh-text-muted">Dates use UTC{query.offsetMinutes === 0 ? "+00:00" : `${query.offsetMinutes > 0 ? "+" : "-"}${String(Math.floor(Math.abs(query.offsetMinutes) / 60)).padStart(2, "0")}:${String(Math.abs(query.offsetMinutes) % 60).padStart(2, "0")}`}.</p>
            </div>
          </details>
          <button type="submit" className="kh-focus-ring rounded-md border border-kh-border-strong bg-kh-bg px-3 py-1.5 text-body hover:bg-kh-bg-hover">Apply filters</button>
        </div>
      </form>
      {error ? <p role="alert" className="mt-3 text-body text-kh-danger">{error}</p> : null}
      {chips.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Applied filters">
          {chips.map(({ key, label }) => (
            <Link key={key} href={taskSearchHref(base, query, { remove: key })}
              className="kh-focus-ring inline-flex max-w-full items-center gap-1 rounded-md border border-kh-border bg-kh-bg-subtle px-2 py-1 text-caption text-kh-text-muted hover:bg-kh-bg-hover"
              aria-label={`Remove ${label} filter`}><span className="truncate">{label}</span><X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /></Link>
          ))}
          <Link className="kh-focus-ring rounded-md px-2 py-1 text-caption text-kh-link hover:underline" href={taskSearchHref(base, query, { clear: true })}>Clear all</Link>
        </div>
      ) : null}
    </section>
  );
}

