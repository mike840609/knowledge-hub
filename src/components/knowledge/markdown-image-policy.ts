/**
 * Markdown image URL policy (issue #20).
 *
 * Markdown documents are shared/imported content, so `![alt](src)` must never
 * cause a reader's browser to auto-fetch an arbitrary remote URL (tracking
 * pixels, browser-reachable internal services, loopback endpoints, ...).
 *
 * Policy (default-deny):
 * - ALLOW relative URLs (`/assets/...`, `./img.png`, `../img.png`, `img.png`,
 *   also `?query` / `#fragment` which resolve against the current document).
 *   These resolve to the Knowledge Hub origin itself (managed/relative assets)
 *   and cannot target an arbitrary remote host.
 * - ALLOW absolute `http(s)` URLs only when they are same-origin with the
 *   running Hub app (caller supplies `origin`, e.g. `window.location.origin`).
 *   Without a caller-supplied origin, same-origin cannot be proven, so deny.
 * - BLOCK protocol-relative URLs (`//host/...`), which inherit the page
 *   scheme and can target any host.
 * - BLOCK every non-http(s) scheme (`data:`, `blob:`, `javascript:`, ...).
 *   `data:` stays blocked unless a future use case explicitly justifies it.
 *
 * Defense in depth: `next.config.ts` additionally sends a restrictive
 * `img-src 'self'` Content-Security-Policy header, so even a policy bypass
 * in markup cannot load a cross-origin image.
 *
 * Links (`<a href>`) are intentionally NOT subject to this policy: clicking a
 * link is an explicit user action, while `<img src>` fetches automatically.
 * See `markdown-renderer.tsx` (`MarkdownLink` renders external links as-is).
 */
export function isAllowedMarkdownImageSrc(src: string, options?: { origin?: string }): boolean {
  const value = src.trim();
  if (!value) return false;
  // Protocol-relative URLs inherit the page scheme; treat as remote.
  if (value.startsWith("//")) return false;
  const schemeMatch = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.exec(value);
  if (!schemeMatch) {
    // No scheme => relative URL resolved against the Knowledge Hub origin.
    return true;
  }
  const scheme = schemeMatch[0].toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return false;
  }
  const origin = options?.origin;
  if (!origin) return false;
  try {
    return new URL(value).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}
