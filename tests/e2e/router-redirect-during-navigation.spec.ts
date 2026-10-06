import { expect, test } from "@playwright/test";
import { stageReadingFolder } from "./fixtures/folder-reading";

// "Browse documents" opens /knowledge/<source>, which redirects on the server to the first document.
// That page sits behind loading.tsx, so the tree commits first and the redirect lands later, thrown
// during render in a Retry lane. If the reader has meanwhile clicked another document whose response
// is still loading, Next 15.5.25's vendored React commits the Router half-rendered during error
// recovery, and its next render throws #310: "Application error" for the whole page
// (patches/next+15.5.25.patch, README "Next.js patch"; tests/unit/vendored-react-ping-fix.test.ts).
//
// The timing a slow server or network produces is made deterministic in the browser: the redirect's
// row of the RSC stream is held back for REDIRECT_HOLD_MS, and this source's document responses for
// DOCUMENT_HOLD_MS. The bytes are unchanged; React's flight client accepts any chunk boundary.
const REDIRECT_HOLD_MS = 600;
const DOCUMENT_HOLD_MS = 1_500;

test("clicking another document while Browse documents is still redirecting keeps the page alive", async ({ page, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id as string;
  const snapshot = await stageReadingFolder(request, { workspaceId: ws, sourceName: `Redirect race ${Date.now()}`, fixture: "reading-flow-v1" });
  const applied = await request.post(`/api/source-imports/${snapshot}/apply`, { data: {} });
  expect(applied.ok()).toBe(true);
  const sourceId = (await applied.json()).sourceId as string;

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ sourcePath, redirectHold, documentHold }) => {
    const original = window.fetch.bind(window);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const marker = new TextEncoder().encode("NEXT_REDIRECT");
    const find = (bytes: Uint8Array) => {
      outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
        for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker[j]) continue outer;
        return i;
      }
      return -1;
    };
    const w = window as unknown as { __redirectHeld?: boolean };
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const rsc = url.searchParams.has("_rsc");
      if (rsc && url.pathname.startsWith(`${sourcePath}/`)) await sleep(documentHold);
      const response = await original(input, init);
      if (!rsc || url.pathname !== sourcePath || !response.body) return response;
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const at = w.__redirectHeld ? -1 : find(value);
            if (at < 0) { controller.enqueue(value); continue; }
            w.__redirectHeld = true;
            const cut = value.lastIndexOf(10, at) + 1;
            controller.enqueue(value.slice(0, cut));
            await sleep(redirectHold);
            controller.enqueue(value.slice(cut));
          }
          controller.close();
        },
      });
      const held = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(held, "url", { value: response.url });
      Object.defineProperty(held, "redirected", { value: response.redirected });
      return held;
    };
  }, { sourcePath: `/w/${ws}/knowledge/${sourceId}`, redirectHold: REDIRECT_HOLD_MS, documentHold: DOCUMENT_HOLD_MS });

  await page.goto(`/w/${ws}/sources/${sourceId}`);
  await page.getByRole("link", { name: "Browse documents" }).click();
  const links = page.getByRole("tree", { name: "Knowledge tree" }).locator(`a[href*="/knowledge/${sourceId}/"]`);
  await expect(links).toHaveCount(2);
  // Still on the source URL: the redirect has not landed yet, so this click races it.
  await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}$`));
  const target = links.last();
  const href = (await target.getAttribute("href"))!;
  await target.click();

  await expect(page).toHaveURL(new RegExp(`${href.split("?")[0]}$`), { timeout: 10_000 });
  await expect(page.locator("article").first()).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __redirectHeld?: boolean }).__redirectHeld)).toBe(true);
  await expect(page.getByText("Application error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
