import { getWorkspaceSettings } from "@/server/workspace-settings-read";
import { GroupsSettings } from "@/components/workspaces/groups-settings";
export default async function GroupsPage({ params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; const { team, services, caller } = await getWorkspaceSettings(workspaceId); const groups = await services.workspaceAdmin.listGroups(caller, workspaceId); return <GroupsSettings team={team} groups={groups} />; }
