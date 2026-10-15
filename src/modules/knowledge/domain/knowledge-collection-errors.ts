import { DomainError } from "@/shared/domain/errors";

export type CollectionErrorCode =
  | "COLLECTION_NOT_FOUND"
  | "COLLECTION_FORBIDDEN"
  | "COLLECTION_INVALID"
  | "COLLECTION_CONFLICT"
  | "COLLECTION_DUPLICATE_ITEM"
  | "COLLECTION_LIMIT";

export class KnowledgeCollectionError extends DomainError {
  constructor(code: CollectionErrorCode, message: string) {
    super(code, message);
    this.name = "KnowledgeCollectionError";
  }
}

export function invalidCollection(message: string): never {
  throw new KnowledgeCollectionError("COLLECTION_INVALID", message);
}
