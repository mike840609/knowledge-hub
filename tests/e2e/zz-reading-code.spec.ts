import { expect, test, type Page } from "@playwright/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Fenced code where it is read: coloured, and copyable, on a document page and on a shared page
 * (daily-driver spec §5). And where it is written: the composer's code stays as it was.
 *
 * The unit tests read the stylesheet and render the components; what only a browser can say is
 * whether the colour reaches the page (the first version of these rules were compiled away by
 * Tailwind, every unit test green), whether the copy button copies what is written, and whether
 * a shared page — no app shell, no toast, no sign-in — carries it without an error.
 *
 * It creates documents in the E2E user's own My Space, and the specs share one database and run in
 * file-name order, so it sorts last for the reason zz-wikilinks-composer.spec.ts gives: more
 * documents there move the nodes workspace-graph.spec.ts hovers, which sorts before this and
 * must not see them.
 */

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Code with what a copy is most likely to lose: indentation, a blank line, `<`, `&`, quotes and a tab. */
const SQL = "select a, b\n  from t\n where n < 3 and s = 'x & y'\n\n-- a blank line above, and a tab:\t|";
/** Ends in a newline of its own, which is the author's and must survive: only the one Markdown adds is dropped. */
const ENDS_IN_NEWLINE = "line one\nline two\n";

const MARKDOWN = ["Before.", "", "```sql", SQL, "```", "", "```", ENDS_IN_NEWLINE, "```", "", "```python", "def f():", "    return 1", "```", "", "After."].join("\n");


/** Creates a note through the API, so its Markdown is exactly what is written here, and returns where it is. */
async function createNote(page: Page, title: string, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title, markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return { url: `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`, documentId: created.documentId };
}

const blocks = (page: Page) => page.locator("article [data-code-block]");

/** Whatever colour a custom property resolves to in the page, read the way the browser reads it. */
async function resolved(page: Page, property: string) {
  return page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const colour = getComputedStyle(probe).color;
    probe.remove();
    return colour;
  }, property);
}

/** The colour the first token of a class is drawn in, and the colour of the block's own text. */
async function drawn(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const token = document.querySelector(`article pre ${selector}`)!;
    return { token: getComputedStyle(token).color, text: getComputedStyle(token.closest("pre")!).color };
  }, scope);
}

async function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe("code in the reader", () => {
  test("is coloured from the tokens in both themes, and code with no language is left plain", async ({ page }) => {
    const note = await createNote(page, unique("Reading code"), MARKDOWN);
    await page.goto(note.url);
    await expect(blocks(page)).toHaveCount(3, ROUND_TRIP);

    // Coloured: the first block's keyword is `select`, drawn in the keyword token and not in the block's text colour.
    const keyword = blocks(page).nth(0).locator(".hljs-keyword").first();
    await expect(keyword).toHaveText("select");
    const light = await drawn(page, ".hljs-keyword");
    expect(light.token).toBe(await resolved(page, "--kh-syntax-keyword"));
    expect(light.token).not.toBe(light.text);
    // Different kinds are different colours: a keyword, a number, and a comment.
    const number = await page.evaluate(() => getComputedStyle(document.querySelector("article pre .hljs-number")!).color);
    const comment = await page.evaluate(() => getComputedStyle(document.querySelector("article pre .hljs-comment")!).color);
    expect(new Set([light.token, number, comment]).size).toBe(3);

    // The second language is coloured by its own grammar.
    await expect(blocks(page).nth(2).locator(".hljs-keyword").first()).toHaveText("def");

    // No language, no colour, and nothing guessed at — but the block is still one you can copy.
    await expect(blocks(page).nth(1).locator("[class*=hljs-]")).toHaveCount(0);
    await expect(blocks(page).nth(1).getByRole("button", { name: "Copy code" })).toBeVisible();

    // The dark theme is the same rule with another token: the colour changes, and is still the token's.
    await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
    const dark = await drawn(page, ".hljs-keyword");
    expect(dark.token).toBe(await resolved(page, "--kh-syntax-keyword"));
    expect(dark.token).not.toBe(light.token);
    expect(dark.token).not.toBe(dark.text);
  });

  test("copies exactly what is written, and says so", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const note = await createNote(page, unique("Copy code"), MARKDOWN);
    await page.goto(note.url);
    await expect(blocks(page)).toHaveCount(3, ROUND_TRIP);

    // Not the colour spans, not the button, not the newline Markdown adds — the code, character for character.
    const first = blocks(page).nth(0);
    const status = first.locator("[aria-live=polite]");
    await expect(status).toHaveText("");
    await first.getByRole("button", { name: "Copy code" }).click();
    await expect(status).toHaveText("Copied", ROUND_TRIP);
    expect(await readClipboard(page)).toBe(SQL);
    // It goes away by itself.
    await expect(status).toHaveText("", { timeout: 5_000 });

    // The newline that is the author's own is kept; only the one Markdown puts after the block is dropped.
    await blocks(page).nth(1).getByRole("button", { name: "Copy code" }).click();
    await expect(blocks(page).nth(1).locator("[aria-live=polite]")).toHaveText("Copied", ROUND_TRIP);
    expect(await readClipboard(page)).toBe(ENDS_IN_NEWLINE);

    await blocks(page).nth(2).getByRole("button", { name: "Copy code" }).click();
    await expect(blocks(page).nth(2).locator("[aria-live=polite]")).toHaveText("Copied", ROUND_TRIP);
    expect(await readClipboard(page)).toBe("def f():\n    return 1");
  });

  test("says so when the browser refuses, and does not throw", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const note = await createNote(page, unique("Copy refused"), MARKDOWN);
    await page.goto(note.url);
    await expect(blocks(page)).toHaveCount(3, ROUND_TRIP);

    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
    });
    await blocks(page).nth(0).getByRole("button", { name: "Copy code" }).click();
    await expect(blocks(page).nth(0).locator("[aria-live=polite]")).toHaveText("Could not copy", ROUND_TRIP);

    // A page with no clipboard at all — not a secure context — is the same answer.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    });
    await blocks(page).nth(2).getByRole("button", { name: "Copy code" }).click();
    await expect(blocks(page).nth(2).locator("[aria-live=polite]")).toHaveText("Could not copy", ROUND_TRIP);
    expect(errors).toEqual([]);
  });
});

test.describe("code on a shared page", () => {
  test("is coloured and copyable for someone who is not signed in, with no error on the page", async ({ page, browser, baseURL }) => {
    const note = await createNote(page, unique("Shared code"), MARKDOWN);
    const shared = await page.request.post(`/api/documents/${note.documentId}/share-links`, { data: { label: "code", expiresInDays: 1 } });
    expect(shared.status()).toBe(201);
    const { link } = (await shared.json()) as { link: { path: string } };
    expect(link.path).toMatch(/^\/s\/[0-9a-f-]{36}$/);

    // A context of its own: no cookie, no session — the reader the link is for.
    const reader = await browser.newContext({ baseURL: baseURL!, permissions: ["clipboard-read", "clipboard-write"] });
    try {
      const page2 = await reader.newPage();
      const problems: string[] = [];
      page2.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
      page2.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`console ${message.type()}: ${message.text()}`);
      });

      // Coloured in the HTML itself, before any script runs.
      const html = await (await reader.request.get(link.path)).text();
      expect(html).toContain('<span class="hljs-keyword">select</span>');

      await page2.goto(link.path);
      const shown = page2.locator("article [data-code-block]");
      await expect(shown).toHaveCount(3, ROUND_TRIP);
      await expect(shown.nth(0).locator(".hljs-keyword").first()).toHaveText("select");
      const colours = await page2.evaluate(() => {
        const token = document.querySelector("article pre .hljs-keyword")!;
        return { token: getComputedStyle(token).color, text: getComputedStyle(token.closest("pre")!).color };
      });
      expect(colours.token).not.toBe(colours.text);
      expect(colours.token).toBe(await resolved(page2, "--kh-syntax-keyword"));

      // Its button works with nothing around it: no toast, no shell.
      const status = shown.nth(0).locator("[aria-live=polite]");
      await shown.nth(0).getByRole("button", { name: "Copy code" }).click();
      await expect(status).toHaveText("Copied", ROUND_TRIP);
      expect(await page2.evaluate(() => navigator.clipboard.readText())).toBe(SQL);
      await expect(status).toHaveText("", { timeout: 5_000 });

      expect(problems).toEqual([]);
    } finally {
      await reader.close();
    }
  });
});

test.describe("code in the composer", () => {
  test("stays as it was: not coloured, and no copy button", async ({ page }) => {
    const note = await createNote(page, unique("Composer code"), MARKDOWN);
    await page.goto(`${note.url}/edit`);
    const surface = page.locator("main form").first().getByRole("textbox", { name: "Content" });
    await expect(surface).toBeEditable(ROUND_TRIP);
    await expect(surface.locator("pre")).toHaveCount(3);
    await expect(page.locator("main form .hljs-keyword")).toHaveCount(0);
    await expect(page.locator("main form").getByRole("button", { name: "Copy code" })).toHaveCount(0);
  });
});
