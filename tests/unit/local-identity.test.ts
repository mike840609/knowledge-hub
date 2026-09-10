import { afterEach, describe, expect, it } from "vitest";
import { LocalIdentityProvider } from "@/infrastructure/identity/local-identity-provider";
import { IdentityError } from "@/modules/knowledge/domain/errors";

const names = ["KM_LOCAL_IDENTITY_ENABLED", "KM_LOCAL_ID", "KM_LOCAL_EMP_ID", "KM_LOCAL_NAME", "KM_LOCAL_ORG_CODE"];
const saved = new Map(names.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of names) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

describe("local identity", () => {
  it("returns exactly the configured four-field caller", async () => {
    process.env.KM_LOCAL_IDENTITY_ENABLED = "true";
    process.env.KM_LOCAL_ID = "id";
    process.env.KM_LOCAL_EMP_ID = "emp";
    process.env.KM_LOCAL_NAME = "Local User";
    process.env.KM_LOCAL_ORG_CODE = "ORG";
    await expect(new LocalIdentityProvider().getCurrentIdentity()).resolves.toEqual({ id: "id", emp_id: "emp", name: "Local User", org_code: "ORG" });
  });

  it("fails closed when local mode is disabled or incomplete", async () => {
    process.env.KM_LOCAL_IDENTITY_ENABLED = "false";
    await expect(new LocalIdentityProvider().getCurrentIdentity()).rejects.toBeInstanceOf(IdentityError);
    process.env.KM_LOCAL_IDENTITY_ENABLED = "true";
    await expect(new LocalIdentityProvider().getCurrentIdentity()).rejects.toBeInstanceOf(IdentityError);
  });
});
