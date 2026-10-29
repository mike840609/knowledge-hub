import { beforeEach, expect, it, vi } from "vitest";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";
vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));
import { applicationServices } from "@/server/composition";
import { GET } from "@/app/api/documents/[documentId]/recovery-metadata/route";

type Services = ReturnType<typeof ApplicationServicesFn>;
const caller = { identity: { id: "user" } };
const getRevision = vi.fn(async () => ({ id: "base-id", metadata: { owner: "original" } }));
beforeEach(() => {
  getRevision.mockClear();
  vi.mocked(applicationServices).mockReturnValue({ establishTrustedCaller: async () => ({ caller }), queries: { getRevision } } as unknown as Services);
});

it("returns only the requested revision's identity and metadata", async () => {
  const response = await GET(new Request("http://localhost/api/documents/doc/recovery-metadata?revision=4"), { params: Promise.resolve({ documentId: "doc" }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ revisionId: "base-id", metadata: { owner: "original" } });
  expect(getRevision).toHaveBeenCalledWith(caller, "doc", 4, { includeArchived: true });
});

it("rejects an invalid revision number", async () => {
  const response = await GET(new Request("http://localhost/api/documents/doc/recovery-metadata?revision=0"), { params: Promise.resolve({ documentId: "doc" }) });
  expect(response.status).toBe(400);
  expect(getRevision).not.toHaveBeenCalled();
});
