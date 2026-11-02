import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3UnconfiguredOrigin, phase3UserId } from "./fixtures/phase3-identities";
import { createReviewDocument } from "./fixtures/document-review";
import type { APIRequestContext } from "@playwright/test";

/**
 * Named-recipient share spec, "Where a NAMED share is read". The company Gateway sends no identity to
 * `/s/<token>`, so a named share is never drawn there: it answers as a dead link does, and its
 * recipients read it in the Hub through `/s/<token>/open`. The anonymous reader is a request context on
 * phase3UnconfiguredOrigin(), which can build no identity at all.
 */
const ROUND_TRIP = { timeout: 15_000 };

const titleOf = (html: string) => /<title>([^<]*)<\/title>/.exec(html)?.[1];

async function personalWorkspace(request: APIRequestContext, origin: string): Promise<string> {
  // Asking also provisions the persona's Hub user, which naming them requires.
  const response = await request.get(`${origin}/api/workspaces`);
  expect(response.ok()).toBe(true);
  return (await response.json()).items.find((item: { type: string }) => item.type === "PERSONAL").id;
}

async function namedShare(request: APIRequestContext) {
  const recipientOrigin = phase3Origin("nonCreator");
  const recipientWorkspace = await personalWorkspace(request, recipientOrigin);
  const doc = await createReviewDocument(request, "Only the named reader reads this.");
  const created = await request.post(`${phase3Origin("reviewOwner")}/api/documents/${doc.documentId}/share-links`, { data: { label: "named", recipients: [phase3UserId("nonCreator")] } });
  expect(created.ok()).toBe(true);
  const link = (await created.json()).link as { path: string; audience: string };
  expect(link.audience).toBe("NAMED");
  return { doc, path: link.path, token: link.path.slice("/s/".length), recipientOrigin, recipientWorkspace };
}

test.describe("named-recipient share routing", () => {
  test("anonymous /s/<named> answers exactly as an unknown token, with the line into the Hub", async ({ request, playwright, browser }) => {
    const { path, token } = await namedShare(request);
    const anonymous = phase3UnconfiguredOrigin();
    const unknownPath = `/s/${crypto.randomUUID()}`;
    const reader = await playwright.request.newContext({ baseURL: anonymous });
    try {
      const [named, unknown] = [await reader.get(path), await reader.get(unknownPath)];
      expect(named.status()).toBe(404);
      expect(unknown.status()).toBe(404);
      const [namedHtml, unknownHtml] = [await named.text(), await unknown.text()];
      expect(titleOf(namedHtml)).toBeTruthy();
      expect(titleOf(namedHtml)).toBe(titleOf(unknownHtml));
      expect(namedHtml).not.toContain("Only the named reader reads this.");
    } finally {
      await reader.dispose();
    }
    // A 404 is drawn in the browser from the page's payload, so the page itself is read there.
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const titles: string[] = [];
      for (const [visit, opens] of [[path, `/s/${token}/open`], [unknownPath, `${unknownPath}/open`]]) {
        await page.goto(`${anonymous}${visit}`);
        await expect(page.getByRole("heading", { name: "This link is not available" })).toBeVisible(ROUND_TRIP);
        await expect(page.getByRole("link", { name: "如果這是分享給你的，請在 Hub 中開啟", exact: true })).toHaveAttribute("href", opens);
        titles.push(await page.title());
      }
      expect(titles[0]).toBe(titles[1]);
      await page.goto(`${anonymous}${path}?d=0199f300-0000-7000-8000-0000000000aa`);
      await expect(page.getByRole("link", { name: "如果這是分享給你的，請在 Hub 中開啟", exact: true })).toHaveAttribute("href", `/s/${token}/open?d=0199f300-0000-7000-8000-0000000000aa`);
    } finally {
      await context.close();
    }
  });

  test("the recipient opens it through /open and reads it in the Hub", async ({ page, request }) => {
    const { path, token, recipientOrigin, recipientWorkspace } = await namedShare(request);
    await page.goto(`${recipientOrigin}${path}/open`);
    await expect(page).toHaveURL(`${recipientOrigin}/w/${recipientWorkspace}/shares/${token}`, ROUND_TRIP);
    // createReviewDocument titles it `Review <time>`; the not-available title would not match.
    await expect(page).toHaveTitle(/Review \d+/);
    await expect(page.getByText("Only the named reader reads this.", { exact: true })).toBeVisible(ROUND_TRIP);
    await expect(page.getByRole("button", { name: "Save share", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Sign in to comment" })).toHaveCount(0);
  });

  test("a signed-in reader the link does not name gets the dead link's 404 on /open and in the Hub", async ({ request }) => {
    const { path, token } = await namedShare(request);
    const stranger = phase3Origin("viewer");
    const strangerWorkspace = await personalWorkspace(request, stranger);
    const open = await request.get(`${stranger}${path}/open`, { maxRedirects: 0 });
    expect(open.status()).toBe(404);
    const hub = await request.get(`${stranger}/w/${strangerWorkspace}/shares/${token}`, { maxRedirects: 0 });
    expect(hub.status()).toBe(404);
    expect(await hub.text()).not.toContain("Only the named reader reads this.");
  });

  test("a LINK share still opens anonymously on /s/<token>", async ({ request, playwright }) => {
    const doc = await createReviewDocument(request, "Anyone with the link reads this.");
    const reader = await playwright.request.newContext({ baseURL: phase3UnconfiguredOrigin() });
    try {
      const shared = await reader.get(doc.links[0].path);
      expect(shared.status()).toBe(200);
      expect(await shared.text()).toContain("Anyone with the link reads this.");
    } finally {
      await reader.dispose();
    }
  });
});
