# A script policy for every page

## Intent and agreed product direction

The Content-Security-Policy was `img-src 'self'` (issue #20), with
`frame-ancestors 'none'` on shared pages. It said nothing about scripts, so
markup that reached a page by a route nobody foresaw would have run. The reader
emits none of an author's HTML (`2026-10-12-reader-html-subset-design.md`), but
that is one renderer; a policy covers every page and every future mistake.

Agreed with the user on 2026-10-12: add `script-src`, **enforced from the
start** rather than in report-only mode. There is no endpoint to collect
reports, and the e2e suite runs the whole product against a production build, so
a policy that breaks the app fails CI rather than failing quietly.

## The policy

```text
script-src 'self' 'nonce-<per response>' 'strict-dynamic' '<hash of the theme script>'
img-src 'self'
object-src 'none'
base-uri 'self'
frame-ancestors 'none'          on /s/* only, as before
```

In development `script-src` also has `'unsafe-eval'`, which React's development
build needs. It never has `'unsafe-inline'`.

- **Nonce and `strict-dynamic`.** A script runs if it carries the response's
  nonce, or was loaded by one that does. Next writes inline scripts whose
  content differs per request, so they cannot be allowed by hash; it puts the
  nonce on them itself when the request carries the policy.
- **The theme script's hash.** The script that stamps the theme before paint is
  written twice: by the root layout, a server component, which gives it the
  nonce; and by `global-error`, a client component, which cannot be given one.
  It is a constant, so the policy names its hash and the second copy runs by
  that. A unit test fails when the script changes and the hash does not.
- **`object-src 'none'`, `base-uri 'self'`.** Neither is used by the product;
  both are ways around a script policy.

Left out on purpose:

- **`form-action`.** Whether production sign-in posts a form to the identity
  provider is not something this repository knows.
- **`style-src`.** The editor, floating menus and table alignment set inline
  styles.
- **`frame-ancestors` everywhere.** A separate decision; unchanged.

## What it stops, and what it does not

Stopped: an inline `<script>` in markup, an inline event handler
(`onerror="…"`), a `javascript:` link, a `<script src>` to another origin
written into markup, `<base>` re-pointing relative URLs, plugins.

Not stopped: a script element that script already running creates and inserts.
That is what `strict-dynamic` means, and it is how Next loads its own chunks.
The policy is a second line behind not emitting markup, not a replacement for
it.

## Where it is set

`src/middleware.ts` makes the nonce, builds the policy
(`src/lib/content-security-policy.ts`) and sets it on the request — where Next
and the layout read the nonce — and on the response.

`next.config.ts` still sets the old static value on every path. On a page the
middleware's header replaces it (checked against a running server); what the
static value is left for is the paths the middleware does not match — API
answers and static files — which are not documents a script policy governs.
One consequence: a directive added in `next.config.ts` only does not reach
pages. `CLAUDE.md` says so.

Reading the nonce makes the root layout dynamic. Every route but `/_not-found`
already was; that one is now rendered per request too, which is what lets its
scripts carry a nonce.

## Tests

- `tests/unit/content-security-policy.test.ts` — the directives, that
  `unsafe-inline` is never present and `unsafe-eval` only in development, the
  framing rule by path, and the theme script's hash.
- `tests/e2e/content-security-policy.spec.ts`, against the production build —
  a page hydrates with nothing refused; each response has a nonce of its own;
  an inline handler, a `javascript:` link and a parser-inserted inline script
  do not run.
- `tests/e2e/share-link.spec.ts` — the shared page's header holds all three:
  the image lockdown, no framing, scripts by nonce.
