// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PersonalSyncOverview } from "@/components/knowledge/personal-sync-overview";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/shell/use-workspace-authorization", () => ({ useWorkspaceAuthorization: () => ({ confirmed: true, access: { actions: { canImport: true } } }) }));
it("guides a first import and explains that local changes require Preview and Apply", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container=document.createElement("div");document.body.append(container);const root=createRoot(container);
  try {await act(async()=>root.render(<PersonalSyncOverview workspaceId="ws" items={[]} />));
    expect(container.querySelector('a[href="/w/ws/sources/import"]')?.textContent).toBe("Import Markdown folder");
    expect(container.textContent).toContain("Obsidian");expect(container.textContent).toContain("Preview");expect(container.textContent).toContain("Apply");
  } finally {await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();}
});
it("shows folder sources with their last successful sync, without presenting Hub notes as synced", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container=document.createElement("div");const root=createRoot(container);
  const source={id:"one",workspaceId:"ws",name:"IT Wiki",sourceType:"FOLDER_SYNC" as const,ownership:"SOURCE_MANAGED" as const,status:"ACTIVE" as const,syncVersion:1};
  const run={id:"run",sourceId:"one",triggeredBy:"user",basedOnVersion:0,resultVersion:1,status:"APPLIED" as const,summary:{},startedAt:new Date("2026-10-02T00:00:00Z"),completedAt:new Date("2026-10-02T01:00:00Z")};
  try {await act(async()=>root.render(<PersonalSyncOverview workspaceId="ws" items={[{source,latestRun:run,latestSuccessfulRun:run},{source:{...source,id:"hub",name:"My notes",sourceType:"HUB",ownership:"HUB_MANAGED"},latestRun:null}]} />));
    expect(container.textContent).toContain("IT Wiki");expect(container.textContent).toContain("Last synced");expect(container.textContent).not.toContain("My notes");
    expect(container.querySelector('time')?.dateTime).toBe("2026-10-02T01:00:00.000Z");
    expect(container.querySelector('a[aria-label="Update from folder: IT Wiki"]')).not.toBeNull();
  } finally {await act(async()=>root.unmount());vi.unstubAllGlobals();}
});
