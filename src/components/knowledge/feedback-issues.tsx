import { Badge } from "@/components/ui/badge";
import { Status, type StatusKind } from "@/components/ui/status";
import { Timestamp } from "@/components/ui/timestamp";
import type {
  FeedbackIssuePage,
  FeedbackIssueView,
} from "@/modules/personal/application/feedback-report-query-service";
import type { FeedbackStatus } from "@/modules/personal/domain/feedback-report";

/** How each stored status is said, and the glyph and colour that carry it beside the word. */
export const FEEDBACK_ISSUE_STATUS_PRESENTATION: Record<
  FeedbackStatus,
  { kind: StatusKind; label: string }
> = {
  OPEN: { kind: "active", label: "Open" },
  IN_PROGRESS: { kind: "pending", label: "In progress" },
  RESOLVED: { kind: "success", label: "Resolved" },
  DUPLICATE: { kind: "none", label: "Duplicate" },
};

/** A description longer than this opens behind a disclosure rather than filling the list. */
const DESCRIPTION_PREVIEW_LENGTH = 280;

function IssueRow({ item }: { item: FeedbackIssueView }) {
  const status = FEEDBACK_ISSUE_STATUS_PRESENTATION[item.status];
  const long = item.description.length > DESCRIPTION_PREVIEW_LENGTH;
  return (
    <li className="border-b border-kh-border px-3 py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <Status kind={status.kind} className="text-body-sm">
          {status.label}
        </Status>
        <Badge variant="secondary">{item.category}</Badge>
        <span className="text-body-sm text-kh-text">{item.userName}</span>
        <span className="text-caption text-kh-text-muted">{item.empId}</span>
        {/* The reporter's id never reaches the browser; this marker is how a reader finds their own report. */}
        {item.isMine ? <span className="text-caption text-kh-text-muted">You</span> : null}
        <span className="ml-auto text-caption text-kh-text-muted">
          <Timestamp value={item.createdAt} />
        </span>
      </div>
      <p className="font-mono text-caption text-kh-text-muted">{item.pagePath}</p>
      <p className="whitespace-pre-wrap text-body-sm text-kh-text-secondary">
        {long ? `${item.description.slice(0, DESCRIPTION_PREVIEW_LENGTH)}…` : item.description}
      </p>
      {long ? (
        <details className="text-body-sm">
          <summary className="kh-focus-ring w-fit cursor-pointer rounded-md text-kh-text-muted">Show the full report</summary>
          <p className="whitespace-pre-wrap text-kh-text-secondary">{item.description}</p>
        </details>
      ) : null}
    </li>
  );
}

export function FeedbackIssues({ page, filtered }: { page: FeedbackIssuePage; filtered: boolean }) {
  if (!page.items.length) {
    return (
      <p className="text-body text-kh-text-muted">
        {filtered ? "No reports match these filters." : "No reports yet."}
      </p>
    );
  }
  return (
    <ol aria-label="Reported issues" className="-mx-3">
      {page.items.map((item) => (
        <IssueRow key={item.id} item={item} />
      ))}
    </ol>
  );
}
