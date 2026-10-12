import type { SavedShareQuery, SavedShareRecord, SavedShareView, SavedShareSnapshot } from "../domain/saved-share";
export interface SavedShareRepository {
  /** One SQL snapshot: never validate a grant and fetch newer private metadata separately. */
  findSnapshotByToken(token: string): Promise<SavedShareSnapshot | null>;
  findByToken(userId: string, token: string): Promise<SavedShareRecord | null>;
  save(record: SavedShareRecord): Promise<SavedShareRecord>;
  remove(userId: string, id: string, now: Date): Promise<boolean>;
  list(userId: string, query: SavedShareQuery, now: Date, limit: number, offset: number): Promise<SavedShareView[]>;
}
