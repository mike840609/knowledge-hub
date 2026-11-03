import { workspaceHttp } from "@/server/workspace-http";

export const dynamic = "force-dynamic";

/** People the owner may name on a NAMED share, never the caller. */
export async function GET(request: Request) {
  return workspaceHttp(async (services, caller) => services.shares.searchRecipientCandidates(caller, new URL(request.url).searchParams.get("query") ?? ""));
}
