import Link from "next/link";
import { ChevronDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { filterChipClasses } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TaskSearchDateOffsetSubmit } from "./task-search-date-offset-submit";
import { verificationLabel } from "./task-verification";
import type { TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { taskSearchHref } from "./task-search-url";

/** The filter controls sit on the same 32px line as the shared buttons. */
const control = "inline-flex h-8 min-w-0 items-center gap-2 rounded-md border border-kh-border-strong bg-kh-bg px-2.5 text-body text-kh-text hover:bg-kh-bg-hover";

function offsetLabel(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function TaskSearchForm({
  workspaceId, query, error,
}: { workspaceId: string; query: TaskSearchQuery; error?: string | null }) {
  const base = `/w/${workspaceId}/tasks`;
  const chips = [
    ...(query.q ? [{ key: "q" as const, label: `Search: ${query.q}` }] : []),
    ...(query.agent ? [{ key: "agent" as const, label: `Agent: ${query.agent === "opencode" ? "OpenCode" : "Claude Code"}` }] : []),
    ...(query.verification ? [{ key: "verification" as const, label: `Verification: ${verificationLabel(query.verification)}` }] : []),
    ...(query.from || query.to ? [{ key: "completed" as const, label: `Completed: ${query.from || "Any"} – ${query.to || "Any"}` }] : []),
  ];
  const hasDate = Boolean(query.from || query.to);
  return (
    <section aria-label="Task search and filters" className="space-y-3">
      <form id="task-search-filter-form" method="get" action={base} role="search" className="space-y-3">
        <TaskSearchDateOffsetSubmit formId="task-search-filter-form" />
        {query.lifecycle === "ARCHIVED" ? <Input type="hidden" name="archived" value="1" /> : null}
        {hasDate ? <Input type="hidden" name="offset" value={String(query.offsetMinutes)} /> : null}
        <div className="relative">
          <label htmlFor="task-search-q" className="sr-only">Search tasks</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kh-text-muted" />
          <Input id="task-search-q" name="q" size="lg" type="search" defaultValue={query.q} placeholder="Search tasks…" className="kh-search-field" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="task-search-agent" className="flex items-center gap-2 text-caption text-kh-text-muted">
            <span>Agent</span>
            <Select id="task-search-agent" name="agent" defaultValue={query.agent ?? ""} className="min-w-32">
              <option value="">All agents</option>
              <option value="claude-code">Claude Code</option>
              <option value="opencode">OpenCode</option>
            </Select>
          </label>
          <label htmlFor="task-search-verification" className="flex items-center gap-2 text-caption text-kh-text-muted">
            <span>Verification</span>
            <Select id="task-search-verification" name="verification" defaultValue={query.verification ?? ""} className="min-w-36">
              <option value="">Any verification</option>
              <option value="passed">Passed</option>
              <option value="failed">Failed</option>
              <option value="not_run">Not run</option>
              <option value="not_applicable">Not applicable</option>
            </Select>
          </label>
          <details open={hasDate} className="group relative min-w-0">
            <summary aria-label={hasDate ? `Completed from ${query.from || "any date"} to ${query.to || "any date"}` : "Completed"} className={`${control} kh-focus-ring cursor-pointer select-none [&::-webkit-details-marker]:hidden`}>
              <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-kh-text-muted transition-transform group-open:rotate-180" />
              <span className="truncate">Completed</span>
              {hasDate ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-kh-primary" /> : null}
            </summary>
            <div className="mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-kh-border bg-kh-bg p-3 shadow-popover sm:absolute sm:left-0 sm:top-full sm:z-20">
              <div className="flex flex-wrap gap-2">
                <label className="flex min-w-0 flex-1 basis-32 flex-col gap-1 text-caption text-kh-text-muted">From
                  <Input name="from" type="date" defaultValue={query.from ?? ""} className="w-full" />
                </label>
                <label className="flex min-w-0 flex-1 basis-32 flex-col gap-1 text-caption text-kh-text-muted">To
                  <Input name="to" type="date" defaultValue={query.to ?? ""} className="w-full" />
                </label>
              </div>
              <p className="mt-2 text-caption text-kh-text-muted">Dates use {offsetLabel(query.offsetMinutes)}.</p>
            </div>
          </details>
          <Button type="submit" variant="secondary">Apply filters</Button>
        </div>
      </form>
      {error ? <p role="alert" className="text-body text-kh-danger">{error}</p> : null}
      {chips.length ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Applied filters">
          {chips.map(({ key, label }) => (
            <Link key={key} href={taskSearchHref(base, query, { remove: key })}
              className={filterChipClasses}
              aria-label={`Remove ${label} filter`}><span className="truncate">{label}</span><X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /></Link>
          ))}
          <Link className="kh-focus-ring rounded-md px-2 py-1 text-caption text-kh-link hover:underline" href={taskSearchHref(base, query, { clear: true })}>Clear all</Link>
        </div>
      ) : null}
    </section>
  );
}
