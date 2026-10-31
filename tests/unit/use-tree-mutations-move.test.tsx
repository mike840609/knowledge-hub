// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: vi.fn(),
  request: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  usePathname: () => "/w/w1/knowledge/s1/d1",
  useParams: () => ({ workspaceId: "w1" }),
}));
// The real hook reads the provider; without one it throws, and the test only wants the request it makes.
vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/components/workspaces/governance-error", () => ({
  governanceRequest: mocks.request,
  // A code organizeFailure has no sentence for, so the server's own words come through.
  governanceFailure: (error: unknown) => ({ code: "TEST_REFUSAL", message: (error as Error).message }),
}));

import { useTreeMutations, type MoveNodeInput, type TreeMutations } from "@/components/knowledge/use-tree-mutations";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const request = mocks.request;
const toast = mocks.toast;

/** The hook needs a component to live in; this one hands its `moveNode` to the test. */
const harness: { moveNode: TreeMutations["moveNode"] | null } = { moveNode: null };

function Harness() {
  harness.moveNode = useTreeMutations().moveNode;
  return null;
}

let root: Root;
let container: HTMLElement;
beforeEach(async () => {
  request.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  mocks.refresh.mockReset();
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  harness.moveNode = null;
});

function move(input: MoveNodeInput, report?: "dialog" | "toast") {
  if (!harness.moveNode) throw new Error("The harness did not render.");
  return harness.moveNode(input, report);
}

const input: MoveNodeInput = {
  nodeId: "n1",
  label: "B",
  from: { parentId: null, position: 0 },
  to: { parentId: "f1", label: "F" },
};

describe("the move request", () => {
  it("sends the destination position when there is one, and omits it when there is not", async () => {
    await move({ ...input, to: { parentId: "f1", label: "F", position: 2 } });
    expect(request).toHaveBeenCalledWith("/api/tree-nodes/n1", "PATCH", { parentId: "f1", position: 2 });
    await move(input);
    expect(request).toHaveBeenLastCalledWith("/api/tree-nodes/n1", "PATCH", { parentId: "f1" });
  });

  it("toasts a refusal only when the drag surface asks it to", async () => {
    request.mockRejectedValueOnce(new Error("no"));
    expect(await move(input, "dialog")).toEqual({ ok: false, message: "no" });
    expect(toast).not.toHaveBeenCalled();
    request.mockRejectedValueOnce(new Error("no"));
    expect(await move(input, "toast")).toEqual({ ok: false, message: "no" });
    expect(toast).toHaveBeenCalledWith({ message: "no", tone: "danger" });
  });
});
