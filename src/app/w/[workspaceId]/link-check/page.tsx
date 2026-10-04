import { redirect } from "next/navigation";
export default async function LinkCheckPage({params}:{params:Promise<{workspaceId:string}>}) {
  const {workspaceId}=await params;
  redirect(`/w/${workspaceId}/sources/health`);
}
