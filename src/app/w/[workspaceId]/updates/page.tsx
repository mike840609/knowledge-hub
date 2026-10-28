import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { applicationServices } from "@/server/composition";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getFolderUpdates } from "@/server/sync-reading";
import { UpdatesList } from "@/components/knowledge/updates-list";
import { PageHeader } from "@/components/shell/page-header";
import { LiveSearch } from "@/components/search/live-search-submit";
export default async function UpdatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{
    source?: string;
    unread?: string;
    time?: string;
    run?: string;
  }>;
}) {
  const { workspaceId } = await params,
    q = await searchParams;
  const page = await getFolderUpdates(workspaceId, {
    sourceId: q.source,
    unreadOnly: q.unread === "true",
    limit: 20,
    cursor: q.time && q.run ? { completedAt: q.time, runId: q.run } : undefined,
  });
  if (!page) notFound();
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  const sources = await services.queries.listSources(caller, workspaceId, {
    includeArchived: true,
  });
  const next = new URLSearchParams();
  if (q.source) next.set("source", q.source);
  if (q.unread) next.set("unread", q.unread);
  if (page.nextCursor) {
    next.set("time", page.nextCursor.completedAt);
    next.set("run", page.nextCursor.runId);
  }
  return (
    <main className="kh-page flex flex-col gap-5 pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}`}
        title="Updates"
      />
      {/* Keyed by the query: a client navigation (Show all updates) must reset fields the reader changed,
          or the next live change would send their stale values again. */}
      <form key={`${q.source ?? ""}|${q.unread ?? ""}`} action={`/w/${workspaceId}/updates`} aria-label="Filter updates" className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-kh-border pb-3">
        <Label inline>
          Folder
          <Select name="source" defaultValue={q.source ?? ""}>
            <option value="">All folders</option>
            {sources
              .filter((source) => source.sourceType === "FOLDER_SYNC")
              .map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
          </Select>
        </Label>
        <label className="flex min-h-8 items-center gap-2 text-body-sm">
          <input
            type="checkbox"
            name="unread"
            value="true"
            defaultChecked={q.unread === "true"}
          />
          Unread only
        </label>
        <LiveSearch />
        <noscript>
          <Button type="submit" variant="secondary">Filter</Button>
        </noscript>
      </form>
      <UpdatesList workspaceId={workspaceId} page={page} filters={{ sourceId: q.source, unreadOnly: q.unread === "true", paginated: Boolean(q.time && q.run) }} />
      {page.nextCursor ? (
        <Link
          className="text-kh-link"
          href={`/w/${workspaceId}/updates?${next}`}
        >
          Older updates
        </Link>
      ) : null}
    </main>
  );
}
