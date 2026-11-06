import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";

const injected = vi.hoisted(() => ({ rotate: vi.fn(), create: vi.fn(), list: vi.fn(), revoke: vi.fn() }));
vi.mock("@/server/composition", () => ({
  applicationServices: () => ({
    establishTrustedCaller: async () => ({ caller: callerFromIdentity({ id: "u1", emp_id: "E001", name: "Ada", org_code: "ORG" }) }),
    taskExportBindings: injected,
  }),
}));

import { POST as rotate } from "@/app/api/workspaces/[workspaceId]/task-export-bindings/[bindingId]/credentials/route";
import { GET as list, POST as create } from "@/app/api/workspaces/[workspaceId]/task-export-bindings/route";

const params = { params: Promise.resolve({ workspaceId: "w1", bindingId: "b1" }) };
const post = (url: string, body?: unknown, origin = "http://hub.test") =>
  new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("KM_PUBLIC_ORIGIN", "");
  for (const fn of Object.values(injected)) fn.mockReset();
});

it("maps a revoked binding on rotate to 409 BINDING_REVOKED, uncached", async () => {
  injected.rotate.mockRejectedValue(new DomainError("BINDING_REVOKED", "This binding was revoked."));
  const response = await rotate(post("http://hub.test/api/workspaces/w1/task-export-bindings/b1/credentials"), params);
  expect(response.status).toBe(409);
  expect((await response.json()).error.code).toBe("BINDING_REVOKED");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it("returns a rotated token once, uncached", async () => {
  injected.rotate.mockResolvedValue({ token: "khx_new" });
  const response = await rotate(post("http://hub.test/api/workspaces/w1/task-export-bindings/b1/credentials"), params);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ token: "khx_new" });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(injected.rotate).toHaveBeenCalledWith(expect.anything(), { workspaceId: "w1", bindingId: "b1" });
});

it("creates with 201 from the body's label only, ignoring any Source or owner it names", async () => {
  injected.create.mockResolvedValue({ bindingId: "b2", token: "khx_t" });
  const response = await create(post("http://hub.test/api/workspaces/w1/task-export-bindings", { sourceId: "s1", label: "laptop", ownerUserId: "u2" }), params);
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(injected.create).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ id: "u1" }) }), { workspaceId: "w1", label: "laptop" });
});

it("refuses a cross-site mutation before reaching the service", async () => {
  const response = await create(post("http://hub.test/api/workspaces/w1/task-export-bindings", { sourceId: "s1", label: "x" }, "http://evil.test"), params);
  expect(response.status).toBe(403);
  expect(injected.create).not.toHaveBeenCalled();
});

it("lists without a token field, uncached", async () => {
  injected.list.mockResolvedValue([{ bindingId: "b1", label: "laptop" }]);
  const response = await list(new Request("http://hub.test/api/workspaces/w1/task-export-bindings"), params);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ bindings: [{ bindingId: "b1", label: "laptop" }] });
});

it("never updates a binding's source", () => {
  const repository = readFileSync(path.join(process.cwd(), "src/infrastructure/database/mariadb/repositories/task-knowledge.ts"), "utf8");
  const updates = repository.match(/UPDATE task_export_bindings[^"`]*/g) ?? [];
  expect(updates.length).toBeGreaterThan(0);
  for (const statement of updates) expect(statement).not.toMatch(/source_id\s*=/);
});
