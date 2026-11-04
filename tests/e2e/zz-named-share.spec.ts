import { expect, test } from "./fixtures/test";
import { phase3Origin, phase3UnconfiguredOrigin, phase3UserId } from "./fixtures/phase3-identities";
import { createReviewDocument, openReviewDiscussions } from "./fixtures/document-review";
import type { APIRequestContext, Locator, Page } from "@playwright/test";

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

const A = "nonCreator", B = "viewer";
const PASSAGE = { schemaVersion: 1, blockPath: [0], blockKind: "paragraph", startUtf16: 2, endUtf16: 9, exact: "😀 bold", prefix: "A ", suffix: " passage to review." };

async function apiDocument(request: APIRequestContext, owner: string, workspaceId: string, title: string, markdown: string, parentId: string | null = null) {
  const response = await request.post(`${owner}/api/workspaces/${workspaceId}/documents`, { data: { title, markdown, parentId } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { documentId: string; sourceId: string };
}

/** Pick a person in a recipient combobox by typing their employee ID, which finds exactly one. */
async function pickRecipient(scope: Locator, empId: string, name: string) {
  const field = scope.getByRole("combobox", { name: "People who can open it" });
  await field.fill(empId);
  await scope.getByRole("option", { name: new RegExp(empId) }).click();
  await expect(scope.getByRole("list", { name: "Selected people" }).getByText(name, { exact: true })).toBeVisible();
}

async function chooseSpecificPeople(page: Page) {
  await page.locator("main").getByRole("button", { name: "Share link…" }).click();
  const dialog = page.getByRole("dialog", { name: "Share link" });
  await dialog.locator("label", { hasText: "Specific people" }).click();
  await expect(dialog.getByRole("radio", { name: /Specific people/ })).toBeChecked();
  return dialog;
}

test.describe("named-recipient share, end to end", () => {
  test("the owner names two people; one reads and comments, mentions reach only the other, and removal ends it", async ({ page, request }) => {
    test.setTimeout(90_000);
    const owner = phase3Origin("reviewOwner"), reader = phase3Origin(A);
    const readerWorkspace = await personalWorkspace(request, reader);
    const mentionedWorkspace = await personalWorkspace(request, phase3Origin(B)); // also provisions B, who must exist to be named
    const ownerWorkspace = await personalWorkspace(request, owner);
    const title = `Named flow ${Date.now()}`;
    const doc = await apiDocument(request, owner, ownerWorkspace, title, "A 😀 **bold** passage to review.");

    // The owner creates it through the dialog.
    await page.goto(`${owner}/w/${ownerWorkspace}/knowledge/${doc.sourceId}/${doc.documentId}`);
    const dialog = await chooseSpecificPeople(page);
    // The suggestions float over the form, so the Create button stays put; and they open whichever way
    // keeps every row inside the dialog, which would otherwise clip them.
    // Measured once the links below have loaded, since the centred dialog moves while they do.
    await expect(dialog.getByText("No active links.")).toBeVisible(ROUND_TRIP);
    const create = dialog.getByRole("button", { name: "Create link" });
    const before = (await create.boundingBox())!;
    await dialog.getByRole("combobox", { name: "People who can open it" }).fill("Phase3");
    const suggestions = dialog.getByRole("listbox", { name: "People matching your search" });
    await expect(suggestions.getByRole("option").first()).toBeVisible();
    const after = (await create.boundingBox())!;
    const list = (await suggestions.boundingBox())!;
    expect(after.y).toBeCloseTo(before.y, 0);
    const box = (await dialog.boundingBox())!;
    expect(list.y).toBeGreaterThanOrEqual(box.y);
    expect(list.y + list.height).toBeLessThanOrEqual(box.y + box.height);
    await dialog.getByRole("combobox", { name: "People who can open it" }).fill("");
    await pickRecipient(dialog, "P3-102", "Phase3 nonCreator");
    await pickRecipient(dialog, "P3-105", "Phase3 viewer");
    await dialog.getByLabel(/Label/).fill("named flow");
    await dialog.getByRole("button", { name: "Create link" }).click();
    const item = dialog.locator("[data-share-link]").first();
    await expect(item).toContainText("2 people", ROUND_TRIP);
    const token = (await item.getAttribute("data-share-link"))!.slice("/s/".length);
    expect(token).toMatch(/^[0-9a-f-]{36}$/);
    await expect(item.getByRole("textbox", { name: "Link for named flow" })).toHaveValue(`${owner}/s/${token}/open`);

    // A's Inbox says so, and the entry opens the share in the Hub.
    await page.goto(`${reader}/w/${readerWorkspace}/inbox`);
    const line = page.getByText("Phase3 reviewOwner shared this with you", { exact: true });
    await expect(line).toBeVisible(ROUND_TRIP);
    const hubUrl = `${reader}/w/${readerWorkspace}/shares/${token}`;
    await page.goto(`${reader}/s/${token}/open`);
    await expect(page).toHaveURL(hubUrl, ROUND_TRIP);
    await expect(page.getByText("passage to review.")).toBeVisible(ROUND_TRIP);

    // A comments; the mention list offers B only (not A, not the owner, not anyone else in the directory).
    const query = await (await request.post(`${reader}/api/share-review/threads/query`, { headers: { Origin: reader }, data: { token } })).json();
    const created = await request.post(`${reader}/api/share-review/threads`, { headers: { Origin: reader }, data: { token, expectedRevisionId: query.revisionId, anchor: PASSAGE, body: "Reader remark @Phase3 viewer", idempotencyKey: crypto.randomUUID(), mentions: [phase3UserId(B)] } });
    expect(created.status()).toBe(201);
    const threadId = ((await created.json()) as { id: string }).id;
    const offered = await (await request.get(`${reader}/api/review-mentions/candidates?token=${token}&query=Phase3`)).json();
    expect(offered.candidates.map((person: { id: string }) => person.id)).toEqual([phase3UserId(B)]);
    const everyone = await (await request.get(`${reader}/api/review-mentions/candidates?token=${token}&query=P3-`)).json();
    expect(everyone.candidates.map((person: { id: string }) => person.id)).toEqual([phase3UserId(B)]);

    // B's Inbox mention opens the Hub reader at the discussion, never the anonymous /s/ page (a dead link for a NAMED share).
    const mentioned = phase3Origin(B);
    const atDiscussion = `/w/${mentionedWorkspace}/shares/${token}?thread=${threadId}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${mentioned}/w/${mentionedWorkspace}/inbox`);
    const mention = page.getByRole("list", { name: "Inbox discussions" }).locator(`a[href="${atDiscussion}"]`);
    await expect(mention).toContainText("Mentioned you", ROUND_TRIP);
    await mention.click();
    await page.getByRole("region", { name: "Selected discussion" }).getByRole("link", { name: "Open document" }).click();
    await expect(page).toHaveURL(`${mentioned}${atDiscussion}`, ROUND_TRIP);
    const card = page.locator(`[data-review-thread="${threadId}"]`);
    await expect(card).toHaveAttribute("data-active", "", ROUND_TRIP);
    await expect(card.getByText("Reader remark @Phase3 viewer", { exact: true })).toBeVisible();

    // The owner comes back to the dialog and removes A.
    await page.goto(`${owner}/w/${ownerWorkspace}/knowledge/${doc.sourceId}/${doc.documentId}`);
    await page.locator("main").getByRole("button", { name: "Share link…" }).click();
    const manage = page.getByRole("dialog", { name: "Share link" }).locator(`[data-share-link="/s/${token}"]`);
    await manage.getByRole("button", { name: "Manage people" }).click();
    await manage.getByRole("button", { name: "Remove Phase3 nonCreator from this link" }).click();
    await expect(manage).toContainText("1 person", ROUND_TRIP);
    await expect(manage.getByRole("list", { name: "People who can open this link" }).getByText(/Phase3 nonCreator/)).toHaveCount(0);

    // A's reload is the dead link's 404, the Inbox entry is gone, and the owner still reads A's comment.
    const gone = await request.get(hubUrl, { maxRedirects: 0 });
    expect(gone.status()).toBe(404);
    await page.goto(`${reader}/w/${readerWorkspace}/inbox`);
    await expect(page.getByRole("heading", { name: "Inbox", level: 1 })).toBeVisible(ROUND_TRIP);
    await expect(page.getByText("shared this with you")).toHaveCount(0);
    await page.goto(`${owner}/w/${ownerWorkspace}/knowledge/${doc.sourceId}/${doc.documentId}`);
    await openReviewDiscussions(page);
    await expect(page.getByRole("region", { name: "Discussion thread" }).filter({ hasText: "Reader remark @Phase3 viewer" })).toBeVisible(ROUND_TRIP);
  });

  test("a named share on a folder is read in the Hub and its links stay under /w/<ws>/shares/<token>", async ({ page, request }) => {
    const owner = phase3Origin("reviewOwner"), reader = phase3Origin(A);
    const readerWorkspace = await personalWorkspace(request, reader);
    const ownerWorkspace = await personalWorkspace(request, owner);
    const stamp = Date.now();
    const names = { folder: `Named F ${stamp}`, intro: `Named Intro ${stamp}`, deep: `Named Deep ${stamp}` };
    const folder = await request.post(`${owner}/api/workspaces/${ownerWorkspace}/folders`, { data: { name: names.folder, parentId: null } });
    expect(folder.status()).toBe(201);
    const folderId = ((await folder.json()) as { treeNodeId: string }).treeNodeId;
    const deep = await apiDocument(request, owner, ownerWorkspace, names.deep, "Deep body.", folderId);
    const intro = await apiDocument(request, owner, ownerWorkspace, names.intro, `Intro body with [[${names.deep}]] inside.`, folderId);
    const created = await request.post(`${owner}/api/tree-nodes/${folderId}/share-links`, { data: { recipients: [phase3UserId(A)] } });
    expect(created.status()).toBe(201);
    const link = (await created.json()).link as { path: string; audience: string };
    expect(link.audience).toBe("NAMED");
    const token = link.path.slice("/s/".length);
    const base = `/w/${readerWorkspace}/shares/${token}`;

    await page.goto(`${reader}${link.path}/open?d=${intro.documentId}`);
    await expect(page).toHaveURL(`${reader}${base}?d=${intro.documentId}`, ROUND_TRIP);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(names.intro, ROUND_TRIP);
    const inFolder = page.locator("article").first().getByRole("link", { name: names.deep, exact: true });
    await expect(inFolder).toHaveAttribute("href", `${base}?d=${deep.documentId}`);
    await inFolder.click();
    await expect(page).toHaveURL(`${reader}${base}?d=${deep.documentId}`, ROUND_TRIP);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(names.deep);
    expect(new URL(page.url()).pathname.startsWith("/s/")).toBe(false);
  });

  test("Escape in the recipient list closes the list, not the dialog", async ({ page, request }) => {
    const owner = phase3Origin("reviewOwner");
    const ownerWorkspace = await personalWorkspace(request, owner);
    await personalWorkspace(request, phase3Origin(A));
    const doc = await apiDocument(request, owner, ownerWorkspace, `Escape ${Date.now()}`, "Body.");
    await page.goto(`${owner}/w/${ownerWorkspace}/knowledge/${doc.sourceId}/${doc.documentId}`);
    const dialog = await chooseSpecificPeople(page);
    await dialog.getByRole("combobox", { name: "People who can open it" }).fill("P3-102");
    const list = dialog.getByRole("listbox", { name: "People matching your search" });
    await expect(list).toBeVisible(ROUND_TRIP);
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(dialog).toBeVisible();
  });
});

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
        await expect(page.getByRole("link", { name: "If this was shared with you, open it in the Hub", exact: true })).toHaveAttribute("href", opens);
        titles.push(await page.title());
      }
      expect(titles[0]).toBe(titles[1]);
      await page.goto(`${anonymous}${path}?d=0199f300-0000-7000-8000-0000000000aa`);
      await expect(page.getByRole("link", { name: "If this was shared with you, open it in the Hub", exact: true })).toHaveAttribute("href", `/s/${token}/open?d=0199f300-0000-7000-8000-0000000000aa`);
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

  test("a Hub reader URL on another person's Workspace sends the reader to their own, keeping its query", async ({ page, request }) => {
    const { doc, token, recipientOrigin, recipientWorkspace } = await namedShare(request);
    const ownerWorkspace = await personalWorkspace(request, phase3Origin("reviewOwner"));
    const thread = crypto.randomUUID();
    const query = `?d=${doc.documentId}&thread=${thread}`;
    const copied = await request.get(`${recipientOrigin}/w/${ownerWorkspace}/shares/${token}${query}`, { maxRedirects: 0 });
    expect(copied.status()).toBe(307);
    expect(copied.headers().location).toBe(`/w/${recipientWorkspace}/shares/${token}${query}`);
    await page.goto(`${recipientOrigin}/w/${ownerWorkspace}/shares/${token}`);
    await expect(page).toHaveURL(`${recipientOrigin}/w/${recipientWorkspace}/shares/${token}`, ROUND_TRIP);
    await expect(page.getByText("Only the named reader reads this.", { exact: true })).toBeVisible(ROUND_TRIP);

    // The redirect judges nothing: a stranger lands on the page's 404, and other foreign paths stay 404.
    const stranger = phase3Origin("viewer");
    const strangerWorkspace = await personalWorkspace(request, stranger);
    const sent = await request.get(`${stranger}/w/${ownerWorkspace}/shares/${token}`, { maxRedirects: 0 });
    expect(sent.headers().location).toBe(`/w/${strangerWorkspace}/shares/${token}`);
    expect((await request.get(`${stranger}/w/${ownerWorkspace}/shares/${token}`)).status()).toBe(404);
    for (const foreign of [`/w/${ownerWorkspace}/inbox`, `/w/${ownerWorkspace}/shares/not-a-token`, `/w/${ownerWorkspace}/shares/${token}/x`]) {
      expect((await request.get(`${recipientOrigin}${foreign}`, { maxRedirects: 0 })).status(), foreign).toBe(404);
    }
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
