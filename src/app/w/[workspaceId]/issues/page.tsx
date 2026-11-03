import Link from "next/link";
import { notFound } from "next/navigation";
import { FeedbackIssues, FEEDBACK_ISSUE_STATUS_PRESENTATION } from "@/components/knowledge/feedback-issues";
import { LiveSearch } from "@/components/search/live-search-submit";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { firstSearchParam } from "@/lib/search-params";
import { FEEDBACK_CATEGORIES, FEEDBACK_STATUSES } from "@/modules/personal/domain/feedback-report";
import { getFeedbackIssues } from "@/server/feedback-issues-read";

export const dynamic = "force-dynamic";

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { workspaceId } = await params;
  const q = await searchParams;
  const model = await getFeedbackIssues(workspaceId, q);
  if (!model) notFound();

  const { filters, page } = model;
  const filtered = Boolean(filters.status || filters.category || filters.mineOnly);
  // The older page keeps the applied filters; the filter form itself never carries the cursor,
  // because choosing a filter starts again at the newest report.
  const applied = new URLSearchParams();
  if (filters.status) applied.set("status", filters.status);
  if (filters.category) applied.set("category", filters.category);
  if (filters.mineOnly) applied.set("mine", "true");
  const older = new URLSearchParams(applied);
  if (page.nextCursor) {
    older.set("beforeAt", page.nextCursor.createdAt);
    older.set("beforeId", page.nextCursor.id);
  }
  // A valid cursor past the last report is a real page, not a typo: it gets its own
  // empty state and a link back to the newest page with the same filters.
  const paged = Boolean(firstSearchParam(q.beforeAt) && firstSearchParam(q.beforeId));
  const newestHref = applied.toString() ? `/w/${workspaceId}/issues?${applied}` : `/w/${workspaceId}/issues`;

  return (
    <main className="kh-page flex flex-col gap-5 pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}`}
        title="Issues"
        description="Problems colleagues have reported through Report a problem, newest first."
      />
      <form
        key={`${filters.status ?? ""}|${filters.category ?? ""}|${filters.mineOnly ? "1" : ""}`}
        action={`/w/${workspaceId}/issues`}
        aria-label="Filter issues"
        className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-kh-border pb-3"
      >
        <Label inline>
          Status
          <Select name="status" defaultValue={filters.status ?? ""}>
            <option value="">All statuses</option>
            {FEEDBACK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {FEEDBACK_ISSUE_STATUS_PRESENTATION[status].label}
              </option>
            ))}
          </Select>
        </Label>
        <Label inline>
          Category
          <Select name="category" defaultValue={filters.category ?? ""}>
            <option value="">All categories</option>
            {FEEDBACK_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </Select>
        </Label>
        <label className="flex min-h-8 items-center gap-2 text-body-sm">
          <input type="checkbox" name="mine" value="true" defaultChecked={filters.mineOnly} />
          Mine only
        </label>
        <LiveSearch />
        <noscript>
          <Button type="submit" variant="secondary">Filter</Button>
        </noscript>
      </form>
      <FeedbackIssues page={page} filtered={filtered} paged={paged} newestHref={newestHref} />
      {page.nextCursor ? (
        <Link className="kh-focus-ring w-fit rounded-md text-body-sm text-kh-link" href={`/w/${workspaceId}/issues?${older}`}>
          Older issues
        </Link>
      ) : null}
    </main>
  );
}
