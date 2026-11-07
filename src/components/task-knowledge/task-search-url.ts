import type { TaskSearchLifecycle, TaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";

export type TaskSearchUrlOptions = {
  remove?: "q" | "agent" | "verification" | "from" | "to" | "completed";
  clear?: boolean;
  lifecycle?: TaskSearchLifecycle;
  cursor?: string | null;
};

/** Canonical shareable URL; changing any filter always discards stale keyset cursors. */
export function taskSearchHref(base: string, query: TaskSearchQuery, options: TaskSearchUrlOptions = {}): string {
  const params = new URLSearchParams();
  const lifecycle = options.lifecycle ?? query.lifecycle;
  if (lifecycle === "ARCHIVED") params.set("archived", "1");
  if (!options.clear) {
    const removed = options.remove;
    if (query.q && removed !== "q") params.set("q", query.q);
    if (query.agent && removed !== "agent") params.set("agent", query.agent);
    if (query.verification && removed !== "verification") params.set("verification", query.verification);
    const from = removed === "from" || removed === "completed" ? null : query.from;
    const to = removed === "to" || removed === "completed" ? null : query.to;
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (from || to) params.set("offset", String(query.offsetMinutes));
    if (options.cursor) params.set("cursor", options.cursor);
  }
  return base + (params.size ? "?" + params.toString() : "");
}

