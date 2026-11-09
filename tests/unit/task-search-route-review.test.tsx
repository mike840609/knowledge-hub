import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DomainError } from "@/shared/domain/errors";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  assertOwnedMySpace: vi.fn(),
  redirect: vi.fn((url: string) => { throw new Error("REDIRECT:" + url); }),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
}));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: { identity: { id: "owner" } } }),
    taskResults: { list: mocks.list, assertOwnedMySpace: mocks.assertOwnedMySpace },
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound, redirect: mocks.redirect, useRouter: () => ({replace: vi.fn()}),
}));
import TasksPage from "@/app/w/[workspaceId]/tasks/page";

const ws = "019a1e18-7a00-7000-8000-0a0000000002";
function render(query: Record<string, string | string[] | undefined>) {
  return TasksPage({ params: Promise.resolve({ workspaceId: ws }), searchParams: Promise.resolve(query) })
    .then((element) => renderToStaticMarkup(element));
}
beforeEach(() => {
  vi.stubEnv("TASK_SEARCH_READ_ENABLED", "true");
  mocks.list.mockReset();
  mocks.assertOwnedMySpace.mockReset().mockResolvedValue(undefined);
  mocks.redirect.mockClear();mocks.notFound.mockClear();
  mocks.list.mockResolvedValue({items:[], nextCursor:null, hasTasksInLifecycle:true, resetCursor:false});
});
afterEach(() => vi.unstubAllEnvs());

describe("Task Search server route guard", () => {
  it.each([
    {q:"x".repeat(201)}, {from:"2026-02-30"}, {verification:["passed","failed"]},
  ])("does not execute Tasks list search for invalid URL criteria", async (query) => {
    const html=await render(query);
    expect(html).toContain("role=\"alert\"");
    expect(mocks.assertOwnedMySpace).toHaveBeenCalledTimes(1);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(html).not.toContain("No matching tasks");
  });
  it("does not disclose foreign workspace error details on invalid query", async () => {
    mocks.assertOwnedMySpace.mockRejectedValueOnce(new DomainError("WORKSPACE_NOT_FOUND","Workspace not found."));
    await expect(render({q:"x".repeat(201)})).rejects.toThrow("NOT_FOUND");
    expect(mocks.list).not.toHaveBeenCalled();
  });
  it("shows the setup state without a search form when the workspace has no Tasks", async () => {
    mocks.list.mockResolvedValueOnce({items:[],nextCursor:null,hasTasksInLifecycle:false,resetCursor:false});
    const html = await render({});
    expect(html).not.toContain('aria-label="Task search and filters"');
    expect(html).toContain("No tasks yet");
    expect(html).toContain("Set up task export");
    expect(html).toContain("Archived");
  });
  it("removes invalid cursor from bookmark after authorized read", async()=>{
    mocks.list.mockResolvedValueOnce({items:[],nextCursor:null,hasTasksInLifecycle:true,resetCursor:true});
    await expect(render({q:"security",cursor:"malformed"})).rejects.toThrow("REDIRECT:");
    expect(mocks.redirect).toHaveBeenCalledWith("/w/"+ws+"/tasks?q=security");
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
});

