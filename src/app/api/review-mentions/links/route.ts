import { reviewHttp } from "@/server/review-http";

export const dynamic = "force-dynamic";

/**
 * The owner's links that open their document now, to choose the one a mention hands over.
 * `mentionedUserIds` (comma-separated, may be empty) is who the comment names: a NAMED link is
 * offered only when it names all of them, and never when the parameter is absent.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const mentioned = params.get("mentionedUserIds");
  return reviewHttp(request, async (service, caller) => service.mentionLinksForOwner(caller, {
    documentId: params.get("documentId") ?? "",
    mentionedUserIds: mentioned === null ? undefined : mentioned.split(",").filter(Boolean),
  }));
}
