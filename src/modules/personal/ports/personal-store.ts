export type PersonalItem = { key: string; value: Record<string, unknown> | null; version: number; updatedAt: string };
export interface PersonalStore {
  get(userId: string, workspaceId: string, key: string): Promise<PersonalItem | null>;
  list(userId: string, workspaceId: string): Promise<PersonalItem[]>;
  put(userId: string, workspaceId: string, key: string, value: Record<string, unknown> | null, expected: number): Promise<boolean>;
}
