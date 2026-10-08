import type { CallerContext } from "@/modules/identity/domain/caller-context";
import type { StoredImage } from "../domain/source-policy";
import type { KnowledgeUnitOfWork } from "../ports/unit-of-work";
import { requireVisibleDocument } from "./internal/require-visible-document";

export class DocumentImageService {
  constructor(private readonly unitOfWork: KnowledgeUnitOfWork) {}

  /**
   * An image a document's Markdown refers to. The right to see it is the right
   * to read the document, checked here on every call; the document ID and the
   * path in the URL prove nothing. Archived documents keep their images, as
   * they keep their text for a member who asks for them.
   */
  async find(caller: CallerContext, documentId: string, src: string): Promise<StoredImage | null> {
    return this.unitOfWork.run(async (repositories) => {
      await requireVisibleDocument(repositories, caller, documentId, true);
      return repositories.sourcePolicy.findStoredImage(documentId, src);
    });
  }
}
