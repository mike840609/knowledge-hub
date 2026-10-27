import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoogleIdentityProvider, type GoogleSessionReader } from "@/infrastructure/identity/google-identity-provider";
import { AuthRequiredError } from "@/modules/identity/domain/identity-session-errors";

let readSession: ReturnType<typeof vi.fn<GoogleSessionReader>>;

beforeEach(() => {
  readSession = vi.fn<GoogleSessionReader>();
});

describe("GoogleIdentityProvider", () => {
  it("maps the Auth.js session to the Hub identity", async () => {
    readSession.mockResolvedValue({
      user: { hubUserId: "u1", empId: "DEMO-ABC1234567", displayName: "Wang", orgCode: "DEMO" },
    });
    await expect(new GoogleIdentityProvider(readSession).getCurrentIdentity()).resolves.toEqual({
      id: "u1",
      emp_id: "DEMO-ABC1234567",
      name: "Wang",
      org_code: "DEMO",
    });
  });

  it("exposes the same identity as Google claims", async () => {
    readSession.mockResolvedValue({
      user: { hubUserId: "u1", empId: "DEMO-ABC1234567", displayName: "Wang", orgCode: "DEMO" },
    });
    const claims = await new GoogleIdentityProvider(readSession).getCurrentClaims();
    expect(claims.externalIdentity).toMatchObject({
      provider: "google",
      subject: "u1",
      emp_id: "DEMO-ABC1234567",
      name: "Wang",
      org_code: "DEMO",
    });
    expect(claims.validatedExternalGroupIds).toEqual([]);
    expect(claims.platformCapabilities).toEqual([]);
  });

  it("throws AuthRequiredError without a session", async () => {
    readSession.mockResolvedValue(null);
    await expect(new GoogleIdentityProvider(readSession).getCurrentIdentity()).rejects.toBeInstanceOf(AuthRequiredError);
  });
});
