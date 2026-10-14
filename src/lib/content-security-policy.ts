import { THEME_PRE_PAINT_SCRIPT_HASH } from "@/app/theme-script";

/** The request header the middleware hands the nonce to the layout in. */
export const NONCE_HEADER = "x-nonce";

/**
 * The policy a page is sent, for one response.
 *
 * `script-src` is the reason it is built per response: a script runs only if it carries this
 * response's nonce (Next puts it on its own; the layout puts it on the theme script) or was loaded
 * by one that does. Markup that reached the page some other way does not run. The reader emits
 * none of the author's HTML to begin with (`remark-html-subset.ts`); this is the second line behind
 * that, and the only one behind everything else that renders text.
 *
 * `img-src 'self' blob:` is issue #20's: a remote image URL that ever reached markup is not loaded.
 * `blob:` is for a drawn diagram (reader-mermaid spec): such a URL is minted only by script already
 * running here, and a document cannot name one (`markdown-image-policy.ts` refuses the scheme).
 * A shared page, which needs no sign-in, may not be framed (share-link spec §6.4).
 *
 * No `form-action`: whether production sign-in posts a form to the identity provider is not
 * something this repository knows. No `style-src`: the editor and the tables set inline styles.
 */
export function contentSecurityPolicy({ nonce, pathname, development }: { nonce: string; pathname: string; development: boolean }): string {
  const scripts = ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", `'${THEME_PRE_PAINT_SCRIPT_HASH}'`];
  // React's development build evaluates strings to rebuild stack traces; the production one does not.
  if (development) scripts.push("'unsafe-eval'");
  const policy = [`script-src ${scripts.join(" ")}`, "img-src 'self' blob:", "object-src 'none'", "base-uri 'self'"];
  if (pathname.startsWith("/s/")) policy.push("frame-ancestors 'none'");
  return policy.join("; ");
}
