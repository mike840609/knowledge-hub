// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceList } from "@/components/sources/source-list";
import type { SourceListItemModel } from "@/server/source-read";

const state = vi.hoisted(() => ({ canImport: true, confirmed: true, supported: true, remembered: true, push: vi.fn(), run: vi.fn(async () => "preview-1") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ confirmed: state.confirmed, access: { actions: { canImport: state.canImport } } }) }));
vi.mock("@/components/imports/folder-handle-store", () => ({
  isDirectoryPickerSupported: () => state.supported,
  getRememberedFolderMeta: () => state.remembered ? {rootName:"notes",lastSyncAt:"2026-10-02T00:00:00Z"} : null,
  loadRememberedHandle: async () => ({handle:{},rootName:"notes"}),
  collectHandleFiles: async () => [], rememberFolderHandle: async () => {},
}));
vi.mock("@/components/imports/folder-import-form", () => ({ runFolderImport: state.run }));
let root: Root; let container: HTMLDivElement;
const source = (id: string, overrides = {}): SourceListItemModel => ({ source: {id,workspaceId:"ws",name:`Source ${id}`,sourceType:"FOLDER_SYNC",ownership:"SOURCE_MANAGED",status:"ACTIVE",syncVersion:1,...overrides}, latestRun:null });
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  Object.assign(state,{canImport:true,confirmed:true,supported:true,remembered:true});
  state.push.mockReset(); state.run.mockReset(); state.run.mockResolvedValue("preview-1");
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async () => {await act(async () => root.unmount());container.remove();vi.unstubAllGlobals();});
const limits = {maxAssetFileBytes:8,maxAssetTotalBytes:16};
async function render(items=[source("one"),source("two")]) {await act(async () => root.render(<SourceList workspaceId="ws" items={items} limits={limits} />));}
it("syncs only the clicked source and opens its preview without nesting the button in the detail link",async () => {
  await render();
  const button=container.querySelector<HTMLButtonElement>('button[aria-label="Sync now: Source two"]');
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
  await render();const button=container.querySelector<HTMLButtonElement>('button[aria-label="Sync now: Source one"]');expect(button).not.toBeNull();
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
  await render([source("one")]);expect(container.querySelector('button[aria-label="Sync now: Source one"]')).not.toBeNull();
  expect(container.querySelector('a[aria-label="Update from folder: Source one"]')).toBeNull();
});
