// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceList } from "@/components/sources/source-list";
import type { runFolderImport } from "@/components/imports/folder-import-form";
import type { SourceListItemModel } from "@/server/source-read";

const state = vi.hoisted(() => ({ canImport: true, confirmed: true, supported: true, remembered: true, handleAvailable: true, push: vi.fn(), run: vi.fn<typeof runFolderImport>(async () => "preview-1") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ confirmed: state.confirmed, access: { actions: { canImport: state.canImport } } }) }));
vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: () => state.supported,
  getRememberedFolderMeta: () => state.remembered ? {rootName:"notes",lastSyncAt:"2026-10-02T00:00:00Z"} : null,
  loadRememberedHandle: async () => state.handleAvailable ? ({handle:{},rootName:"notes"}) : null,
  collectHandleFiles: async () => [], rememberFolderHandle: async () => {},
}));
vi.mock("@/components/imports/folder-import-form", () => ({ runFolderImport: state.run }));
let root: Root; let container: HTMLDivElement;
const source = (id: string, overrides = {}): SourceListItemModel => ({ source: {id,workspaceId:"ws",name:`Source ${id}`,sourceType:"FOLDER_SYNC",ownership:"SOURCE_MANAGED",status:"ACTIVE",syncVersion:1,...overrides}, latestRun:null });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  Object.assign(state,{canImport:true,confirmed:true,supported:true,remembered:true,handleAvailable:true});
  state.push.mockReset(); state.run.mockReset(); state.run.mockResolvedValue("preview-1");
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.unstubAllGlobals();});
const limits = {maxAssetFileBytes:8,maxAssetTotalBytes:16};
async function render(items=[source("one"),source("two")]) {await act(async () => root.render(<SourceList workspaceId="ws" items={items} limits={limits} />));}
it("syncs only the clicked source and opens its preview without nesting the button in the detail link",async () => {
  await render();
  const button=container.querySelector<HTMLButtonElement>('button[aria-label="Check for changes: Source two"]');
  expect(button).not.toBeNull();expect(button!.closest("a")).toBeNull();
  expect(container.querySelector('a[data-list-row][href="/w/ws/sources/two"]')).not.toBeNull();
  await act(async () => button!.click());
  expect(state.run).toHaveBeenCalledTimes(1);
  expect(state.run).toHaveBeenCalledWith(expect.objectContaining({target:{kind:"existing",workspaceId:"ws",sourceId:"two",sourceName:""},limits}));
  expect(state.push).toHaveBeenCalledWith("/w/ws/sources/imports/preview-1");
});
it.each([{sourceType:"HUB",ownership:"HUB_MANAGED"},{sourceType:"FILE_UPLOAD"},{status:"ARCHIVED"},{ownership:"HUB_MANAGED"}])("does not offer folder sync for ineligible source %j",async overrides => {
  await render([source("one",overrides)]);expect(container.querySelector("button")).toBeNull();
});
it.each(["canImport","confirmed","supported","remembered"] as const)("keeps sync hidden when %s is false",async key => {
  state[key]=false;await render();expect(container.querySelector("button")).toBeNull();
  if (key === "canImport" || key === "confirmed") expect(container.querySelector('a[aria-label^="Update from folder"]')).toBeNull();
});
it("disables a running source and keeps row keyboard navigation out of the secondary action",async () => {
  let resolve!: (snapshot:string)=>void;state.run.mockImplementationOnce(() => new Promise<string>(r => {resolve=r;}));
  await render();const button=container.querySelector<HTMLButtonElement>('button[aria-label="Check for changes: Source one"]');expect(button).not.toBeNull();
  const arrow=new KeyboardEvent("keydown",{key:"ArrowDown",bubbles:true,cancelable:true});await act(async () => {button!.focus();button!.dispatchEvent(arrow);});expect(arrow.defaultPrevented).toBe(false);expect(document.activeElement).toBe(button);
  await act(async () => button!.click());expect(button!.disabled).toBe(true);expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => button!.click());expect(state.run).toHaveBeenCalledTimes(1);
  await act(async () => resolve("preview-1"));
});

it.each(["supported","remembered"] as const)("offers folder selection in the row when %s is unavailable",async key => {
  state[key]=false;await render([source("one")]);
  const link=container.querySelector<HTMLAnchorElement>('a[aria-label="Update from folder: Source one"]');
  expect(link).not.toBeNull();expect(link!.getAttribute("href")).toBe("/w/ws/sources/one/update");
  expect(link!.hasAttribute("data-list-row")).toBe(false);
});
it("offers just one action when the folder is remembered",async () => {
  await render([source("one")]);expect(container.querySelector('button[aria-label="Check for changes: Source one"]')).not.toBeNull();
  expect(container.querySelector('a[aria-label="Update from folder: Source one"]')).toBeNull();
});

it("puts sync before the detail link in keyboard order", async () => {
  await render([source("one")]);
  const controls = [...container.querySelectorAll("button, a")];
  expect(controls[0]?.getAttribute("aria-label")).toBe("Check for changes: Source one");
  expect(controls[1]?.getAttribute("href")).toBe("/w/ws/sources/one");
});

it("explains source sync and the preview/apply step on focus", async () => {
  await render([source("one")]);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.focus());
  expect(document.body.textContent).toContain("Check for changes");
  expect(document.body.textContent).toContain("preview changes before Apply");
});
it("explains folder selection separately on focus", async () => {
  state.remembered=false; await render([source("one")]);
  await act(async () => container.querySelector<HTMLAnchorElement>('a[aria-label^="Update from folder"]')!.focus());
  expect(document.body.textContent).toContain("Choose a folder to sync");
  expect(document.body.textContent).toContain("preview changes before Apply");
});
it("omits irrelevant sync status for a Hub source", async () => {
  await render([source("hub",{sourceType:"HUB",ownership:"HUB_MANAGED"})]);
  expect(container.textContent).not.toContain("Never synced");
});
it("shows last successful apply even when the latest attempt failed", async () => {
  const item=source("one");
  const run={id:"applied",sourceId:"one",triggeredBy:"user",basedOnVersion:0,resultVersion:1,status:"APPLIED" as const,summary:{},startedAt:new Date("2026-10-02T00:00:00Z"),completedAt:new Date("2026-10-02T01:00:00Z")};
  await render([{...item,latestRun:{...run,id:"failed",status:"FAILED",resultVersion:null,startedAt:new Date("2026-10-03T00:00:00Z")},latestSuccessfulRun:run}]);
  expect(container.textContent).toContain("Failed");
  expect(container.textContent).toContain("Last synced");
  expect(container.querySelector('time')?.getAttribute('datetime')).toBe("2026-10-02T01:00:00.000Z");
});
it("offers a source-scoped retry after a failed sync", async () => {
  state.run.mockRejectedValueOnce(new Error("Upload failed"));await render([source("one")]);
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Check for changes"]')!.click());
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Upload failed");
  const retry=container.querySelector<HTMLButtonElement>('button[aria-label="Retry sync: Source one"]');
  expect(retry).not.toBeNull();await act(async () => retry!.click());
  expect(state.push).toHaveBeenCalledWith("/w/ws/sources/imports/preview-1");
});
it("offers folder reselection instead of retry when the saved folder is unavailable", async () => {
  state.handleAvailable=false;await render([source("one")]);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(container.querySelector('a[aria-label="Choose folder to sync: Source one"]')?.getAttribute("href")).toBe("/w/ws/sources/one/update");
  expect(container.querySelector('button[aria-label^="Retry sync"]')).toBeNull();
});

it("shows scanning, upload counts, preview preparation, and the required Apply step", async () => {
  let resolve!: (snapshot:string)=>void;
  state.run.mockImplementationOnce(() => new Promise<string>(r=>{resolve=r;}));
  await render([source("one")]);
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  const progress=state.run.mock.calls[0][0].onProgress;
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Apply is required");
  await act(async () => progress({kind:"UPLOADING",uploaded:2,total:5}));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("2/5");
  await act(async () => progress({kind:"FINALIZING"}));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("building the preview");
  await act(async () => resolve("preview-1"));
  expect(container.querySelector('[role="status"]')?.textContent).toContain("select Apply");
});
