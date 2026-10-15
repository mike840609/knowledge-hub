import { isUuid } from "@/shared/ids/uuidv7";
import { invalidCollection } from "./knowledge-collection-errors";

export const MAX_COLLECTION_ITEMS = 200;
export const COLLECTION_PAGE_SIZE = 50;

export type KnowledgeCollection = {
  id: string;
  workspaceId: string;
  name: string;
  description: string;
  version: number;
  status: "ACTIVE" | "ARCHIVED";
  createdBy: string;
  updatedBy: string;
  archivedBy: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type KnowledgeCollectionItem = {
  id: string;
  collectionId: string;
  documentId: string;
  position: number;
  readingNote: string;
  addedAt: Date;
};

export type CollectionItemView = {
  id: string;
  position: number;
  state: "available" | "unavailable";
  documentId?: string;
  sourceId?: string;
  title?: string;
  sourceName?: string;
  readingNote?: string;
};

export type CollectionDetail = {
  collection: KnowledgeCollection;
  items: CollectionItemView[];
};

export type CollectionPage = {
  items: Array<KnowledgeCollection & { availableItems: number; totalItems: number }>;
  nextCursor: string | null;
};

function boundedText(value: unknown, label: string, max: number, optional = false): string {
  if (optional && value === undefined) return "";
  if (typeof value !== "string") return invalidCollection(`${label} must be a string.`);
  const normalized = value.trim();
  if ((!optional && normalized.length === 0) || Array.from(normalized).length > max) {
    return invalidCollection(`${label} must be ${optional ? "at most" : "between 1 and"} ${max} characters.`);
  }
  return normalized;
}

export function normalizeCollectionName(value: unknown): string {
  return boundedText(value, "Collection name", 120);
}

export function normalizeCollectionDescription(value: unknown): string {
  return boundedText(value, "Collection description", 2000, true);
}

export function normalizeReadingNote(value: unknown): string {
  return boundedText(value, "Reading note", 500, true);
}

export function parseCollectionVersion(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    return invalidCollection("expectedVersion must be a positive safe integer.");
  }
  return value;
}

export function validateCollectionOrder(
  existingIds: readonly string[],
  requestedIds: readonly string[],
): void {
  if (!Array.isArray(requestedIds) || requestedIds.length !== existingIds.length) {
    invalidCollection("Item order must include each current item exactly once.");
  }
  const current = new Set(existingIds);
  if (current.size !== existingIds.length || new Set(requestedIds).size !== requestedIds.length ||
    requestedIds.some((id) => typeof id !== "string" || !current.has(id))) {
    invalidCollection("Item order must be an exact permutation of current items.");
  }
}

export type CollectionCursor = { updatedAt: Date; id: string };

export function encodeCollectionCursor(updatedAt: Date, id: string): string {
  if (!isUuid(id) || !(updatedAt instanceof Date) || !Number.isFinite(updatedAt.getTime())) {
    return invalidCollection("Invalid collection cursor.");
  }
  return `${updatedAt.toISOString()}.${id.toLowerCase()}`;
}

export function parseCollectionCursor(raw: unknown): CollectionCursor | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 128) return invalidCollection("Invalid collection cursor.");
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\.([0-9a-f-]{36})$/i.exec(raw);
  if (!match || !isUuid(match[2])) return invalidCollection("Invalid collection cursor.");
  const updatedAt = new Date(match[1]);
  if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== match[1]) {
    return invalidCollection("Invalid collection cursor.");
  }
  return { updatedAt, id: match[2].toLowerCase() };
}
