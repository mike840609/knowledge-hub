import { AuthRequiredError, AuthUnavailableError } from "@/modules/identity/domain/identity-session-errors";
import { afterEach, describe, expect, it } from "vitest";
import { LocalIdentityProvider } from "@/infrastructure/identity/local-identity-provider";
import { CompanySsoIdentityProvider } from "@/infrastructure/identity/company-sso-identity-provider";
import { createIdentityProvider } from "@/server/identity-provider-factory";
import type { CompanySsoSessionReader } from "@/modules/identity/ports/company-sso-session-reader";
import { IdentityError } from "@/modules/knowledge/domain/errors";

const ENV_NAMES = [
  "KM_LOCAL_IDENTITY_ENABLED",
  "KM_LOCAL_ID",
  "KM_LOCAL_EMP_ID",
  "KM_LOCAL_NAME",
  "KM_LOCAL_ORG_CODE",
  "KM_IDENTITY_PROVIDER",
  "KM_COMPANY_SSO_PROVIDER",
  "KM_COMPANY_SSO_TEAM_CREATE_GROUPS",
  "KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION",
  "NODE_ENV",
];
const saved = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

function setNodeEnv(value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

afterEach(() => {
  for (const name of ENV_NAMES) {
    const value = saved.get(name);
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function enableLocal(): void {
  process.env.KM_LOCAL_IDENTITY_ENABLED = "true";
  process.env.KM_LOCAL_ID = "local-id-1";
  process.env.KM_LOCAL_EMP_ID = "LOCAL-0001";
  process.env.KM_LOCAL_NAME = "Local User";
  process.env.KM_LOCAL_ORG_CODE = "LOCAL";
}

function trackingReader(session: {
  subject: string;
  emp_id: string;
  name: string;
  org_code: string;
  externalGroupIds: readonly string[];
}): CompanySsoSessionReader & { calls: number } {
  const reader = {
    calls: 0,
    async readSession() {
      reader.calls += 1;
      return { ...session, externalGroupIds: [...session.externalGroupIds] };
    },
  };
  return reader;
}

describe("Local identity provider claims", () => {
  it("mirrors the server-configured profile with provider 'local' and no groups or platform capabilities", async () => {
    enableLocal();
    const claims = await new LocalIdentityProvider().getCurrentClaims();
    expect(claims.externalIdentity).toEqual({
      provider: "local",
      subject: "local-id-1",
      emp_id: "LOCAL-0001",
      name: "Local User",
      org_code: "LOCAL",
    });
    expect(claims.validatedExternalGroupIds).toEqual([]);
    expect(claims.platformCapabilities).toEqual([]);
    expect(claims.refreshedAt).toBeInstanceOf(Date);
  });

  it("refreshes claims on every call instead of serving a stale snapshot", async () => {
    enableLocal();
    const provider = new LocalIdentityProvider();
    const first = await provider.getCurrentClaims();
    const second = await provider.getCurrentClaims();
    expect(second.refreshedAt.getTime()).toBeGreaterThanOrEqual(first.refreshedAt.getTime());
    expect(second.refreshedAt).not.toBe(first.refreshedAt);
  });

  it("fails closed when local mode is disabled", async () => {
    process.env.KM_LOCAL_IDENTITY_ENABLED = "false";
    await expect(new LocalIdentityProvider().getCurrentClaims()).rejects.toBeInstanceOf(IdentityError);
  });
});

describe("Company SSO identity provider claims", () => {
  it("passes the trusted subject through with exact bytes and maps profile plus validated groups", async () => {
    const reader = trackingReader({
      subject: "  Sub-Ject_01  ",
      emp_id: "E1001",
      name: "SSO User",
      org_code: "RD",
      externalGroupIds: ["sso-eng", "sso-eng", "", "sso-platform"],
    });
    const claims = await new CompanySsoIdentityProvider(reader, {
      provider: "company-sso",
      teamCreateGroupIds: [],
    }).getCurrentClaims();
    expect(claims.externalIdentity).toEqual({
      provider: "company-sso",
      subject: "  Sub-Ject_01  ",
      emp_id: "E1001",
      name: "SSO User",
      org_code: "RD",
    });
    expect(claims.validatedExternalGroupIds).toEqual(["sso-eng", "sso-platform"]);
    expect(claims.platformCapabilities).toEqual([]);
    expect(claims.refreshedAt).toBeInstanceOf(Date);
  });

  it("maps platform capabilities server-side from trusted group membership", async () => {
    const member = trackingReader({
      subject: "sub-admin",
      emp_id: "E1002",
      name: "SSO Admin",
      org_code: "IT",
      externalGroupIds: ["sso-platform-admins", "sso-eng"],
    });
    const memberClaims = await new CompanySsoIdentityProvider(member, {
      provider: "company-sso",
      teamCreateGroupIds: ["sso-platform-admins"],
    }).getCurrentClaims();
    expect(memberClaims.platformCapabilities).toEqual(["workspace.create_team"]);

    const outsider = trackingReader({
      subject: "sub-viewer",
      emp_id: "E1003",
      name: "SSO Viewer",
      org_code: "HR",
      externalGroupIds: ["sso-eng"],
    });
    const outsiderClaims = await new CompanySsoIdentityProvider(outsider, {
      provider: "company-sso",
      teamCreateGroupIds: ["sso-platform-admins"],
    }).getCurrentClaims();
    expect(outsiderClaims.platformCapabilities).toEqual([]);
  });

  it("re-reads the server-side session on every call with a fresh refreshedAt", async () => {
    const reader = trackingReader({
      subject: "sub-refresh",
      emp_id: "E1004",
      name: "SSO Refresh",
      org_code: "RD",
      externalGroupIds: [],
    });
    const provider = new CompanySsoIdentityProvider(reader, { provider: "company-sso", teamCreateGroupIds: [] });
    const first = await provider.getCurrentClaims();
    const second = await provider.getCurrentClaims();
    expect(reader.calls).toBe(2);
    expect(second.refreshedAt.getTime()).toBeGreaterThanOrEqual(first.refreshedAt.getTime());
  });

  it("fails closed when the trusted session is missing required identity fields", async () => {
    const reader = trackingReader({ subject: "", emp_id: "E1005", name: "No Subject", org_code: "RD", externalGroupIds: [] });
    await expect(
      new CompanySsoIdentityProvider(reader, { provider: "company-sso", teamCreateGroupIds: [] }).getCurrentClaims(),
    ).rejects.toBeInstanceOf(AuthUnavailableError);
  });

  it("rejects an unconfigured provider name instead of issuing claims", async () => {
    const reader = trackingReader({ subject: "sub-x", emp_id: "E1006", name: "X", org_code: "RD", externalGroupIds: [] });
    expect(() => new CompanySsoIdentityProvider(reader, { provider: "", teamCreateGroupIds: [] })).toThrow(IdentityError);
  });

  it("never fabricates a Hub identity directly; resolution must go through HubIdentityResolver", async () => {
    const reader = trackingReader({ subject: "sub-x", emp_id: "E1007", name: "X", org_code: "RD", externalGroupIds: [] });
    const provider = new CompanySsoIdentityProvider(reader, { provider: "company-sso", teamCreateGroupIds: [] });
    await expect(provider.getCurrentIdentity()).rejects.toBeInstanceOf(IdentityError);
  });
});

describe("identity provider factory", () => {
  it("selects the Local provider by default in non-production", () => {
    enableLocal();
    delete process.env.KM_IDENTITY_PROVIDER;
    setNodeEnv("test");
    expect(createIdentityProvider()).toBeInstanceOf(LocalIdentityProvider);
  });

  it("fails closed in production when Local is selected; never silently falls back", () => {
    enableLocal();
    process.env.KM_IDENTITY_PROVIDER = "local";
    delete process.env.KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION;
    setNodeEnv("production");
    expect(() => createIdentityProvider()).toThrow(IdentityError);
  });

  it("allows Local in production only with the explicit test-only opt-in flag", () => {
    enableLocal();
    process.env.KM_IDENTITY_PROVIDER = "local";
    process.env.KM_ALLOW_LOCAL_IDENTITY_IN_PRODUCTION = "true";
    setNodeEnv("production");
    expect(createIdentityProvider()).toBeInstanceOf(LocalIdentityProvider);
  });

  it("fails closed when Company SSO is selected without a server-side session reader", () => {
    process.env.KM_IDENTITY_PROVIDER = "company-sso";
    setNodeEnv("production");
    expect(() => createIdentityProvider()).toThrow(AuthUnavailableError);
  });

  it("wires the Company provider from server-side configuration when a reader is present", () => {
    process.env.KM_IDENTITY_PROVIDER = "company-sso";
    process.env.KM_COMPANY_SSO_PROVIDER = "company-sso";
    process.env.KM_COMPANY_SSO_TEAM_CREATE_GROUPS = "sso-platform-admins";
    setNodeEnv("production");
    const reader = trackingReader({ subject: "sub-1", emp_id: "E1", name: "N", org_code: "O", externalGroupIds: [] });
    expect(createIdentityProvider({ companySessionReader: reader })).toBeInstanceOf(CompanySsoIdentityProvider);
  });

  it("rejects an unknown provider kind", () => {
    process.env.KM_IDENTITY_PROVIDER = "browser-magic";
    setNodeEnv("test");
    expect(() => createIdentityProvider()).toThrow(IdentityError);
  });
});

it("distinguishes absent session from broken session integration",async()=>{
 const options={provider:"company-sso",teamCreateGroupIds:[]};
 await expect(new CompanySsoIdentityProvider({readSession:async()=>null},options).getCurrentClaims()).rejects.toBeInstanceOf(AuthRequiredError);
 await expect(new CompanySsoIdentityProvider({readSession:async()=>{throw new Error("secret");}},options).getCurrentClaims()).rejects.toBeInstanceOf(AuthUnavailableError);
});

describe("an unavailable identity provider keeps why, and tells the client nothing about it",()=>{
 const options={provider:"company-sso",teamCreateGroupIds:[]};
 const failure=async(reader:{readSession:()=>Promise<unknown>})=>new CompanySsoIdentityProvider(reader as never,options).getCurrentClaims().then(()=>{throw new Error("expected a rejection");},(error:unknown)=>error as AuthUnavailableError);
 it("carries the session reader's own error as the cause",async()=>{
  const cause=new Error("gateway socket closed");
  const error=await failure({readSession:async()=>{throw cause;}});
  expect(error).toBeInstanceOf(AuthUnavailableError);expect(error.cause).toBe(cause);expect(error.message).not.toContain("gateway");
 });
 it.each(["subject","emp_id","name"])("names the missing session field %s in the cause only",async field=>{
  const session={subject:"s",emp_id:"e",name:"n",org_code:"o",externalGroupIds:[],[field]:""};
  const error=await failure({readSession:async()=>session});
  expect(error).toBeInstanceOf(AuthUnavailableError);expect(String((error.cause as Error).message)).toContain(field);expect(error.message).not.toContain(field);
 });
 it("says why an unwired session reader is unavailable",()=>{
  process.env.KM_IDENTITY_PROVIDER="company-sso";
  let thrown:unknown;try{createIdentityProvider();}catch(error){thrown=error;}
  expect(thrown).toBeInstanceOf(AuthUnavailableError);expect(String(((thrown as AuthUnavailableError).cause as Error).message)).toContain("session reader");
 });
 it("has no cause when none is given, and messages that belong to no one feature",()=>{
  expect(new AuthUnavailableError().cause).toBeUndefined();
  for(const error of [new AuthUnavailableError(),new AuthRequiredError()])expect(error.message).not.toMatch(/comment|discussion|document/i);
  expect(new AuthUnavailableError()).toMatchObject({code:"AUTH_UNAVAILABLE"});expect(new AuthRequiredError()).toMatchObject({code:"AUTH_REQUIRED"});
 });
});
