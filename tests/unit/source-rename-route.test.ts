import { describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { SourceNotFoundError, ValidationError } from "@/modules/knowledge/domain/errors";
import type { applicationServices as ApplicationServicesFn } from "@/server/composition";

vi.mock("@/server/composition", () => ({ applicationServices: vi.fn() }));

import { applicationServices } from "@/server/composition";
import { POST } from "@/app/api/sources/[sourceId]/rename/route";

type Services = ReturnType<typeof ApplicationServicesFn>;

const caller = callerFromIdentity({ id: "0199f600-0000-7000-8000-000000000001", emp_id: "REN-1", name: "R", org_code: "HRSD" });
const sourceId = "0199f600-0000-7000-8000-000000000002";
const context = { params: Promise.resolve({ sourceId }) };

function services(renameSource: (caller: unknown, sourceId: string, name: string) => Promise<void>): Services {
  return {
    establishTrustedCaller: vi.fn(async () => ({ caller })),
    sources: { renameSource },
  } as unknown as Services;
}

function request(body: unknown): Request {
  return new Request(`http://127.0.0.1/api/sources/${sourceId}/rename`, { method: "POST", body: JSON.stringify(body) });
}

describe("POST /api/sources/[sourceId]/rename", () => {
  it("passes the name through and answers 204", async () => {
    const renameSource = vi.fn(async () => {});
    vi.mocked(applicationServices).mockReturnValue(services(renameSource));

    const response = await POST(request({ name: "Research Vault" }), context);

    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(renameSource).toHaveBeenCalledWith(caller, sourceId, "Research Vault");
  });

  it("rejects a body without a string name", async () => {
    const renameSource = vi.fn(async () => {});
    vi.mocked(applicationServices).mockReturnValue(services(renameSource));

    const response = await POST(request({ name: 42 }), context);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "INVALID_REQUEST" } });
    expect(renameSource).not.toHaveBeenCalled();
  });

  it("maps validation and missing-source errors", async () => {
    vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new ValidationError("Too long."); }));
    expect((await POST(request({ name: "x" }), context)).status).toBe(400);

    vi.mocked(applicationServices).mockReturnValue(services(async () => { throw new SourceNotFoundError(); }));
    const missing = await POST(request({ name: "x" }), context);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: { code: "NOT_FOUND" } });
  });
});
