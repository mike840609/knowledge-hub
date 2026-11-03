import { describe, expect, it } from "vitest";
import { FeedbackReportQueryService } from "@/modules/personal/application/feedback-report-query-service";
import type { FeedbackIssueRecord, FeedbackIssueStoreFilter, FeedbackReportStore } from "@/modules/personal/ports/feedback-report-store";
import { fixtureCaller, fixtureIdentity } from "../fixtures/knowledge";

function record(n: number, userId = fixtureIdentity.id): FeedbackIssueRecord {
  return {
    id: `0199f400-0000-7000-8000-${String(n).padStart(12, "0")}`, userId, empId: userId === fixtureIdentity.id ? fixtureIdentity.emp_id : "OTHER",
    userName: "Reporter", category: "Sync", description: `report ${n}`, pagePath: "/w/x/issues",
    status: "OPEN", createdAt: new Date(2026, 10, 3, 0, 0, n),
  };
}
class FakeStore implements FeedbackReportStore {
  calls: Array<{ filter: FeedbackIssueStoreFilter; limit: number }> = [];
  constructor(private readonly rows: FeedbackIssueRecord[]) {}
  async appendWithinLimit() { return null; }
  async listPage(filter: FeedbackIssueStoreFilter, limit: number) { this.calls.push({ filter, limit }); return this.rows.slice(0, limit); }
}

describe("FeedbackReportQueryService.list", () => {
  it("asks for one row beyond the page and returns the last shown row as the cursor", async () => {
    const store = new FakeStore(Array.from({ length: 51 }, (_, i) => record(i + 1)));
    const page = await new FeedbackReportQueryService(store).list(fixtureCaller(), {});
    expect(store.calls[0].limit).toBe(51);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).toEqual({ createdAt: page.items[49].createdAt, id: page.items[49].id });
  });

  it("returns no cursor when the page is not full", async () => {
    const page = await new FeedbackReportQueryService(new FakeStore([record(1)])).list(fixtureCaller(), {});
    expect(page.nextCursor).toBeNull();
  });

  it("filters by the trusted caller only when mine is asked for, and never sends userId onward", async () => {
    const store = new FakeStore([record(1), record(2, "0199f400-0000-7000-8000-000000000999")]);
    const page = await new FeedbackReportQueryService(store).list(fixtureCaller(), { mine: "true" });
    expect(store.calls[0].filter.userId).toBe(fixtureIdentity.id);
    expect(page.items.map(i => i.isMine)).toEqual([true, false]);
    expect(page.items[0]).not.toHaveProperty("userId");
  });

  it("rejects a malformed filter before reading", async () => {
    const store = new FakeStore([]);
    await expect(new FeedbackReportQueryService(store).list(fixtureCaller(), { status: "CLOSED" }))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(store.calls).toHaveLength(0);
  });
});
