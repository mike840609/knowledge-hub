import type { Pool } from "mariadb";
import type { PersonalItem, PersonalStore } from "@/modules/personal/ports/personal-store";
function item(row: Record<string, unknown>): PersonalItem {
  return { key: String(row.item_key), value: typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload as PersonalItem["value"], version: Number(row.version), updatedAt: new Date(row.updated_at as Date).toISOString() };
}
export class MariaDbPersonalStore implements PersonalStore {
  constructor(private readonly pool: Pool) {}
  async get(userId: string, workspaceId: string, key: string) {
    const rows = await this.pool.query("SELECT * FROM personal_items WHERE user_id=? AND workspace_id=? AND item_key=?", [userId, workspaceId, key]);
    return rows[0] ? item(rows[0]) : null;
  }
  async list(userId: string, workspaceId: string) {
    const rows = await this.pool.query("SELECT * FROM personal_items WHERE user_id=? AND workspace_id=? AND payload IS NOT NULL ORDER BY updated_at DESC", [userId, workspaceId]);
    return (rows as Record<string, unknown>[]).map(item);
  }
  async put(userId: string, workspaceId: string, key: string, value: Record<string, unknown> | null, expected: number) {
    const payload = value === null ? null : JSON.stringify(value);
    if (expected === 0) {
      try {
        await this.pool.query("INSERT INTO personal_items (user_id,workspace_id,item_key,payload,version) VALUES (?,?,?,?,1)", [userId, workspaceId, key, payload]);
        return true;
      } catch (error) {
        if ((error as { code?: string }).code === "ER_DUP_ENTRY") return false;
        throw error;
      }
    }
    const result = await this.pool.query("UPDATE personal_items SET payload=?,version=version+1,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND workspace_id=? AND item_key=? AND version=?", [payload, userId, workspaceId, key, expected]);
    return result.affectedRows === 1;
  }
}
