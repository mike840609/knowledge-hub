import type {
  CollectionItemView,
  KnowledgeCollection,
  KnowledgeCollectionItem,
  CollectionCursor,
} from "../domain/knowledge-collection";

export interface KnowledgeCollectionRepository {
  findById(id: string): Promise<KnowledgeCollection | null>;
  lockById(id: string): Promise<KnowledgeCollection | null>;
  insert(value: KnowledgeCollection): Promise<void>;
  listByWorkspace(
    workspaceId: string,
    status: "ACTIVE" | "ARCHIVED",
    cursor: CollectionCursor | null,
    limit: number,
  ): Promise<Array<KnowledgeCollection & { availableItems: number; totalItems: number }>>;
  listItems(collectionId: string): Promise<KnowledgeCollectionItem[]>;
  resolveItems(collectionId: string, workspaceId: string): Promise<CollectionItemView[]>;
  insertItem(item: KnowledgeCollectionItem): Promise<void>;
  updateItemNote(itemId: string, note: string): Promise<void>;
  deleteItem(itemId: string): Promise<void>;
  replacePositions(collectionId: string, items: readonly { id: string; position: number }[]): Promise<void>;
  saveMetadata(value: KnowledgeCollection): Promise<void>;
  countItems(collectionId: string): Promise<number>;
}
