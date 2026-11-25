import { expect, test, type Page } from "./fixtures/test";
import { personalWorkspaceId as mySpace } from "./fixtures/my-space";

// Server-bound assertions only; see the note in phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * The read-only stand-in the page shows while the editor loads, and the editor that replaces it, lay a note
 * out alike (docs/superpowers/specs/2026-11-25-editor-page-polish-design.md, decision 1). It writes a note into
 * the E2E user's My Space, so it sorts last like zz-table-controls.spec.ts.
 */

const NOTE = [
  "Intro line with a [[Nowhere in particular]] link and some more words after it.",
  "",
  "## Plan",
  "",
  "- first bullet",
  "- second bullet",
  "- [ ] open task",
  "- [x] done task",
  "- last bullet",
  "",
  "> A quoted sentence that carries a second thought.",
  "",
  "### Details",
  "",
  "| A | B |",
  "| - | - |",
  "| one | two |",
  "",
  "Closing paragraph.",
  "",
].join("\n");

function unique(label: string) {
  return `${label} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function createNote(page: Page, markdown: string) {
  const workspaceId = await mySpace(page);
  const response = await page.request.post(`/api/workspaces/${workspaceId}/documents`, { data: { title: unique("Handoff"), markdown } });
  expect(response.ok()).toBe(true);
  const created = (await response.json()) as { sourceId: string; documentId: string };
  return `/w/${workspaceId}/knowledge/${created.sourceId}/${created.documentId}`;
}

/** Runs before the page's own scripts: samples the article's blocks every frame and every layout shift. */
function recorder() {
  const frames: { editable: boolean; blocks: { tag: string; top: number; height: number; left: number }[]; meta: number }[] = [];
  let shift = 0;
  new PerformanceObserver(list => { for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!entry.hadRecentInput) shift += entry.value; }).observe({ type: "layout-shift", buffered: true });
  const win = window as unknown as { __frames: typeof frames; __shift: () => number };
  win.__frames = frames;
  win.__shift = () => shift;
  const sample = () => {
    const surface = document.querySelector<HTMLElement>('main [contenteditable="true"]');
    const root = surface ?? document.querySelector<HTMLElement>("main article");
    if (root) {
      const parent = surface ? root : (root.firstElementChild as HTMLElement | null);
      const blocks = Array.from(parent?.children ?? []).map(child => {
        const box = child.getBoundingClientRect();
        return { tag: child.tagName, top: box.top + window.scrollY, height: box.height, left: box.left };
      });
      const time = document.querySelector("main header time");
      frames.push({ editable: !!surface, blocks, meta: time?.parentElement?.getBoundingClientRect().height ?? 0 });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
}

test("the editor takes over without moving the article's blocks", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const url = await createNote(page, NOTE);
  await page.addInitScript(recorder);
  // Hold the lazily loaded chunks back, so the stand-in is on screen long enough to be sampled.
  await page.route("**/_next/static/chunks/**", async route => { await new Promise(resolve => setTimeout(resolve, 600)); await route.continue(); });
  await page.goto(url);
  await expect(page.locator('main [contenteditable="true"]')).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const win = window as unknown as { __frames: { editable: boolean; blocks: { tag: string; top: number; height: number; left: number }[]; meta: number }[]; __shift: () => number };
    const frames = win.__frames;
    const firstEditable = frames.findIndex(frame => frame.editable);
    return { before: frames[firstEditable - 1] ?? null, after: frames[firstEditable + 2] ?? null, shift: win.__shift(), count: frames.length };
  });
  expect(result.before, "the stand-in was sampled before the editor").not.toBeNull();
  expect(result.after).not.toBeNull();
  const before = result.before!;
  const after = result.after!;
  expect(after.blocks.map(block => block.tag)).toEqual(before.blocks.map(block => block.tag));
  after.blocks.forEach((block, index) => {
    const was = before.blocks[index]!;
    expect(Math.abs(block.top - was.top), `block ${index} <${block.tag}> top`).toBeLessThanOrEqual(1);
    expect(Math.abs(block.height - was.height), `block ${index} <${block.tag}> height`).toBeLessThanOrEqual(1);
    expect(Math.abs(block.left - was.left), `block ${index} <${block.tag}> left`).toBeLessThanOrEqual(1);
  });
  expect(Math.abs(after.meta - before.meta), "the meta line keeps its height").toBeLessThanOrEqual(1);
});

test("a to-do, a quote and a link read alike before and after the editor", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const url = await createNote(page, NOTE);
  await page.route("**/_next/static/chunks/**", async route => { await new Promise(resolve => setTimeout(resolve, 600)); await route.continue(); });
  await page.goto(url, { waitUntil: "commit" });
  const article = page.locator("main article").first();
  await expect(article.locator("li").first()).toBeVisible({ timeout: 20_000 });
  const read = () => page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('main [contenteditable="true"]') ?? document.querySelector<HTMLElement>("main article");
    const items = Array.from(root!.querySelectorAll("li")).map(li => {
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      let text = walker.nextNode();
      while (text && !text.textContent?.trim()) text = walker.nextNode();
      range.selectNodeContents(text!);
      const box = range.getBoundingClientRect();
      return { text: li.textContent?.trim(), left: Math.round(box.left), top: Math.round(box.top), list: getComputedStyle(li).listStyleType, kind: li.querySelector("input") ? "input" : li.getAttribute("data-item-type") ?? "plain" };
    });
    const link = root!.querySelector("[data-unresolved-link]");
    const quote = root!.querySelector("blockquote");
    const look = (element: Element | null) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return [style.color, style.fontWeight, style.textDecorationLine, style.borderBottomStyle, style.borderLeftWidth].join(" ");
    };
    return { items, link: look(link), quote: look(quote) };
  });
  const standIn = await read();
  expect(standIn.link, "the stand-in drew the unresolved link").not.toBeNull();
  await expect(page.locator('main [contenteditable="true"] [data-unresolved-link]')).toBeVisible({ timeout: 20_000 });
  const editor = await read();
  expect(editor.items.map(item => item.left)).toEqual(standIn.items.map(item => item.left));
  expect(editor.items.map(item => item.top)).toEqual(standIn.items.map(item => item.top));
  // A to-do is a box with no bullet, before and after.
  expect(standIn.items.map(item => item.list)).toEqual(editor.items.map(item => item.list));
  expect(editor.items.filter(item => item.kind !== "plain").map(item => item.list)).toEqual(["none", "none"]);
  expect(editor.link).toBe(standIn.link);
  expect(editor.quote).toBe(standIn.quote);
});

async function outlineOf(page: Page, url: string) {
  await page.goto(url);
  const rail = page.locator('aside[aria-label="On this page"]:visible').first();
  await expect(rail).toBeVisible(ROUND_TRIP);
  return rail.locator("li a").allTextContents();
}

test("the outline lists the same headings on the editor page and the read-only page", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  for (const markdown of ["# Opening title\n\nIntro.\n\n## Alpha\n\nText.\n\n## Beta\n\nText.\n", "Intro.\n\n## Alpha\n\nText.\n\n### Beta\n\nText.\n"]) {
    const url = await createNote(page, markdown);
    const editing = await outlineOf(page, url);
    const reading = await outlineOf(page, `${url}?revision=1`);
    console.log(JSON.stringify({ markdown: markdown.slice(0, 20), editing, reading }));
    expect(editing).toEqual(reading);
  }
});
