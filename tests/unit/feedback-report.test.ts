import { describe, expect, it, vi } from "vitest";
import { FEEDBACK_CATEGORIES, validateFeedbackReport } from "@/modules/personal/domain/feedback-report";
import { FeedbackReportService } from "@/modules/personal/application/feedback-report-service";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";

const valid = { category: "Sync", description: "  Preview failed  ", pagePath: "/w/personal/sources" };

describe("feedback report", () => {
  it.each(FEEDBACK_CATEGORIES)("accepts category %s and trims the description", (category) => {
    expect(validateFeedbackReport({ ...valid, category })).toEqual({ category, description: "Preview failed", pagePath: valid.pagePath });
  });
  it("accepts a description at the limit", () => {
    expect(validateFeedbackReport({ ...valid, description: "x".repeat(5000) }).description).toHaveLength(5000);
  });
  it.each([
    ["an unknown category", { category: "Billing" }],
    ["an empty description", { description: "" }],
    ["a blank description", { description: " \n " }],
    ["a description over the limit", { description: "x".repeat(5001) }],
    ["a page path that is not a path", { pagePath: "https://attacker.invalid/" }],
    ["an over-long page path", { pagePath: `/${"x".repeat(2048)}` }],
  ])("rejects %s", (_name, change) => {
    expect(() => validateFeedbackReport({ ...valid, ...change })).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  const caller = callerFromIdentity({ id: "u", emp_id: "E001", name: "Ada", org_code: "ORG" });
  function service() {
    const insert = vi.fn(async () => {});
    const uow = { run: (work: (r: unknown) => unknown) => work({ feedbackReports: { insert } }) } as unknown as SourceUnitOfWork;
    return { insert, service: new FeedbackReportService(uow) };
  }
  it("stores the report under the caller's emp_id, never one from the request", async () => {
    const { insert, service: s } = service();
    await s.submit(caller, { ...valid, reporterEmpId: "E999", emp_id: "E999" } as typeof valid);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ reporterEmpId: "E001", category: "Sync", description: "Preview failed", pagePath: valid.pagePath }));
  });
  it("stores nothing when the report is invalid", async () => {
    const { insert, service: s } = service();
    await expect(s.submit(caller, { ...valid, description: " " })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(insert).not.toHaveBeenCalled();
  });
});
