import { describe, expect, it } from "vitest";
import { migrations } from "@/infrastructure/database/mariadb/migrations";

describe("task search projection migration contract", () => {
  it("registers the next unique migration after Task Knowledge Export", () => {
    expect(migrations.filter((item) => item.name === "task-result-search")).toHaveLength(1);
    expect(migrations.find((item) => item.name === "task-result-search")).toMatchObject({ version: 34, name: "task-result-search" });
    expect(new Set(migrations.map((m) => m.version)).size).toBe(migrations.length);
  });

  it("defers the speculative global sort index until scoped SQL is available for EXPLAIN", () => {
    const tableSql = migrations.find((m) => m.name === "task-result-search")?.statements.join("\n") ?? "";
    expect(tableSql).not.toContain("idx_task_search_completed");
  });

  it("creates one task-scoped, time-sortable row without duplicated owner authorization", () => {
    const sql = migrations.find((m) => m.name === "task-result-search")?.statements.join("\n") ?? "";
    expect(sql).toContain("CREATE TABLE task_result_search");
    expect(sql).toContain("task_result_id UUID NOT NULL");
    expect(sql).toContain("completed_at_epoch_ms BIGINT");
    expect(sql).toContain("search_body MEDIUMTEXT");
    expect(sql).toContain("FOREIGN KEY (task_result_id) REFERENCES task_results(id)");
    expect(sql).not.toMatch(/\b(owner_user_id|workspace_id)\b/i);
  });
});

