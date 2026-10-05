import { recordOnboardingStep } from "@/server/onboarding-progress";
import { revalidatePath } from "next/cache";
import { workspaceHttp, requestFields } from "@/server/workspace-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ workspaceId: string; documentId: string }> },
) {
  return workspaceHttp(async (s, caller) => {
    const { workspaceId, documentId } = await context.params;
    const { revisionId } = await requestFields(request, ["revisionId"]);
    await s.documentReadProgress.markRead(caller, {
      workspaceId,
      documentId,
      revisionId,
    });
    await recordOnboardingStep(s.personalPreferences, caller, workspaceId, "read");
    revalidatePath(`/w/${workspaceId}/home`);
    revalidatePath(`/w/${workspaceId}/updates`);
  }, 204);
}
