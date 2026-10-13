import { describe, expect, it } from "vitest";
import { FeedbackReportService } from "@/modules/personal/application/feedback-report-service";
import { parseFeedbackReport } from "@/modules/personal/domain/feedback-report";
import type { FeedbackReportStore, NewFeedbackReport } from "@/modules/personal/ports/feedback-report-store";
import { fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

const valid = { category: "Sync", description: "  Preview failed  ", pagePath: "/w/personal/sources" };
class MemoryStore implements FeedbackReportStore {
  reports: NewFeedbackReport[] = [];
  async appendWithinLimit(report: NewFeedbackReport, since: Date, limit: number) {
    if (this.reports.filter(r => r.userId === report.userId && r.createdAt > since).length >= limit) return null;
    this.reports.push(report);
    return `report-${this.reports.length}`;
  }
}

describe("parseFeedbackReport", () => {
  it("keeps what the reporter wrote, trimmed", () => {
    expect(parseFeedbackReport(valid)).toEqual({ category: "Sync", description: "Preview failed", pagePath: "/w/personal/sources" });
  });
  it.each([
    ["an identity field from the browser", { ...valid, empId: "SOMEONE-ELSE" }],
    ["a missing field", { category: "Sync", description: "x" }],
    ["an unknown category", { ...valid, category: "Billing" }],
    ["an empty description", { ...valid, description: "   " }],
    ["a description over 5000 characters", { ...valid, description: "x".repeat(5001) }],
    ["a page path with a query", { ...valid, pagePath: "/s/abc?token=1" }],
    ["a page path with a fragment", { ...valid, pagePath: "/w/x#y" }],
    ["an absolute URL", { ...valid, pagePath: "https://example.com/w" }],
    ["an over-long page path", { ...valid, pagePath: "/" + "a".repeat(1024) }],
    ["an array", [valid]],
  ])("rejects %s", (_name, body) => {
    expect(() => parseFeedbackReport(body)).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});

describe("FeedbackReportService", () => {
  it("records the sender's emp_id and name from the caller, not the request", async () => {
    const store = new MemoryStore();
    const now = new Date("2026-10-13T08:00:00Z");
    await expect(new FeedbackReportService(store, () => now).submit(fixtureCaller(), valid)).resolves.toEqual({ id: "report-1" });
    expect(store.reports).toEqual([{ userId: fixtureIdentity.id, empId: fixtureIdentity.emp_id, userName: fixtureIdentity.name, category: "Sync", description: "Preview failed", pagePath: "/w/personal/sources", createdAt: now }]);
  });
  it("limits a user to 20 reports in a rolling hour", async () => {
    const store = new MemoryStore();
    let now = new Date("2026-10-13T08:00:00Z");
    const service = new FeedbackReportService(store, () => now);
    for (let i = 0; i < 20; i += 1) await service.submit(fixtureCaller(), valid);
    await expect(service.submit(fixtureCaller(), valid)).rejects.toMatchObject({ code: "FEEDBACK_RATE_LIMITED" });
    now = new Date("2026-10-13T09:00:01Z");
    await expect(service.submit(fixtureCaller(), valid)).resolves.toEqual({ id: "report-21" });
  });
});
