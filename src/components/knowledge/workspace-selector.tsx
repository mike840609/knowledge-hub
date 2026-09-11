import type { WorkspaceView } from "@/modules/workspaces/application/workspace-query-service";

export function WorkspaceSelector({ workspaces, selectedWorkspaceId }: { workspaces: WorkspaceView[]; selectedWorkspaceId: string | undefined }) {
  return (
    <div className="min-w-64">
      <label className="block text-sm font-medium text-slate-700" htmlFor="workspace-selector">Choose a workspace</label>
      <select id="workspace-selector" name="workspaceId" defaultValue={selectedWorkspaceId} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
        {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </div>
  );
}
