import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => null),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import LoginPage from "@/app/login/page";
import { SignOutForm } from "@/components/auth/sign-out-form";

afterEach(() => vi.unstubAllEnvs());

describe("Google demo auth UI", () => {
  it("renders the Google sign-in entry point", async () => {
    vi.stubEnv("KM_IDENTITY_PROVIDER", "google");
    const element = await LoginPage({ searchParams: Promise.resolve({ returnTo: "/s/token" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Continue with Google");
  });

  it("renders the sign-out form", () => {
    expect(renderToStaticMarkup(<SignOutForm />)).toContain("Sign out");
  });
});
