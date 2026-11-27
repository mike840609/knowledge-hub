import { redirect } from "next/navigation";

// The binding controls live on the Agents page (2026-11-27-agents-destination-design.md); old links land there.
export default async function TaskExportSetupPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}/agents`);
}
