import { WorkspaceEmptyIllustration } from "./workspace-empty-illustration";
import Link from "next/link";
import type { FolderUpdatesPage } from "@/modules/personal/application/list-folder-updates";
import { buttonClasses } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
export function UpdatesList({
  page,
  workspaceId,
  filters = {},
}: {
  page: FolderUpdatesPage;
  workspaceId: string;
  filters?: { sourceId?: string; unreadOnly?: boolean; paginated?: boolean };
}) {
  const filtered = Boolean(filters.sourceId || filters.unreadOnly);
  const partialHistory = Boolean(filters.paginated || page.nextCursor);
  let emptyTitle = "No recorded folder changes to show.";
  if (filters.unreadOnly) {
    emptyTitle = partialHistory ? "No unread updates on this page." : "No unread folder updates match these filters.";
  } else if (partialHistory) {
    emptyTitle = "No recorded folder changes on this page.";
  } else if (filtered) {
    emptyTitle = "No folder updates match these filters.";
  }
  const showAll = filtered || filters.paginated;
  return page.runs.length ? (
    <div className="flex flex-col gap-4">
      {page.runs.map(
        ({ run, sourceName, changes, totalChanges, added, updated }) => (
          <section key={run.id} className="rounded-md border border-kh-border">
            <div className="flex items-center justify-between gap-3 border-b border-kh-border px-3 py-2">
              <Link
                className="text-body font-medium text-kh-link"
                href={`/w/${workspaceId}/sources/${run.sourceId}/runs/${run.id}`}
              >
                {sourceName} · Added {added}, updated {updated}
              </Link>
              <span className="text-caption text-kh-text-muted">
                <Timestamp value={run.completedAt ?? run.startedAt} />
              </span>
            </div>
            <ul className="divide-y divide-kh-border">
              {changes.map((c) => (
                <li key={c.id} className="px-3 py-2">
                  <Link
                    className="flex gap-2 text-body text-kh-link"
                    href={`/w/${workspaceId}/knowledge/${run.sourceId}/${c.documentId}?revision=${c.afterRevisionNo}`}
                  >
                    <span className="flex-1">{c.title}</span>
                    <span className="text-caption text-kh-text-muted">
                      {c.labels.includes("ADDED") ? "Added" : "Updated"} ·{" "}
                      {c.unread ? "Unread" : "Read"}
                    </span>
                  </Link>
                  <p className="text-caption text-kh-text-muted">
                    {c.sourcePath}
                  </p>
                </li>
              ))}
            </ul>
            {totalChanges > changes.length ? (
              <Link
                className="block px-3 py-2 text-caption text-kh-link"
                href={`/w/${workspaceId}/sources/${run.sourceId}/runs/${run.id}`}
              >
                View all changes
              </Link>
            ) : null}
          </section>
        ),
      )}
    </div>
  ) : (
    <div className="space-y-3">
      {!filtered && !partialHistory ? <WorkspaceEmptyIllustration kind="updates" /> : null}
      <p className="text-body font-medium text-kh-text">
        {emptyTitle}
      </p>
      <p className="text-body text-kh-text-muted">
        {filtered ? "Show all updates to include read changes and other folders." : "Applied folder imports that add or update active documents appear here."}
        {page.nextCursor ? " Older updates may contain more changes." : ""}
      </p>
      <Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/${showAll ? "updates" : "sources"}`}>
        {showAll ? "Show all updates" : "Manage folders"}
      </Link>
    </div>
  );
}
