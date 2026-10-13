import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, NONCE_HEADER } from "@/lib/content-security-policy";

/**
 * Gives every page a Content-Security-Policy with a nonce of its own.
 *
 * The policy goes on the request as well as the response: Next reads the nonce out of the request's
 * header to put it on the scripts it writes, and the layout reads `x-nonce` for the one it writes.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy({ nonce, pathname: request.nextUrl.pathname, development: process.env.NODE_ENV === "development" });
  const headers = new Headers(request.headers);
  headers.set(NONCE_HEADER, nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Pages only. An API answer and a static file are not documents a policy governs; they keep the
  // static policy `next.config.ts` sets on every path. A shared page's image (`/s/:token/asset`) is
  // bytes, not a page: it must keep the sandboxing policy set for it there, which this one would replace.
  matcher: ["/((?!api/|_next/static|_next/image|icon.svg|icons/|s/[^/]+/asset).*)"],
};
