import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentViewer } from "@/components/knowledge/document-viewer";
import { NotFoundError } from "@/modules/knowledge/domain/errors";
import { applicationServices } from "@/server/composition";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params;
  const services = applicationServices();
  const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
  try {
    const view = await services.queries.getDocument(caller, documentId);
    return <main className="mx-auto min-h-screen max-w-4xl px-6 py-10"><Link className="text-sm font-semibold text-accent" href="/knowledge">← Back to Knowledge</Link><div className="mt-6"><DocumentViewer view={view} /></div></main>;
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}
