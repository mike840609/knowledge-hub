import { NextResponse, type NextRequest } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { contentSecurityPolicy, NONCE_HEADER } from "@/lib/content-security-policy";
import { googleGate } from "@/lib/auth-paths";
import { isSitePasswordExempt, verifySitePassword } from "@/lib/site-password";

type GoogleAuthMiddleware = (
  handler: (request: NextAuthRequest) => Response | Promise<Response>,
) => (request: NextRequest) => Promise<Response>;

/**
 * The policy that applies to every deployment: the optional site password and
 * the per-response CSP. Google is an additive gate in `middleware`; when it is
 * not selected this function behaves exactly as before.
 */
async function applyLegacyPolicy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const password = process.env.KM_SITE_PASSWORD;
  if (password && !isSitePasswordExempt(pathname)) {
    if (!(await verifySitePassword(request.headers.get("authorization"), password))) {
      // A challenge on an XHR/fetch 401 can raise the browser's credential
      // dialog over a public share page, whose Save button calls a gated API.
      // Pages keep the challenge; APIs just answer 401.
      const headers: Record<string, string> = { "Cache-Control": "no-store" };
      if (!pathname.startsWith("/api/")) {
        headers["WWW-Authenticate"] = 'Basic realm="Knowledge Hub", charset="UTF-8"';
      }
      return new NextResponse("Authentication required.", { status: 401, headers });
    }
  }
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy({ nonce, pathname, development: process.env.NODE_ENV === "development" });
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export async function middleware(request: NextRequest): Promise<Response> {
  if (process.env.KM_IDENTITY_PROVIDER !== "google") return applyLegacyPolicy(request);

  const { googleAuth } = await import("@/auth.edge");
  const authMiddleware = googleAuth as unknown as GoogleAuthMiddleware;
  return authMiddleware((req) => {
    const decision = googleGate({
      pathname: req.nextUrl.pathname,
      search: req.nextUrl.search,
      hasSession: Boolean(req.auth),
    });
    if (decision.kind === "allow") return applyLegacyPolicy(req);
    if (decision.kind === "unauthorized") {
      return NextResponse.json(
        { error: { code: "AUTH_REQUIRED", message: "Sign in required." } },
        { status: 401, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.redirect(new URL(decision.location, req.url));
  })(request);
}

export const config = {
  // Pages and API routes. Static assets never need the password; share pages
  // and the review API are exempted inside the function.
  matcher: ["/((?!_next/static|_next/image|icon.svg|icons/).*)"],
};
