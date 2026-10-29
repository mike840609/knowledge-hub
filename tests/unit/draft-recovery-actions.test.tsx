// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  request: vi.fn(async () => undefined),
  download: vi.fn(),
  writeText: vi.fn(async () => undefined),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/lib/download-markdown", () => ({ downloadMarkdown: mocks.download }));
vi.mock("@/components/workspaces/governance-error", () => ({
  governanceRequest: mocks.request,
  governanceFailure: (error: unknown) => ({ code: "REQUEST_FAILED", message: String(error) }),
}));

import { DraftRecoveryActions } from "@/components/knowledge/draft-recovery-actions";
import { parseGenericMarkdownText } from "@/modules/sources/adapters/generic-markdown-folder-adapter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLElement;

beforeEach(() => {
  mocks.push.mockReset();
  mocks.refresh.mockReset();
  mocks.toast.mockReset();
  mocks.request.mockReset().mockResolvedValue(undefined);
  mocks.download.mockReset();
  mocks.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.writeText } });
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function button(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(candidate => candidate.textContent?.includes(label));
  if (!found) throw new Error(`No button containing ${label}`);
  return found;
}

async function render(canRestore = true) {
  await act(async () => root.render(
    <DraftRecoveryActions workspaceId="ws" sourceId="src" documentId="doc" title="Draft" markdown="# Unsaved body" canRestore={canRestore} />,
  ));
}

it("restores the original document and returns to it", async () => {
  await render();
  await act(async () => button("Restore document").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(mocks.request).toHaveBeenCalledWith("/api/documents/doc/restore", "POST");
  expect(mocks.push).toHaveBeenCalledWith("/w/ws/knowledge/src/doc");
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith({ message: "Restored “Draft”." });
});

it("downloads and copies the draft", async () => {
  await render();
  await act(async () => button("Download draft").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const [title, markdown, options] = mocks.download.mock.calls[0] as unknown as [string, string, { recovery: boolean }];
  const parsed = parseGenericMarkdownText({ sourcePath: "Draft.kh-recovery.md", text: markdown, sourceFileHash: "hash" });
  expect(title).toBe("Unsaved body");
  expect(options.recovery).toBe(true);
  expect(parsed.markdown).toBe("# Unsaved body");
  await act(async () => button("Copy text").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(mocks.writeText).toHaveBeenCalledWith("# Unsaved body");
  expect(mocks.toast).toHaveBeenCalledWith({ message: "Draft copied." });
});

it("downloads the draft title and base metadata so they survive upload", async () => {
  await act(async () => root.render(<DraftRecoveryActions workspaceId="ws" sourceId="src" documentId="doc" title="Project / Notes" markdown="Body" metadata={{ title: 42, owner: "team" }} canRestore={false} />));
  await act(async () => button("Download draft").dispatchEvent(new MouseEvent("click", { bubbles: true })));
  const [title, markdown, options] = mocks.download.mock.calls[0] as unknown as [string, string, { recovery: boolean }];
  const parsed = parseGenericMarkdownText({ sourcePath: "Project _ Notes.kh-recovery.md", text: markdown, sourceFileHash: "hash" });
  expect(title).toBe("Project / Notes");
  expect(options.recovery).toBe(true);
  expect(parsed.resolvedTitle).toBe("Project / Notes");
  expect(parsed.metadata).toEqual({ title: 42, owner: "team" });
  expect(parsed.markdown).toBe("Body");
});

it("does not offer restore without permission", async () => {
  await render(false);
  expect(container.textContent).not.toContain("Restore document");
  expect(container.textContent).toContain("Download draft");
});
