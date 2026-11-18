import { redirect } from "next/navigation";

/**
 * A workspace's bare address is the most likely thing a reader types or
 * bookmarks. It has no page of its own, so send it to the workspace's home
 * rather than the generic not-found screen.
 */
export default async function WorkspaceRootPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(`/w/${workspaceId}/home`);
}
