import { parseTreeNodePatchInput, requireRouteId } from "@/server/authoring-input";
import { workspaceHttp } from "@/server/workspace-http";

type TreeNodeRouteContext = { params: Promise<{ nodeId: string }> };

/**
 * Renames a folder, moves a node into another folder or to the top level, or reorders it among its
 * siblings (daily-driver spec §7.1). Which of the three is the body's shape, and it is exactly one.
 * The service re-checks everything — workspace, ownership, lifecycle, the destination — because the
 * ID in this path grants nothing.
 */
export async function PATCH(request: Request, context: TreeNodeRouteContext) {
  return workspaceHttp(async (services, caller) => {
    const nodeId = requireRouteId((await context.params).nodeId, "the node");
    const patch = parseTreeNodePatchInput(await request.json().catch(() => null));
    switch (patch.kind) {
      case "rename":
        await services.hub.renameFolder(caller, { nodeId, name: patch.name });
        return;
      case "move":
        await services.hub.moveTreeNode(caller, { nodeId, newParentId: patch.parentId, newPosition: patch.position });
        return;
      case "reorder":
        await services.hub.reorderTreeNode(caller, { nodeId, newPosition: patch.position });
        return;
    }
  }, 204);
}
