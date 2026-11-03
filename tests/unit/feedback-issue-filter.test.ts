import { describe, expect, it } from "vitest";
import { parseFeedbackIssueFilter } from "@/modules/personal/domain/feedback-report";

const cursorId = "0199f400-0000-7000-8000-000000000001";

describe("parseFeedbackIssueFilter", () => {
  it("defaults to everyone, every status, newest page", () => {
    expect(parseFeedbackIssueFilter({})).toEqual({ mineOnly: false });
    expect(parseFeedbackIssueFilter({ status: "", category: "", mine: "" })).toEqual({ mineOnly: false });
  });

  it("reads the filters and a composite cursor", () => {
    expect(parseFeedbackIssueFilter({
      status: "RESOLVED", category: "Search", mine: "true",
      beforeAt: "2026-11-03T01:02:03.000Z", beforeId: cursorId,
    })).toEqual({
      status: "RESOLVED", category: "Search", mineOnly: true,
      before: { createdAt: new Date("2026-11-03T01:02:03.000Z"), id: cursorId },
    });
  });

  it.each([
    ["an unknown status", { status: "CLOSED" }],
    ["an unknown category", { category: "Billing" }],
    ["a cursor without its id", { beforeAt: "2026-11-03T01:02:03.000Z" }],
    ["a cursor without its time", { beforeId: cursorId }],
    ["a cursor time that is not a date", { beforeAt: "yesterday", beforeId: cursorId }],
    ["a cursor id that is not a UUID", { beforeAt: "2026-11-03T01:02:03.000Z", beforeId: "1" }],
  ])("rejects %s", (_name, input) => {
    expect(() => parseFeedbackIssueFilter(input)).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});
