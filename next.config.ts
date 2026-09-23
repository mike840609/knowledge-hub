import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the running dev server's chunks separate from `next build` output.
  // A production build can otherwise replace .next while dev still serves it.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  // Issue #20 second layer: even if a remote image URL ever reaches markup,
  // the browser must refuse to load it. `img-src 'self'` allows only
  // same-origin / relative images (data: intentionally not allowed).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "img-src 'self'" }],
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
          { key: "Content-Security-Policy", value: "img-src 'self'; frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
