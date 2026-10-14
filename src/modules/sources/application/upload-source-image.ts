import { createHash } from "node:crypto";
import { syncCallerIdentity } from "@/modules/identity/application/sync-caller-identity";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { SourceArchivedError, SourceNotFoundError, SourceReadOnlyError } from "@/modules/knowledge/domain/errors";
import { lockWorkspaceForMutation } from "@/modules/workspaces/application/workspace-mutation-guard";
import type { BlobStore } from "@/modules/sources/ports/blob-store";
import type { SourceRepositories, SourceUnitOfWork } from "@/modules/sources/ports/unit-of-work";
import { DomainError } from "@/shared/domain/errors";
import { uuidv7 } from "@/shared/ids/uuidv7";
import { detectImageType } from "@/shared/images/detect-image-type";

/** One pasted or dropped image. A constant: a screenshot is far below it, and nothing asks for more. */
export const MAX_UPLOADED_IMAGE_BYTES = 10 * 1024 * 1024;

const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/**
 * An image for a Hub page (hub image upload spec §4). It belongs to the page's
 * Source and is named by its content, `images/<sha256>.<ext>`: a Source exists
 * before any document in it, so an unsaved note can hold one, and the name
 * never changes meaning, so every revision keeps the image it was written with.
 */
export class UploadSourceImageService {
  constructor(private readonly uow: SourceUnitOfWork, private readonly blobs: BlobStore, private readonly now: () => Date = () => new Date()) {}

  async upload(caller: CallerContext, input: { sourceId: string; bytes: Uint8Array }): Promise<{ src: string; sourceId: string }> {
    const { sourceId, bytes } = input;
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOADED_IMAGE_BYTES) throw new DomainError("INVALID_REQUEST", "An image must be between 1 byte and 10 MiB.");
    const extension = detectImageType(bytes);
    if (!extension) throw new DomainError("INVALID_REQUEST", "Only PNG, JPEG, GIF, WebP and AVIF images, and SVG up to 2 MiB, can be added.");
    // Refused before anything is stored; checked again where the row is written.
    await this.uow.run((repositories) => this.authorize(repositories, caller, sourceId));
    const contentHash = sha256(bytes);
    await this.blobs.put(contentHash, new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } }), bytes.byteLength);
    const sourcePath = `images/${contentHash}.${extension}`;
    const now = this.now();
    await this.uow.run(async (repositories) => {
      await this.authorize(repositories, caller, sourceId);
      const existing = await repositories.assets.findByPath(sourceId, sourcePath);
      await repositories.assets.upsertByPath({
        id: existing?.id ?? uuidv7(), sourceId, sourcePath, sourcePathHash: sha256(sourcePath), mimeType: null, contentHash,
        metadata: { size: bytes.byteLength, stored: true }, createdAt: existing?.createdAt ?? now, updatedAt: now,
      });
    });
    return { src: `/${sourcePath}`, sourceId };
  }

  /** What writing a document in this Source requires (`createDocumentInTransaction`), in the same order. */
  private async authorize(repositories: SourceRepositories, caller: CallerContext, sourceId: string): Promise<void> {
    await syncCallerIdentity(repositories.users, caller);
    const source = await repositories.sourcePolicy.lockById(sourceId);
    if (!source) throw new SourceNotFoundError();
    if (source.status !== "ACTIVE") throw new SourceArchivedError();
    if (source.ownership !== "HUB_MANAGED") throw new SourceReadOnlyError();
    await lockWorkspaceForMutation(repositories, caller, source.workspaceId, "content-write");
  }
}
