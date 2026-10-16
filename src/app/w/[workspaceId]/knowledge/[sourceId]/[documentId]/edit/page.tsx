import { redirect } from "next/navigation";

/** Legacy bookmarks now open the same directly editable document page. */
export default async function EditDocumentPage({ params }: {
  params: Promise<{ workspaceId: string; sourceId: string; documentId: string }>;
}) {
  const { workspaceId, sourceId, documentId } = await params;
  redirect(`/w/${workspaceId}/knowledge/${sourceId}/${documentId}`);
}
