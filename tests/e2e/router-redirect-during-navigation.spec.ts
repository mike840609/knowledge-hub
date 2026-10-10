import { expect, test } from "./fixtures/test";
import { stageReadingFolder } from "./fixtures/folder-reading";

// "Browse documents" opens /knowledge/<source>, which redirects on the server to the first document.
// That page sits behind loading.tsx, so the tree commits first and the redirect lands later, thrown
// during render in a Retry lane. If the reader has meanwhile clicked another document whose response
// is still loading, Next 15.5.25's vendored React commits the Router half-rendered during error
// recovery, and its next render throws #310: "Application error" for the whole page
// (patches/next+15.5.25.patch, README "Next.js patch"; tests/unit/vendored-react-ping-fix.test.ts).
//
// The order a slow server or network produces is enforced in the browser, by events rather than
// timers, so a slow runner cannot skip the race:
//   1. the RSC row carrying NEXT_REDIRECT is held until the click on another document has started
//      its navigation and React has rendered it as far as it can: the main thread goes idle once
//      the Router is waiting on that navigation's response. (Released any earlier, React would
//      keep rendering the click's transition and never render the redirect in between.)
//   2. this source's document responses (prefetch and navigation) are held until the redirect has
//      been handed to React and the main thread has gone idle, i.e. React has rendered it while the
//      click's navigation was still loading.
// The bytes are unchanged; React's flight client accepts any chunk boundary. SAFETY_MS only turns a
// hang into a loud failure; it never decides the outcome.
const SAFETY_MS = 10_000;

type RaceState = { redirectSeen: boolean; released: boolean; clickedWhileHeld: boolean; timedOut: string[] };

test("clicking another document while Browse documents is still redirecting keeps the page alive", async ({ page, request }) => {
  const nav = await (await request.get("/api/workspaces")).json();
  const ws = nav.items.find((w: { type: string }) => w.type === "PERSONAL").id as string;
  const snapshot = await stageReadingFolder(request, { workspaceId: ws, sourceName: `Redirect race ${Date.now()}`, fixture: "reading-flow-v1" });
  const applied = await request.post(`/api/source-imports/${snapshot}/apply`, { data: {} });
  expect(applied.ok()).toBe(true);
  const sourceId = (await applied.json()).sourceId as string;

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(({ sourcePath, safetyMs }) => {
    const state: RaceState = { redirectSeen: false, released: false, clickedWhileHeld: false, timedOut: [] };
    (window as unknown as { __race: RaceState }).__race = state;
    // The safety timer starts when something first waits on the gate, not at page load.
    const gate = (name: string) => {
      let open!: () => void, isOpen = false, timer: ReturnType<typeof setTimeout> | undefined;
      const opened = new Promise<void>((resolve) => { open = () => { isOpen = true; clearTimeout(timer); resolve(); }; });
      return {
        open: () => open(),
        get opened() {
          if (!isOpen && timer === undefined) timer = setTimeout(() => { state.timedOut.push(name); open(); }, safetyMs);
          return opened;
        },
      };
    };
    const clicked = gate("click on another document");
    const documents = gate("redirect handed to React");

    document.addEventListener("click", (event) => {
      const link = (event.target as Element | null)?.closest?.("a");
      if (!link?.getAttribute("href")?.startsWith(`${sourcePath}/`)) return;
      state.clickedWhileHeld = !state.released;
      // Idle comes after Link has dispatched the navigation and React has rendered up to the
      // Router's wait for its response.
      requestIdleCallback(() => clicked.open());
    }, true);

    const marker = new TextEncoder().encode("NEXT_REDIRECT");
    const find = (bytes: Uint8Array) => {
      outer: for (let i = 0; i <= bytes.length - marker.length; i++) {
        for (let j = 0; j < marker.length; j++) if (bytes[i + j] !== marker[j]) continue outer;
        return i;
      }
      return -1;
    };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      const rsc = url.searchParams.has("_rsc");
      if (rsc && url.pathname.startsWith(`${sourcePath}/`)) await documents.opened;
      const response = await original(input, init);
      // Only the navigation's response carries the redirect; the link's prefetch stops at loading.tsx.
      const prefetch = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).has("next-router-prefetch");
      if (!rsc || prefetch || url.pathname !== sourcePath || !response.body) return response;
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const at = state.redirectSeen ? -1 : find(value);
            if (at < 0) { controller.enqueue(value); continue; }
            state.redirectSeen = true;
            const cut = value.lastIndexOf(10, at) + 1;
            controller.enqueue(value.slice(0, cut));
            await clicked.opened;
            state.released = true;
            controller.enqueue(value.slice(cut));
          }
          controller.close();
          // Idle comes after the tasks React scheduled to render the redirect this stream delivered.
          if (state.redirectSeen) requestIdleCallback(() => documents.open());
        },
      });
      const held = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(held, "url", { value: response.url });
      Object.defineProperty(held, "redirected", { value: response.redirected });
      return held;
    };
  }, { sourcePath: `/w/${ws}/knowledge/${sourceId}`, safetyMs: SAFETY_MS });

  await page.goto(`/w/${ws}/sources/${sourceId}`);
  await page.getByRole("link", { name: "Browse documents" }).click();
  const links = page.getByRole("tree", { name: "Knowledge tree" }).locator(`a[href*="/knowledge/${sourceId}/"]`);
  await expect(links).toHaveCount(2);
  // The redirect is held until the click below, so the URL cannot have moved on yet.
  await expect(page).toHaveURL(new RegExp(`/knowledge/${sourceId}$`));
  const target = links.last();
  const href = (await target.getAttribute("href"))!;
  await target.click();

  await expect(page).toHaveURL(new RegExp(`${href.split("?")[0]}$`), { timeout: SAFETY_MS });
  await expect(page.locator("article").first()).toBeVisible();
  const race = await page.evaluate(() => (window as unknown as { __race: RaceState }).__race);
  expect(race.timedOut, "a gate opened on its safety timeout, so the race was not exercised").toEqual([]);
  expect(race.redirectSeen, "the source page's RSC stream carried no NEXT_REDIRECT row").toBe(true);
  expect(race.clickedWhileHeld, "the click landed after the redirect had been released").toBe(true);
  await expect(page.getByText("Application error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
