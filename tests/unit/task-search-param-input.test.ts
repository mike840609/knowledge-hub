import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/domain/errors";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";

describe("task search query rejects non-scalar URL values safely", () => {
  it.each([
    ["q array", { q: ["search", "other"] }],
    ["q number", { q: 123 }],
    ["from array", { from: ["2026-11-01"] }],
    ["to array", { to: ["2026-11-01"] }],
    ["offset array", { offset: ["480"] }],
    ["agent array", { agent: ["opencode"] }],
    ["verification array", { verification: ["passed"] }],
    ["archived array", { archived: ["1"] }],
  ])("%s produces a typed validation error, not an uncaught TypeError", (_name, input) => {
    try {
      parseTaskSearchQuery(input as Parameters<typeof parseTaskSearchQuery>[0]);
      throw new Error("Expected the parser to reject a non-scalar value.");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("INVALID_TASK_SEARCH");
    }
  });
});
