"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/modules/knowledge/domain/errors";
import type { KnowledgeMetadata } from "@/modules/knowledge/domain/content";
import { getCurrentIdentity } from "@/modules/identity/application/get-current-identity";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";

export type CreateDocumentActionState = { error: string | null };

export async function createDocumentAction(_previous: CreateDocumentActionState, formData: FormData): Promise<CreateDocumentActionState> {
  const sourceId = String(formData.get("sourceId") ?? "");
  const parentIdValue = String(formData.get("parentId") ?? "");
  const title = String(formData.get("title") ?? "");
  const markdown = String(formData.get("markdown") ?? "");
  let result: { documentId: string };
  try {
    const metadata: KnowledgeMetadata = {};
    const services = applicationServices();
    const caller = callerFromIdentity(await getCurrentIdentity(services.identityProvider));
    result = await services.knowledge.createHubManagedDocument(caller, { sourceId, parentId: parentIdValue || null, title, markdown, metadata });
  } catch (error) {
    if (error instanceof DomainError) return { error: error.message };
    return { error: "The document could not be created. Please correct the form and try again." };
  }
  revalidatePath("/knowledge");
  redirect(`/knowledge/${result.documentId}`);
}
