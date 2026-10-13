import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { FEEDBACK_HOURLY_LIMIT, parseFeedbackReport } from "@/modules/personal/domain/feedback-report";
import type { FeedbackReportStore } from "@/modules/personal/ports/feedback-report-store";
import { DomainError } from "@/shared/domain/errors";

/** Stores "Report a problem" submissions. The sender is the trusted caller, snapshotted with their emp_id. */
export class FeedbackReportService {
  constructor(private readonly store: FeedbackReportStore, private readonly now: () => Date = () => new Date()) {}
  async submit(caller: CallerContext, body: unknown): Promise<{ id: string }> {
    const input = parseFeedbackReport(body);
    const createdAt = this.now();
    const { id: userId, emp_id: empId, name: userName } = caller.identity;
    const id = await this.store.appendWithinLimit(
      { userId, empId, userName, ...input, createdAt },
      new Date(createdAt.getTime() - 60 * 60 * 1000), FEEDBACK_HOURLY_LIMIT,
    );
    if (!id) throw new DomainError("FEEDBACK_RATE_LIMITED", "Too many reports in the last hour. Try again later.");
    return { id };
  }
}
