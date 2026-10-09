import { notFound, redirect } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { getSharedDocument } from "@/server/share-read";
import { sharePlatformDestination } from "@/server/share-platform-destination";

export const dynamic = "force-dynamic";

/** Identity is resolved only after an explicit click; the public reader stays caller-less. */
export default async function OpenSharedDocument({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!await getSharedDocument(token)) notFound();
  const services = applicationServices();
  const { caller, personalWorkspace } = await services.establishTrustedCaller();
  const link = await services.unitOfWork.run(repositories => repositories.shareLinks.findByToken(token));
  if (!link) notFound();
  redirect(await sharePlatformDestination(caller, link.documentId, personalWorkspace.id, services.queries));
}
