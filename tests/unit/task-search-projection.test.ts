import { describe, expect, it } from "vitest";
import { parseTaskArtifact } from "@/modules/task-knowledge/domain/task-artifact";
import { projectTaskSearch } from "@/modules/task-knowledge/domain/task-search-projection";

const base = {
  schemaVersion: 1,
  taskId: "d744a789-0561-409b-8dbb-a65a94828c39",
  artifactRevision: 3,
  agent: "opencode",
  status: "completed",
  title: "Search task",
  summary: "Relevant summary",
  completedAt: "2026-11-06T09:00:00.123456789+08:00",
  verification: { status: "passed", checks: ["do-not-search-this"] },
  findings: ["Found 文檔"],
  decisions: ["Use MariaDB"],
  changes: ["Update code"],
  references: [{ type: "COMMIT", id: "abcdef0123" }],
};

describe("task search projection", () => {
  it("indexes latest revision fields without verification checks or references", () => {
    const projection = projectTaskSearch("019a1e18-7a00-7000-8000-0a0000000001", parseTaskArtifact(base));
    expect(projection).toMatchObject({
      taskResultId: "019a1e18-7a00-7000-8000-0a0000000001",
      revisionNo: 3,
      agent: "opencode",
      verificationStatus: "passed",
      title: "Search task",
      summary: "Relevant summary",
      completedAtEpochMs: Date.parse("2026-11-06T01:00:00.123Z"),
    });
    expect(projection.searchBody).toContain("Relevant summary");
    expect(projection.searchBody).toContain("Found 文檔");
    expect(projection.searchBody).toContain("Use MariaDB");
    expect(projection.searchBody).toContain("Update code");
    expect(projection.searchBody).not.toContain("do-not-search-this");
    expect(projection.searchBody).not.toContain("abcdef0123");
  });

  it("normalizes existing accepted timestamps even when UTC falls beyond DATETIME(6)", () => {
    for (const completedAt of ["0001-01-01T00:00:00Z", "0000-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:00"]) {
      const data = parseTaskArtifact({ ...base, completedAt });
      const projection = projectTaskSearch("019a1e18-7a00-7000-8000-0a0000000001", data);
      expect(projection.completedAtEpochMs).toBe(Date.parse(completedAt));
      expect(Number.isSafeInteger(projection.completedAtEpochMs)).toBe(true);
    }
  });

  it("uses a stable UTC millisecond tie without rounding fractional nanoseconds", () => {
    const before = projectTaskSearch("019a1e18-7a00-7000-8000-0a0000000001", parseTaskArtifact({ ...base, completedAt: "2026-01-01T00:00:00.001999999Z" }));
    expect(before.completedAtEpochMs).toBe(Date.parse("2026-01-01T00:00:00.001Z"));
  });
});

