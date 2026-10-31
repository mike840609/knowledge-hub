import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  shell: vi.fn(),
  folder: vi.fn(),
  document: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
}));
vi.mock("@/server/knowledge-read", () => ({
  getWorkspaceShellModel: mocks.shell,
  findHubFolderLabel: mocks.folder,
  findReadableDocumentHref: mocks.document,
}));
vi.mock("@/components/knowledge/new-document-form", () => ({
  NewDocumentForm: () => null,
}));

import NewNotePage from "@/app/w/[workspaceId]/knowledge/new/page";

function shell(type: "PERSONAL" | "TEAM", canWrite: boolean) {
  return {
    identityId: "u1",
    workspace: { id: "w1", name: "Workspace", type, lifecycleState: "ACTIVE" },
    access: { actions: { canWrite } },
  };
}

const params = { params: Promise.resolve({ workspaceId: "w1" }) };

beforeEach(() => {
  mocks.shell.mockReset();
  mocks.folder.mockReset();
  mocks.document.mockReset();
});

describe("new document page", () => {
  it("is not found in a team even for an editor who may write", async () => {
    mocks.shell.mockResolvedValue(shell("TEAM", true));
    await expect(NewNotePage({ ...params, searchParams: Promise.resolve({}) }))
      .rejects.toThrow("not found");
    expect(mocks.folder).not.toHaveBeenCalled();
  });

  it("still renders for a personal owner", async () => {
    mocks.shell.mockResolvedValue(shell("PERSONAL", true));
    const result = await NewNotePage({
      ...params,
      searchParams: Promise.resolve({ title: "A note" }),
    });
    expect(result).toBeTruthy();
  });
});
