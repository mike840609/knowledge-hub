import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { auth } from "@/auth";
import { redirect } from "next/navigation";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import LoginPage from "@/app/login/page";
import { SignOutForm } from "@/components/auth/sign-out-form";

const signedIn = {
  user: { hubUserId: "u1", empId: "DEMO-ABC1234567", orgCode: "DEMO", displayName: "Wang" },
};

// `auth` and `redirect` are overloaded next-auth/Next.js types; the mocks only
// need the plain call shape.
const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const redirectMock = redirect as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  authMock.mockResolvedValue(null);
  redirectMock.mockClear();
});

afterEach(() => vi.unstubAllEnvs());

describe("Google demo auth UI", () => {
  it("renders the Google sign-in entry point", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    const element = await LoginPage({ searchParams: Promise.resolve({ returnTo: "/s/token" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Continue with Google");
  });

  it("explains a failed callback and offers a retry", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: "Configuration" }),
    });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Please try again.");
    expect(html).toContain("Continue with Google");
  });

  it("sends an already signed-in visitor to the requested destination", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    authMock.mockResolvedValue(signedIn as never);
    await LoginPage({ searchParams: Promise.resolve({ returnTo: "/s/token", error: "Configuration" }) });
    expect(redirectMock).toHaveBeenCalledWith("/s/token");
  });

  it("renders the sign-out form", () => {
    expect(renderToStaticMarkup(<SignOutForm />)).toContain("Sign out");
  });
});
