import { beforeEach, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { FeedbackReportService } from "@/modules/personal/application/feedback-report-service";
import type { NewFeedbackReport } from "@/modules/personal/ports/feedback-report-store";
const injected = vi.hoisted(() => ({ reports: [] as unknown[] }));
vi.mock("@/server/composition", () => ({ applicationServices: () => ({
  establishTrustedCaller: async () => ({ caller: callerFromIdentity({ id: "u1", emp_id: "E001", name: "Ada", org_code: "ORG" }) }),
  feedbackReports: new FeedbackReportService({ appendWithinLimit: async (report: NewFeedbackReport) => { injected.reports.push(report); return "r1"; } }),
}) }));
import { POST } from "@/app/api/feedback-reports/route";
const body = JSON.stringify({ category: "Sync", description: "Preview failed", pagePath: "/w/x/sources" });
beforeEach(() => { vi.stubEnv("KM_PUBLIC_ORIGIN", ""); injected.reports = []; });

it("stores a same-origin report under the caller's emp_id", async () => {
  const response = await POST(new Request("http://hub.test/api/feedback-reports", { method: "POST", headers: { origin: "http://hub.test", "content-type": "application/json" }, body }));
  expect(response.status).toBe(201);
  expect(await response.json()).toEqual({ id: "r1" });
  expect(injected.reports).toMatchObject([{ empId: "E001", userId: "u1", category: "Sync" }]);
});

it.each([["another site", { origin: "http://evil.test" }], ["no origin", {}]])("refuses a report from %s and stores nothing", async (_name, headers) => {
  // A cross-site form posts text/plain, which the route would otherwise read as JSON.
  const response = await POST(new Request("http://hub.test/api/feedback-reports", { method: "POST", headers: { ...headers, "content-type": "text/plain" }, body }));
  expect(response.status).toBe(403);
  expect(injected.reports).toEqual([]);
});
