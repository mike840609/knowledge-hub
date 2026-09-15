import { getWorkspaceSettings } from "@/server/workspace-settings-read";
import { MembersSettings } from "@/components/workspaces/members-settings";
export default async function MembersPage({ params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; const { team, services, caller } = await getWorkspaceSettings(workspaceId); const members = await services.workspaceAdmin.listMembers(caller, workspaceId); return <MembersSettings team={team} members={members} />; }
