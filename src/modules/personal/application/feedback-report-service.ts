import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { validateFeedbackReport, type FeedbackReportInput } from "../domain/feedback-report";
export class FeedbackReportService {
  constructor(private readonly uow: SourceUnitOfWork) {}
  /** The reporter is the trusted caller; the request body never names one. */
  async submit(caller: CallerContext, input: FeedbackReportInput): Promise<void> {
    const report = validateFeedbackReport(input);
    await this.uow.run((r) =>
      r.feedbackReports.insert({ id: uuidv7(), reporterEmpId: caller.identity.emp_id, ...report, createdAt: new Date() }),
    );
  }
}
