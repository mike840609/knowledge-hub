import { notFound, redirect } from "next/navigation";
import { hubSharePath, sharedDocumentParam } from "@/lib/share-paths";
import { applicationServices } from "@/server/composition";
import { sharedOpenTarget } from "@/server/share-read";
import { sharePlatformDestination } from "@/server/share-platform-destination";

export const dynamic = "force-dynamic";

type OpenSharedProps = { params: Promise<{ token: string }>; searchParams?: Promise<{ d?: string | string[] }> };

/**
 * Identity is resolved only after an explicit click; the public reader stays caller-less. A folder
 * page passes the document being read as `?d=`: opened when it is still reachable through the link,
 * else the landing document (folder share spec §4). A document link takes no `?d=` at all.
 *
 * A LINK is judged before sign-in, as before. A NAMED link refuses a caller-less judgement, so the
 * route then signs the reader in and judges again with them (named-recipient share spec); a dead
 * link therefore asks a signed-out reader to sign in before its 404. A NAMED share opens in the Hub's
 * own reader, never as a Hub document: the recipient has no Workspace access to it.
 */
export default async function OpenSharedDocument({ params, searchParams }: OpenSharedProps) {
  const { token } = await params;
  const requested = sharedDocumentParam((await searchParams)?.d);
  if (requested === null) notFound();
  const services = applicationServices();
  // One read judges the link, the requested document and the landing fallback together.
  let target = await sharedOpenTarget(token, requested);
  const { caller, personalWorkspace } = await services.establishTrustedCaller();
  target ??= await sharedOpenTarget(token, requested, caller.identity.id);
  if (!target) notFound();
  if (target.audience === "NAMED") {
    redirect(`${hubSharePath(personalWorkspace.id, token)}${target.kind !== "DOCUMENT" && target.documentId ? `?d=${target.documentId}` : ""}`);
  }
  // An empty folder has nothing to open in the Hub; the reader lands in their own home.
  redirect(target.documentId ? await sharePlatformDestination(caller, target.documentId, personalWorkspace.id, services.queries) : `/w/${personalWorkspace.id}/home`);
}
