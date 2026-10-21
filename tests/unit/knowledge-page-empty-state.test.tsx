import { beforeEach, expect, it, vi } from "vitest";
import { KnowledgeEmptyState } from "@/components/knowledge/knowledge-empty-state";
import { KnowledgeLayout } from "@/components/knowledge/knowledge-layout";
import WorkspaceKnowledgePage from "@/app/w/[workspaceId]/knowledge/page";
const mocks = vi.hoisted(() => ({ listSources: vi.fn(), defaultTarget: vi.fn(), explorer: vi.fn() }));
vi.mock("@/server/composition", () => ({ applicationServices: () => ({
  establishTrustedCaller: async () => ({ caller: { identity: { id: "user" } } }),
  workspaces: { listWorkspaces: async () => [{ id: "ws" }] },
  queries: { listSources: mocks.listSources },
}) }));
vi.mock("@/server/knowledge-read", () => ({ getDefaultKnowledgeTarget: mocks.defaultTarget, getKnowledgeExplorerModel: mocks.explorer }));
vi.mock("@/components/knowledge/knowledge-empty-state", () => ({ KnowledgeEmptyState: () => null }));
vi.mock("@/components/knowledge/knowledge-layout", () => ({ KnowledgeLayout: () => null }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, redirect: vi.fn() }));
beforeEach(() => { mocks.listSources.mockReset(); mocks.defaultTarget.mockReset(); mocks.explorer.mockReset(); });
it("propagates a failed source read to the page error boundary", async () => {
  const failure = new Error("Source read failed");
  mocks.listSources.mockRejectedValue(failure);
  await expect(WorkspaceKnowledgePage({ params: Promise.resolve({ workspaceId: "ws" }) })).rejects.toBe(failure);
  expect(mocks.defaultTarget).not.toHaveBeenCalled();
});
it("renders the first-use state only after a successful empty source read", async () => {
  mocks.listSources.mockResolvedValue([]);
  const result = await WorkspaceKnowledgePage({ params: Promise.resolve({ workspaceId: "ws" }) });
  // Inside the explorer, which has no source to show and offers the ways to add one.
  expect(result.type).toBe(KnowledgeLayout);
  expect(result.props).toMatchObject({ workspaceId: "ws", source: null, collections: [] });
  expect(result.props.children.type).toBe(KnowledgeEmptyState);
  expect(mocks.defaultTarget).not.toHaveBeenCalled();
});
