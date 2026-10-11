import type { SavedShareQuery, SavedShareRecord, SavedShareView } from "../domain/saved-share";
export interface SavedShareRepository {
  findByToken(userId: string, token: string): Promise<SavedShareRecord | null>;
  save(record: SavedShareRecord): Promise<SavedShareRecord>;
  remove(userId: string, id: string, now: Date): Promise<boolean>;
  list(userId: string, query: SavedShareQuery, now: Date, limit: number, offset: number): Promise<SavedShareView[]>;
}
