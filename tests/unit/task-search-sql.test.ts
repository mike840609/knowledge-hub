import { describe, expect, it } from "vitest";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import { buildTaskSearchSql } from "@/infrastructure/database/mariadb/repositories/task-search-sql";

const workspaceId = "019a1e18-7a00-7000-8000-0a0000000002";
const ownerUserId = "019a1e18-7a00-7000-8000-0a0000000004";
const taskId = "019a1e18-7a00-7000-8000-0a0000000001";

describe("owner-scoped task search SQL", () => {
  it("scopes in SQL before disclosure and searches every AND term in title or body", () => {
    const query = parseTaskSearchQuery({
      q: "安全 100%_!", agent: "opencode", verification: "passed",
      from: "2026-11-01", to: "2026-11-06", offset: "480",
    });
    const { sql, params } = buildTaskSearchSql(workspaceId, ownerUserId, query, null, 51);
    expect(sql).toContain("max_statement_time=5");
    expect(sql).toContain("b.workspace_id = ? AND b.owner_user_id = ?");
    expect(sql).toContain("p.revision_no = t.latest_revision_no");
    expect(sql).toContain("t.lifecycle = ?");
    expect(sql).toContain("p.agent = ?");
    expect(sql).toContain("p.verification_status = ?");
    expect(sql).toContain("p.completed_at_epoch_ms >= ?");
    expect(sql).toContain("p.completed_at_epoch_ms < ?");
    expect(sql).toContain("LIKE ? ESCAPE '!'");
    expect(sql.match(/LIKE \? ESCAPE '!'/g)).toHaveLength(4);
    expect(params).toEqual([
      workspaceId, ownerUserId, "ACTIVE", "opencode", "passed",
      Date.parse("2026-10-31T16:00:00.000Z"),
      Date.parse("2026-11-06T16:00:00.000Z"),
      "%安全%", "%安全%", "%100!%!_!!%", "%100!%!_!!%", 51,
    ]);
    expect(sql).not.toContain("100%_!");
  });

  it("uses deterministic composite DESC keyset bounds without losing the owner scope", () => {
    const query = parseTaskSearchQuery({ archived: "1" });
    const { sql, params } = buildTaskSearchSql(workspaceId, ownerUserId, query, {
      completedAtEpochMs: 1793955000000, taskResultId: taskId,
    }, 51);
    expect(sql).toContain("p.completed_at_epoch_ms DESC, t.id DESC LIMIT ?");
    expect(sql).toContain("(p.completed_at_epoch_ms < ? OR (p.completed_at_epoch_ms = ? AND t.id < ?))");
    expect(params).toEqual([workspaceId, ownerUserId, "ARCHIVED",1793955000000,1793955000000,taskId,51]);
  });
});

