import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// The page policy must not reach image bytes: it would replace the sandboxing policy
// `next.config.ts` sets for them, and an SVG opened directly would be judged as a page.
const matcher = /matcher: \["([^"]+)"\]/.exec(readFileSync("src/middleware.ts", "utf8"))![1];
const governed = (pathname: string) => new RegExp(`^${matcher}$`).test(pathname);

it("gives pages the page policy, including the shared page and its sign-in hand-off", () => {
  for (const pathname of ["/", "/w/ws/home", "/s/0199f000-0000-4000-8000-000000000000", "/s/0199f000-0000-4000-8000-000000000000/open"]) expect(governed(pathname), pathname).toBe(true);
});
it("leaves API answers, static files and a shared page's images to their own policy", () => {
  for (const pathname of ["/api/documents/d/asset", "/api/workspaces", "/_next/static/chunk.js", "/icon.svg", "/s/0199f000-0000-4000-8000-000000000000/asset"]) expect(governed(pathname), pathname).toBe(false);
});
