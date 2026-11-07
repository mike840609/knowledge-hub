import { describe, expect, it, vi, afterEach } from "vitest";
import { TaskResultReadService } from "@/modules/task-knowledge/application/read-task-results";
import { buildTaskSearchPreview } from "@/modules/task-knowledge/domain/task-search-preview";
import { MariaDbTaskExportStore } from "@/infrastructure/database/mariadb/repositories/task-knowledge";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "@/modules/task-knowledge/ports/unit-of-work";

afterEach(() => vi.unstubAllEnvs());

describe("code-review fixes: invalid search scope", () => {
  it("can authorize a My Space without touching either list read query", async () => {
    const scope = vi.fn(async () => ({kind:"PERSONAL", status:"ACTIVE", ownerUserId:"019a1e18-7a00-7000-8000-0a0000000004"}));
    const listTasks = vi.fn();const searchTasks = vi.fn();
    const repos = {workspaces:{lockSharedById:scope},taskExports:{listTasks,searchTasks}} as unknown as TaskKnowledgeRepositories;
    const uow={run: async <T>(fn:(r:TaskKnowledgeRepositories)=>Promise<T>)=>fn(repos)} as TaskKnowledgeUnitOfWork;
    const service = new TaskResultReadService(uow);
    const owner=callerFromIdentity({id:"019a1e18-7a00-7000-8000-0a0000000004",kind:"USER"} as never);
    await service.assertOwnedMySpace(owner,"019a1e18-7a00-7000-8000-0a0000000002");
    expect(scope).toHaveBeenCalledTimes(1);
    expect(listTasks).not.toHaveBeenCalled();
    expect(searchTasks).not.toHaveBeenCalled();
  });
});

describe("code-review fixes: meaningful excerpts",()=>{
  it("extracts the exact matching context from findings after long summary",()=>{
    const summary="Boring prefix ".repeat(30);
    const body=summary+"\n"+ "Decision: expose the bounded security audit record to the owner";
    const snippet=buildTaskSearchPreview(summary,body,["security"]);
    expect(snippet.toLowerCase()).toContain("security audit");
    expect(snippet.length).toBeLessThanOrEqual(200);
  });
  it("uses matching segment later in a long summary",()=>{
    const summary="unimportant ".repeat(35)+"searchneedle is found here";
    expect(buildTaskSearchPreview(summary,summary,["searchneedle"])).toContain("searchneedle");
  });
  it.each(["findings", "decisions", "changes"])("shows hit context from %s", (field) => {
    const base = "Unrelated summary.";
    const content = base + "\n" + field + ": matched securething for the task.";
    expect(buildTaskSearchPreview(base, content, ["securething"])).toContain("securething");
  });

  it("keeps the normal summary preview without a query and does not interpret HTML",()=>{
    expect(buildTaskSearchPreview("<script>alert(1)</script>","<script>alert(1)</script>",[])).toBe("<script>alert(1)</script>");
  });
});
describe("code-review fixes: lifecycle count timeout",()=>{
  it("maps MariaDB 1969 timeout to retryable task-search error",async()=>{
    const conn={query: async()=>{throw {errno:1969,sql:"secret query"};}} as unknown as QueryConnection;
    await expect(new MariaDbTaskExportStore(conn).hasTasksInLifecycle("ws","owner","ACTIVE"))
      .rejects.toMatchObject({code:"TASK_SEARCH_UNAVAILABLE"});
  });
});


describe("code-review fixes: empty lifecycle excludes staging rows", () => {
  it("only regards committed revisions as existing Tasks", async () => {
    let capturedSql = "";
    const connection = {
      query: async (sql: string) => {
        capturedSql = sql;
        return [{ has_tasks: 0 }];
      },
    } as unknown as QueryConnection;
    expect(await new MariaDbTaskExportStore(connection).hasTasksInLifecycle("ws","owner","ACTIVE")).toBe(false);
    expect(capturedSql).toContain("t.latest_revision_no > 0");
  });
});
