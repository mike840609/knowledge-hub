import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveGoogleIdentity = vi.hoisted(() => vi.fn());
vi.mock("@/server/google-identity", () => ({ resolveGoogleIdentity }));

import { authCallbacks } from "@/auth-callbacks";

type JwtArgs = { token: Record<string, unknown>; account?: unknown; profile?: unknown };
const jwt = authCallbacks.jwt as unknown as (args: JwtArgs) => Promise<Record<string, unknown>>;
type SessionArgs = { session: { user?: Record<string, unknown> }; token: Record<string, unknown> };
const session = authCallbacks.session as unknown as (args: SessionArgs) => Promise<{ user?: Record<string, unknown> }>;

const identity = {
  id: "0199f400-0000-7000-8000-0000000006a1",
  emp_id: "DEMO-ABC1234567",
  name: "Wang Xiaoming",
  org_code: "DEMO",
};

beforeEach(() => resolveGoogleIdentity.mockReset());

describe("jwt callback", () => {
  it("stores the Hub identity on the first Google sign-in", async () => {
    resolveGoogleIdentity.mockResolvedValue(identity);
    const token = await jwt({
      token: {},
      account: { provider: "google" },
      profile: { sub: "google-subject-1", name: "Wang", email: "wang@example.com" },
    });
    expect(resolveGoogleIdentity).toHaveBeenCalledWith({
      subject: "google-subject-1",
      name: "Wang",
      email: "wang@example.com",
    });
    expect(token).toMatchObject({
      hubUserId: identity.id,
      empId: identity.emp_id,
      orgCode: "DEMO",
      displayName: "Wang Xiaoming",
    });
  });

  it("tolerates a profile without a name", async () => {
    resolveGoogleIdentity.mockResolvedValue(identity);
    await jwt({
      token: {},
      account: { provider: "google" },
      profile: { sub: "google-subject-1", email: "wang@example.com" },
    });
    expect(resolveGoogleIdentity).toHaveBeenCalledWith({
      subject: "google-subject-1",
      name: "",
      email: "wang@example.com",
    });
  });

  it("never resolves a user for another provider or a missing subject", async () => {
    await jwt({ token: {}, account: { provider: "company-sso" }, profile: { sub: "subject" } });
    await jwt({ token: {}, account: { provider: "google" }, profile: { email: "wang@example.com" } });
    await jwt({ token: {}, profile: { sub: "subject" } });
    expect(resolveGoogleIdentity).not.toHaveBeenCalled();
  });

  it("leaves a token from an earlier sign-in alone", async () => {
    const token = await jwt({ token: { hubUserId: identity.id }, account: null, profile: null });
    expect(token).toEqual({ hubUserId: identity.id });
  });
});

describe("session callback", () => {
  it("copies the Hub identity from the token", async () => {
    const result = await session({
      session: { user: { name: "Wang" } },
      token: { hubUserId: identity.id, empId: identity.emp_id, orgCode: "DEMO", displayName: "Wang" },
    });
    expect(result.user).toMatchObject({
      name: "Wang",
      hubUserId: identity.id,
      empId: identity.emp_id,
      orgCode: "DEMO",
      displayName: "Wang",
    });
  });

  it("uses empty strings for a token without Hub fields", async () => {
    const result = await session({ session: { user: {} }, token: {} });
    expect(result.user).toMatchObject({ hubUserId: "", empId: "", orgCode: "", displayName: "" });
  });

  it("leaves a session without a user alone", async () => {
    const result = await session({ session: {}, token: { hubUserId: identity.id } });
    expect(result.user).toBeUndefined();
  });
});
