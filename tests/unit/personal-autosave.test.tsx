// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GovernanceRequestError } from "@/components/workspaces/governance-error";
import { DocumentComposer } from "@/components/knowledge/document-composer";
const mocks = vi.hoisted(() => ({ push: vi.fn(), save: vi.fn(), change: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => "/edit" }));
vi.mock("next/dynamic", () => ({ default: () => function Fallback({ onFail }: { onFail: () => void }) { useEffect(onFail, []); return null; } }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ confirmed: true, access: { workspace: { id: "w", type: "PERSONAL" } } }) }));
vi.mock("@/components/shell/refresh-on-arrival", () => ({ refreshOnArrival: vi.fn() }));
vi.mock("@/components/knowledge/use-scroll-restoration", () => ({ useScrollRestoration: vi.fn() }));
vi.mock("@/lib/persistent-draft", () => ({ PersistentDraft: class { load = async () => null; change = mocks.change; dispose() {} clear = async () => {}; } }));
vi.mock("@/components/knowledge/document-pane", () => ({ DocumentPane: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/tooltip", () => ({ Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.save.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<DocumentComposer workspaceId="w" draftKey={{ kind: "edit", userId: "u", documentId: "d" }} standIn={null} location={[]} untitledLabel="Untitled" metadataTitle={undefined} initialTitle="Title" initialMarkdown="Original" currentRevisionId="r1" submitLabel="Save" busyLabel="Saving" cancelHref="/read" cancelLabel="Read" conflictHref="/edit" onSubmit={async () => "/read"} onAutosave={mocks.save} />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function type(text: string) {
  await act(async () => {
    const field = container.querySelector("textarea")!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function click(label: string) { await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === label)!.click(); }); }
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(1100); }); }
it("saves in place and serializes newer typing against the returned revision", async () => {
  let resolve!: (id: string) => void;
  mocks.save.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockResolvedValueOnce("r3");
  await type("First change"); await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  await type("Newer typing"); await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await act(async () => resolve("r2")); await tick();
  expect(mocks.save).toHaveBeenLastCalledWith({ title: "Title", markdown: "Newer typing", expectedRevisionId: "r2" });
  expect(mocks.push).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Saved");
});
it("Read saves the latest text before navigating", async () => {
  let resolve!: (id: string) => void;
  mocks.save.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  await type("Read this change"); await click("Read");
  expect(mocks.push).not.toHaveBeenCalled();
  await act(async () => resolve("r2"));
  expect(mocks.push).toHaveBeenCalledWith("/read");
});
it("keeps failed edits, pauses automatic retries, and retries explicitly", async () => {
  mocks.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("r2");
  await type("Keep this"); await tick(); await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(container.querySelector("textarea")!.value).toBe("Keep this");
  expect(mocks.push).not.toHaveBeenCalled();
  await click("Retry save");
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("Saved");
});

it("does not navigate or discard text when Read cannot save", async () => {
  mocks.save.mockRejectedValueOnce(new Error("offline"));
  await type("Unsaved reading change"); await click("Read");
  expect(mocks.push).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("Unsaved reading change");
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  expect(container.textContent).toContain("Not saved");
});
it("stops on revision conflicts without replacing the expected revision", async () => {
  mocks.save.mockRejectedValue(new GovernanceRequestError({ code: "REVISION_CONFLICT", message: "Newer revision exists" }));
  await type("My local work"); await tick(); await type("More local work"); await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  await click("Retry save");
  expect(mocks.save).toHaveBeenLastCalledWith({ title: "Title", markdown: "More local work", expectedRevisionId: "r1" });
  expect(container.querySelector("textarea")!.value).toBe("More local work");
  expect(mocks.push).not.toHaveBeenCalled();
});
