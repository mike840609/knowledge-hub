import { beforeEach, describe, expect, it, vi } from "vitest";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";
import type { WorkspaceShellModel } from "@/server/knowledge-read";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));
vi.mock("@/server/knowledge-read", () => ({ getWorkspaceShellModel: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { getWorkspaceShellModel } from "@/server/knowledge-read";
import { getDraftRecoveryModel } from "@/server/draft-read";

type Services = ReturnType<typeof ApplicationServicesFn>;

const WORKSPACE_ID = "0199f400-0000-7000-8000-0000000005a1";
const SOURCE_ID = "0199f400-0000-7000-8000-0000000005a2";
const DOCUMENT_ID = "0199f400-0000-7000-8000-0000000005a3";
const caller = { identity: { id: "0199f400-0000-7000-8000-0000000005a4" } } as never;

const DRAFT = {
  key: `draft:${DOCUMENT_ID}`,
  value: { title: "Draft", markdown: "# Unsaved body", baseRevisionId: null },
  version: 2,
  updatedAt: "2026-10-24T00:00:00.000Z",
};

function document(overrides: Record<string, unknown> = {}) {
  return {
    documentId: DOCUMENT_ID,
    sourceId: SOURCE_ID,
    workspaceId: WORKSPACE_ID,
    status: "ARCHIVED",
    currentRevision: { title: "Draft" },
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: SOURCE_ID,
    workspaceId: WORKSPACE_ID,
    name: "Source",
    sourceType: "HUB",
    status: "ACTIVE",
    ownership: "HUB_MANAGED",
    syncVersion: 1,
    ...overrides,
  };
}

function fakeServices(overrides: {
  get?: () => Promise<unknown>;
  getDocument?: () => Promise<unknown>;
  getSource?: () => Promise<unknown>;
} = {}) {
  const personal = { get: vi.fn(overrides.get ?? (async () => DRAFT)) };
  const getDocument = vi.fn(overrides.getDocument ?? (async () => document()));
  const getSource = vi.fn(overrides.getSource ?? (async () => source()));
  const services = {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    personal,
    queries: { getDocument, getSource },
  } as unknown as Services;
  vi.mocked(applicationServices).mockReturnValue(services);
  return { personal, getDocument, getSource };
}

function fakeShell(canWrite = true, lifecycleState: "ACTIVE" | "ARCHIVED" = "ACTIVE") {
  vi.mocked(getWorkspaceShellModel).mockResolvedValue({
    access: { actions: { canWrite }, workspace: { lifecycleState } },
  } as unknown as WorkspaceShellModel);
}

beforeEach(() => {
  vi.mocked(applicationServices).mockReset();
  vi.mocked(getWorkspaceShellModel).mockReset();
  fakeShell();
});

describe("draft recovery model", () => {
  it("returns the draft and a restoreable archived document", async () => {
    fakeServices();
    const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model).toMatchObject({
      draft: { title: "Draft", markdown: "# Unsaved body" },
      document: { status: "ARCHIVED", sourceStatus: "ACTIVE", ownership: "HUB_MANAGED" },
      canRestore: true,
      sourceArchived: false,
    });
  });

  it("does not offer restore when the source is archived", async () => {
    fakeServices({ getSource: async () => source({ status: "ARCHIVED" }) });
    const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model).toMatchObject({ canRestore: false, sourceArchived: true });
  });

  it("does not offer restore without document.write", async () => {
    fakeShell(false);
    fakeServices();
    const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model?.canRestore).toBe(false);
    expect(model?.canWrite).toBe(false);
  });

  it("does not offer restore for a source-managed document", async () => {
    fakeServices({ getSource: async () => source({ ownership: "SOURCE_MANAGED" }) });
    const model = await getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID);
    expect(model?.canRestore).toBe(false);
  });

  it("returns null when the route source does not match the document", async () => {
    fakeServices();
    await expect(getDraftRecoveryModel(WORKSPACE_ID, "another-source", DOCUMENT_ID)).resolves.toBeNull();
  });

  it("returns null when the draft is gone", async () => {
    fakeServices({ get: async () => ({ key: `draft:${DOCUMENT_ID}`, value: null, version: 0, updatedAt: "" }) });
    await expect(getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).resolves.toBeNull();
  });

  it("rethrows a transient read failure", async () => {
    fakeServices({ getDocument: async () => { throw new Error("connect ETIMEDOUT"); } });
    await expect(getDraftRecoveryModel(WORKSPACE_ID, SOURCE_ID, DOCUMENT_ID)).rejects.toThrow("connect ETIMEDOUT");
  });
});
