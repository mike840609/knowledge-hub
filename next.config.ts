import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the running dev server's chunks separate from `next build` output.
  // A production build can otherwise replace .next while dev still serves it.
  // KM_NEXT_DIST_DIR lets a second dev server run beside the first without sharing its output
  // (`make dev-reviewer`, docs/development/two-person-demo.md).
  distDir: process.env.KM_NEXT_DIST_DIR ?? (process.env.NODE_ENV === "development" ? ".next-dev" : ".next"),
  // Issue #20 second layer: even if a remote image URL ever reaches markup,
  // the browser must refuse to load it. `img-src 'self' blob:` allows only
  // same-origin / relative images, and the diagrams the page itself draws (data: intentionally not allowed).
  //
  // A page gets its policy from `src/middleware.ts`, which sets this header again
  // with a nonce for scripts and replaces what is set here. These values are what
  // a path the middleware does not match is left with: API answers and static files.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "img-src 'self' blob:" }],
      },
      {
        // Share links need no sign-in (share-link spec §6.4): the token must
        // not leak through Referer, a revoked link must not be served from a
        // cache, crawlers must not index it, and no site may frame it.
        // Next.js keeps only the LAST matching header per key, so this CSP
        // repeats the global img-src directive; setting frame-ancestors alone
        // would silently drop the Issue #20 image lockdown on the one page
        // that needs no sign-in.
        source: "/s/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Content-Security-Policy", value: "img-src 'self' blob:; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
