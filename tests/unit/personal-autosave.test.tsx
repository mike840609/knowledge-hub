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
vi.mock("@/lib/persistent-draft", () => ({ PersistentDraft: class { load = async () => null; change = mocks.change; dispose() {} flush = async () => {}; retry = async () => {}; clear = async () => {}; } }));
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
  expect(container.textContent).toContain("All changes saved");
});
it("Read saves the latest text before navigating", async () => {
  let resolve!: (id: string) => void;
  mocks.save.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  await type("Read this change"); await click("Read");
  expect(mocks.push).not.toHaveBeenCalled();
  await act(async () => resolve("r2"));
  expect(mocks.push).toHaveBeenCalledWith("/read");
});
it("keeps failed edits and allows explicit retry before backoff", async () => {
  mocks.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce("r2");
  await type("Keep this"); await tick(); await tick();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(container.querySelector("textarea")!.value).toBe("Keep this");
  expect(mocks.push).not.toHaveBeenCalled();
  await click("Retry save");
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("All changes saved");
});

it("does not navigate or discard text when Read cannot save", async () => {
  mocks.save.mockRejectedValueOnce(new Error("offline"));
  await type("Unsaved reading change"); await click("Read");
  expect(mocks.push).not.toHaveBeenCalled();
  expect(container.querySelector("textarea")!.value).toBe("Unsaved reading change");
  expect(container.querySelector("textarea")!.disabled).toBe(false);
  expect(container.textContent).toContain("Not synced");
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

it("retries temporary failures automatically with backoff", async () => {
  mocks.save.mockRejectedValueOnce(new Error("temporary")).mockResolvedValueOnce("r2");
  await type("Recover automatically"); await tick();
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  await tick();
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(container.textContent).toContain("All changes saved");
});
it("resumes after reconnect without an explicit save", async () => {
  mocks.save.mockResolvedValue("r2");
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event("offline")));
  await type("Offline writing"); await tick();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Offline");
  online.mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online"))); await tick();
  expect(mocks.save).toHaveBeenCalledWith({ title: "Title", markdown: "Offline writing", expectedRevisionId: "r1" });
  online.mockRestore();
});
it("saves before following a sidebar link", async () => {
  let resolve!: (id: string) => void;
  mocks.save.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; }));
  await type("Before navigation");
  const link = document.createElement("a"); link.href = "/another-note"; document.body.append(link);
  await act(async () => link.click());
  expect(mocks.push).not.toHaveBeenCalled();
  await act(async () => resolve("r2"));
  expect(mocks.push).toHaveBeenCalledWith("/another-note"); link.remove();
});
it("waits for an in-flight save then saves newer text before Read", async () => {
  let resolve!: (id: string) => void;
  mocks.save.mockImplementationOnce(() => new Promise<string>(done => { resolve = done; })).mockResolvedValue("r3");
  await type("First"); await tick(); await type("Second"); await click("Read");
  expect(mocks.push).not.toHaveBeenCalled();
  await act(async () => resolve("r2"));
  expect(mocks.save).toHaveBeenLastCalledWith({ title: "Title", markdown: "Second", expectedRevisionId: "r2" });
  expect(mocks.push).toHaveBeenCalledWith("/read");
});
it("keeps the latest recovery snapshot synchronously on pagehide", async () => {
  await type("Closing now");
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(mocks.change).toHaveBeenLastCalledWith({ title: "Title", markdown: "Closing now", baseRevisionId: "r1" });
});
it("creates a body-only note once, migrates its draft, and keeps the editor mounted", async () => {
  await act(async () => root.unmount()); root = createRoot(container);
  mocks.save.mockResolvedValueOnce({ revisionId: "r-new", documentId: "created", editHref: "/created/edit", readHref: "/created?mode=read", creationStorageKey: "creation" }).mockResolvedValue("r-next");
  await act(async () => root.render(<DocumentComposer workspaceId="w" draftKey={{ kind: "new", userId: "u", workspaceId: "w" }} standIn={null} location={[]} untitledLabel="Untitled" metadataTitle={undefined} initialTitle="" initialMarkdown="" currentRevisionId={null} submitLabel="Create" busyLabel="Creating" cancelHref="/list" conflictHref={null} onSubmit={async () => "/read"} onAutosave={mocks.save} />));
  await tick(); expect(mocks.save).not.toHaveBeenCalled();
  const field = container.querySelector("textarea");
  await type("A new body-only note"); await tick();
  expect(mocks.save).toHaveBeenCalledWith({ title: "Untitled", markdown: "A new body-only note", expectedRevisionId: null });
  expect(window.location.pathname).toBe("/created/edit");
  expect(container.querySelector("textarea")).toBe(field);
  await type("Continuing the same note"); await tick();
  expect(mocks.save).toHaveBeenLastCalledWith({ title: "Untitled", markdown: "Continuing the same note", expectedRevisionId: "r-new" });
  expect(mocks.push).not.toHaveBeenCalled();
  expect(container.textContent).toContain("All changes saved");
});
