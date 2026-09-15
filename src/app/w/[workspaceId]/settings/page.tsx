import { getWorkspaceSettings } from "@/server/workspace-settings-read";
import { GeneralSettings } from "@/components/workspaces/general-settings";
export default async function GeneralPage({ params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; const { team } = await getWorkspaceSettings(workspaceId); return <GeneralSettings team={team} />; }
