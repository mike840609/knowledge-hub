import { describe, expect, it } from "vitest";
import { planRevisionHistory } from "@/modules/knowledge/domain/revision-history";
import type { KnowledgeRevision } from "@/modules/knowledge/domain/revision";

const minute = 60_000;
const start = new Date("2026-10-17T00:00:00Z");
function working(lastMinute = 0): KnowledgeRevision {
  return { id: "head", documentId: "doc", revisionNo: 2, title: "Title", markdown: "body", metadata: {}, contentHash: "hash", createdBy: "author", createdAt: new Date(+start + lastMinute * minute), history: { state: "WORKING", activityId: "activity", windowStartedAt: start, name: null, reason: "AUTOSAVE" } };
}
function plan(current: KnowledgeRevision, elapsed: number, author = "author") {
  return planRevisionHistory(current, author, new Date(+start + elapsed * minute), "next", "AUTOSAVE");
}

describe("autosave revision history policy", () => {
  it("uses a fixed window despite continuous saves, checkpointing at exactly ten minutes", () => {
    let current = working();
    for (let elapsed = 0.5; elapsed < 10; elapsed += 0.5) {
      const result = plan(current, elapsed);
      expect(result.history.state).toBe("WORKING");
      expect(result.history.windowStartedAt).toEqual(start);
      expect(result.preserve).toBe(false);
      current = { ...current, createdAt: new Date(+start + elapsed * minute), history: result.history };
    }
    const result = plan(current, 10);
    expect(result.history.state).toBe("CHECKPOINT");
    expect(result.history.activityId).toBe("activity");
    expect(result.history.windowStartedAt).toEqual(new Date(+start + 10 * minute));
  });

  it("preserves an idle working head at exactly two minutes without splitting its activity", () => {
    expect(plan(working(), 2 - 1 / minute).preserve).toBe(false);
    const result = plan(working(), 2);
    expect(result).toMatchObject({ preserve: true, preserveReason: "IDLE", history: { state: "WORKING", activityId: "activity" } });
    expect(result.history.windowStartedAt).toEqual(new Date(+start + 2 * minute));
  });

  it("starts a new activity at one hour or on an author change", () => {
    expect(plan(working(), 60 - 1 / minute).history.activityId).toBe("activity");
    expect(plan(working(), 60).history.activityId).toBe("next");
    expect(plan(working(), 0.5, "other")).toMatchObject({ preserve: true, preserveReason: "AUTHOR", history: { activityId: "next" } });
  });

  it("preserves a working head before manual checkpoints and restores", () => {
    for (const mode of ["CHECKPOINT", "RESTORE"] as const) {
      const result = planRevisionHistory(working(), "author", start, "next", mode);
      expect(result.preserve).toBe(true);
      expect(result.history.state).toBe("CHECKPOINT");
      expect(result.history.reason).toBe(mode === "RESTORE" ? "RESTORE" : "MANUAL");
    }
    expect(planRevisionHistory(working(), "author", start, "next", "RESTORE").history.activityId).toBe("next");
  });
});
