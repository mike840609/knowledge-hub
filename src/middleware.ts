import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, NONCE_HEADER } from "@/lib/content-security-policy";
import { isSitePasswordExempt, verifySitePassword } from "@/lib/site-password";

/**
 * Two concerns, in order:
 *
 * 1. An optional site password (`KM_SITE_PASSWORD`). It is deliberately not a
 *    sign-in system: the identity is still the server-configured local user.
 *    It only stops "anyone with the URL is the operator". Share links and the
 *    token-gated review API stay public; every other page and API needs it.
 * 2. A per-response Content-Security-Policy nonce for pages. API answers are
 *    not documents; they keep the static policy from next.config.ts.
 */
export async function middleware(request: NextRequest) {
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

export const config = {
  // Pages and API routes. Static assets never need the password; share pages
  // and the review API are exempted inside the function.
  matcher: ["/((?!_next/static|_next/image|icon.svg|icons/).*)"],
};
