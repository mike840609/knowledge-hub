import { expect, it, vi } from "vitest";
import { MariaDbReviewFollowsRepository } from "@/infrastructure/database/mariadb/repositories/review-follows";
import { SHARE_CREATOR_READ_ROLES } from "@/modules/knowledge/domain/document-share-link";
import type { QueryConnection } from "@/infrastructure/database/mariadb/repositories/shared";

it("counts only authorized standing unread threads using a bounded SQL aggregate", async () => {
  const query = vi.fn().mockResolvedValue([{ unread: 4n }]);
  const repository = new MariaDbReviewFollowsRepository({ query } as unknown as QueryConnection);
  const now = new Date("2026-11-01T12:00:00Z");
  expect(await repository.countUnreadFollowing("reader", now, 100)).toBe(4);
  expect(query).toHaveBeenCalledTimes(1);
  const [sql, params] = query.mock.calls[0] as [string, unknown[]];
  expect(sql).toContain("COUNT(*)");
  expect(sql).toContain("LIMIT ?");
  expect(sql).toContain("l.document_id = t.document_id");
  expect(sql).toContain("w.personal_owner_user_id = l.created_by");
  expect(sql).toContain("m.role IS NULL");
  expect(sql).toContain("c.deleted_at IS NULL");
  expect(sql).toContain("c.visibility = 'VISIBLE'");
  expect(sql).toContain("c.created_at > f.seen_at");
  expect(sql).not.toContain("c.body");
  expect(sql).not.toMatch(/SELECT\s+(c\.\*)|(\*\s+FROM\s+document_review_comments)/);
  expect(params).toEqual(["reader", 100, ...SHARE_CREATOR_READ_ROLES, now]);
});
