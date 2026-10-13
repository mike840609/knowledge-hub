// Request-bound private routes must bypass Next auto-mode Request proxies.
export const dynamic = "force-dynamic";
import { assertReviewOrigin } from "@/server/review-origin";
import { workspaceHttp, requestFields } from "@/server/workspace-http";
export async function POST(request: Request) {
  return workspaceHttp(async (s, caller) => {
    assertReviewOrigin(request);
    const { category, description, pagePath } = await requestFields(request, ["category", "description", "pagePath"]);
    await s.feedbackReports.submit(caller, { category, description, pagePath });
  }, 204);
}
