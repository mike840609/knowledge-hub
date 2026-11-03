import { beforeEach, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";

const list = vi.hoisted(() => vi.fn());
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: callerFromIdentity({ id: "u1", emp_id: "E001", name: "Ada", org_code: "ORG" }) }),
    feedbackIssues: { list },
  }),
}));

import { GET } from "@/app/api/feedback-reports/route";

const cursorId = "0199f400-0000-7000-8000-000000000001";
beforeEach(() => { list.mockReset().mockResolvedValue({ items: [], nextCursor: null }); });

it("lists reports for the trusted caller without taking a workspace", async () => {
  const response = await GET(new Request(`http://hub.test/api/feedback-reports?status=RESOLVED&mine=true&beforeAt=2026-11-03T01%3A02%3A03.000Z&beforeId=${cursorId}`));

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  expect(list).toHaveBeenCalledWith(
    expect.objectContaining({ identity: expect.objectContaining({ id: "u1" }) }),
    { status: "RESOLVED", category: undefined, mine: "true", beforeAt: "2026-11-03T01:02:03.000Z", beforeId: cursorId },
  );
  expect(await response.json()).toEqual({ items: [], nextCursor: null });
});

it("rejects a status the list does not understand", async () => {
  list.mockRejectedValue(new DomainError("INVALID_REQUEST", "Choose a status: OPEN, IN_PROGRESS, RESOLVED or DUPLICATE."));

  const response = await GET(new Request("http://hub.test/api/feedback-reports?status=CLOSED"));

  expect(response.status).toBe(400);
});
