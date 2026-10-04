import Link from "next/link";
import type { FolderUpdatesPage } from "@/modules/personal/application/list-folder-updates";
import { Timestamp } from "@/components/ui/timestamp";
export function UpdatesList({
  page,
  workspaceId,
}: {
  page: FolderUpdatesPage;
  workspaceId: string;
}) {
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
    <p className="text-body text-kh-text-muted">No folder updates to read.</p>
  );
}
