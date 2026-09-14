import type { ExternalIdentityLink } from "@/modules/identity/domain/external-company-identity";
import type { ExternalIdentityLinkRepository } from "@/modules/identity/ports/external-identity-link-repository";
import type { DbRow, QueryConnection } from "./shared";
import { asDate, asRequiredString } from "./shared";

function asSubject(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  throw new Error("Database returned an invalid identity subject.");
}

function mapLink(row: DbRow): ExternalIdentityLink {
  return {
    id: asRequiredString(row.id, "identity link id"),
    provider: asRequiredString(row.provider, "identity link provider"),
    subject: asSubject(row.subject_bytes),
    hubUserId: asRequiredString(row.hub_user_id, "identity link hub user"),
    createdAt: asDate(row.created_at),
    lastSeenAt: asDate(row.last_seen_at),
  };
}

function toSubjectBytes(subject: string): Buffer {
  return Buffer.from(subject, "utf8");
}

export class MariaDbExternalIdentityLinkRepository implements ExternalIdentityLinkRepository {
  constructor(private readonly connection: QueryConnection) {}

  async findByProviderSubject(provider: string, subject: string): Promise<ExternalIdentityLink | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT id, provider, subject_bytes, hub_user_id, created_at, last_seen_at FROM external_identity_links WHERE provider = ? AND subject_bytes = ?",
      [provider, toSubjectBytes(subject)],
    );
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async findByProviderHubUser(provider: string, hubUserId: string): Promise<ExternalIdentityLink | null> {
    const rows = await this.connection.query<DbRow[]>(
      "SELECT id, provider, subject_bytes, hub_user_id, created_at, last_seen_at FROM external_identity_links WHERE provider = ? AND hub_user_id = ?",
      [provider, hubUserId],
    );
    return rows[0] ? mapLink(rows[0]) : null;
  }

  async insert(link: ExternalIdentityLink): Promise<void> {
    await this.connection.query(
      "INSERT INTO external_identity_links (id, provider, subject_bytes, hub_user_id, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)",
      [link.id, link.provider, toSubjectBytes(link.subject), link.hubUserId, link.createdAt, link.lastSeenAt],
    );
  }

  async touchLastSeen(id: string, lastSeenAt: Date): Promise<void> {
    await this.connection.query("UPDATE external_identity_links SET last_seen_at = ? WHERE id = ?", [lastSeenAt, id]);
  }
}
