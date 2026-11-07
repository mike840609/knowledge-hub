import { afterEach, describe, expect, it, vi } from "vitest";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { TaskResultReadService } from "@/modules/task-knowledge/application/read-task-results";
import { parseTaskSearchQuery } from "@/modules/task-knowledge/domain/task-search-query";
import type { TaskKnowledgeRepositories, TaskKnowledgeUnitOfWork } from "@/modules/task-knowledge/ports/unit-of-work";

const workspaceId = "019a1e18-7a00-7000-8000-0a0000000002";
const ownerUserId = "019a1e18-7a00-7000-8000-0a0000000004";
const caller = { identity: { id: ownerUserId } } as CallerContext;

function fakeRead() {
  const listTasks = vi.fn(async () => []);
  const searchTasks = vi.fn(async () => []);
  const hasTasksInLifecycle = vi.fn(async () => true);
  const repositories = {
    workspaces: { lockSharedById: async () => ({ workspaceId, kind: "PERSONAL", status: "ACTIVE", ownerUserId }) },
    taskExports: { listTasks, searchTasks, hasTasksInLifecycle },
  } as unknown as TaskKnowledgeRepositories;
  const uow: TaskKnowledgeUnitOfWork = { run: async <T>(fn: (r: TaskKnowledgeRepositories) => Promise<T>) => fn(repositories) };
  return { service: new TaskResultReadService(uow), listTasks, searchTasks, hasTasksInLifecycle };
}
afterEach(() => vi.unstubAllEnvs());

describe("task search read cutover", () => {
  it("retains existing Tasks SQL while read cutover flag is off", async () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "false");
    const f = fakeRead();
    const page = await f.service.list(caller, workspaceId, { search: parseTaskSearchQuery({q: "not found"}) });
    expect(page.items).toEqual([]);
    expect(f.listTasks).toHaveBeenCalledTimes(1);
    expect(f.searchTasks).not.toHaveBeenCalled();
    expect(page.nextCursor).toBeNull();
  });

  it("with flag on, confines search to the owned My Space and distinguishes no matches from empty", async () => {
    vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
    const f = fakeRead();
    const query = parseTaskSearchQuery({q: "安全", archived:"1"});
    const page = await f.service.list(caller, workspaceId, { search: query, cursor:"broken" });
    expect(f.listTasks).not.toHaveBeenCalled();
    expect(f.searchTasks).toHaveBeenCalledWith(workspaceId, ownerUserId, query, null, 51);
    expect(f.hasTasksInLifecycle).toHaveBeenCalledWith(workspaceId, ownerUserId, "ARCHIVED");
    expect(page).toMatchObject({items:[], nextCursor:null, hasTasksInLifecycle:true, resetCursor:true});
  });
});

