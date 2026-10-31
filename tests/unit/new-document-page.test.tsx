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
  it("still renders for a team editor, but offers no UI entry to it", async () => {
    // URL-only residual: the page and create service stay for the approved
    // composer flow, while every team surface hides the authoring entries.
    mocks.shell.mockResolvedValue(shell("TEAM", true));
    const result = await NewNotePage({ ...params, searchParams: Promise.resolve({}) });
    expect(result).toBeTruthy();
  });

  it("is not found in a team without write access", async () => {
    mocks.shell.mockResolvedValue(shell("TEAM", false));
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
