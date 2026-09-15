import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Issue #20 second layer: even if a remote image URL ever reaches markup,
  // the browser must refuse to load it. `img-src 'self'` allows only
  // same-origin / relative images (data: intentionally not allowed).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "Content-Security-Policy", value: "img-src 'self'" }],
      },
    ];
  },
};

export default nextConfig;
