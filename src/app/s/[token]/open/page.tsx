import { notFound, redirect } from "next/navigation";
import { sharedDocumentParam } from "@/lib/share-paths";
import { applicationServices } from "@/server/composition";
import { isSharedAvailable, sharedLandingDocumentId } from "@/server/share-read";
import { sharePlatformDestination } from "@/server/share-platform-destination";

export const dynamic = "force-dynamic";

type OpenSharedProps = { params: Promise<{ token: string }>; searchParams?: Promise<{ d?: string | string[] }> };

/**
 * Identity is resolved only after an explicit click; the public reader stays caller-less. A folder
 * page passes the document being read as `?d=`: opened when it is still reachable through the link,
 * else the landing document (folder share spec §4). A document link takes no `?d=` at all.
 */
export default async function OpenSharedDocument({ params, searchParams }: OpenSharedProps) {
  const { token } = await params;
  const requested = sharedDocumentParam((await searchParams)?.d);
  if (requested === null) notFound();
  if (!await isSharedAvailable(token)) notFound();
  const services = applicationServices();
  const { caller, personalWorkspace } = await services.establishTrustedCaller();
  const link = await services.unitOfWork.run(repositories => repositories.shareLinks.findByToken(token));
  if (!link) notFound();
  if (link.target.kind === "DOCUMENT") {
    if (requested !== undefined) notFound();
    redirect(await sharePlatformDestination(caller, link.target.documentId, personalWorkspace.id, services.queries));
  }
  const reachable = requested !== undefined && await isSharedAvailable(token, requested) ? requested : null;
  const documentId = reachable ?? await sharedLandingDocumentId(token);
  // An empty folder has nothing to open in the Hub; the reader lands in their own home.
  redirect(documentId ? await sharePlatformDestination(caller, documentId, personalWorkspace.id, services.queries) : `/w/${personalWorkspace.id}/home`);
}
