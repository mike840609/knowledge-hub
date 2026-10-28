import { expect, test, type Page } from "./fixtures/test";
import { showMarkdown } from "./composer-helpers";
import { phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";
import { chooseOption } from "./fixtures/select-menu";

// Server round trips (create, save, revoke) get the same budget as phase5-authoring.spec.ts.
const ROUND_TRIP = { timeout: 15_000 };

/**
 * Share-link spec §13, end to end. The owner works on the local server as the
 * E2E user in their own My Space. The reader is a request context on
 * phase3UnconfiguredOrigin(): a Company-SSO build with no session reader, so
 * every signed-in path there fails — which is what proves /s/:token needs no
 * sign-in and builds no identity provider (spec §6.1). Both servers share one
 * database.
 */
test.describe("document share link", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT && process.env.KM_E2E_UNCONFIGURED_SERVER !== "true", "Run npm run test:e2e to provision the no-sign-in origin.");

  async function createMySpaceDocument(page: Page, title: string, body: string): Promise<{ workspaceId: string }> {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    const workspaceId = new URL(page.url()).pathname.split("/")[2];
    await page.goto(`/w/${workspaceId}/knowledge/new`);
    const form = page.locator("main");
    await form.getByLabel("Title", { exact: true }).fill(title);
    const source = await showMarkdown(form);
    await source.fill(body);
    await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
    await page.getByRole("button", { name: "Create document" }).click();
  await expect(page).not.toHaveURL(/\/knowledge\/new(?:\?.*)?$/, ROUND_TRIP);
    await expect(page.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(title, ROUND_TRIP);
    return { workspaceId };
  }

  test("owner shares, an anonymous reader follows the edits, and revoking ends it", { tag: "@smoke-team" }, async ({ page, context, playwright }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const title = `Shared Runbook ${Date.now()}`;
    const { workspaceId } = await createMySpaceDocument(page, title, "first shared body");

    // The row menu offers it, and so does the document header.
    const row = page.getByRole("treeitem", { name: title, exact: true });
    await row.click({ button: "right" });
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Share link…" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.locator("main").getByRole("button", { name: "Share link…" }).click();
    const dialog = page.getByRole("dialog", { name: "Share link" });
    await expect(dialog.getByText("without signing in")).toBeVisible();
    await dialog.getByLabel(/Label/).fill("for the reader");
    await dialog.getByRole("button", { name: "Create link" }).click();
    const item = dialog.locator("[data-share-link]").first();
    await expect(item).toContainText("for the reader", ROUND_TRIP);
    const path = await item.getAttribute("data-share-link");
    expect(path).toMatch(/^\/s\/[0-9a-f-]{36}$/);

    const originalDocumentUrl = page.url();
    await page.goto(path!);
    await page.locator(".kh-share-page > div:first-child").getByRole("link", { name: "Open in Knowledge Hub", exact: true }).click();
    await expect(page).toHaveURL(originalDocumentUrl);
    await page.locator("main").getByRole("button", { name: "Share link…" }).click();

    const reader = await playwright.request.newContext({ baseURL: phase3UnconfiguredOrigin() });
    try {
      const shared = await reader.get(path!);
      expect(shared.status()).toBe(200);
      const html = await shared.text();
      expect(html).toContain(title);
      expect(html).toContain("first shared body");
      expect(html).toContain("Shared by E2E Knowledge User");
      expect(html).toContain("Open in Knowledge Hub");
      expect(html).toContain("Shared from Knowledge Hub");
      expect(html).not.toContain("Keep useful knowledge within reach.");
      expect(html).not.toContain("Get started");
      expect(html).toContain(`${path}/open`);
      expect(html).not.toMatch(/property="og:/);
      const headers = shared.headers();
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["cache-control"]).toContain("no-store");
      expect(headers["x-robots-tag"]).toContain("noindex");
      // One header holds every directive (`middleware.ts`): the image lockdown, no framing of a
      // page that needs no sign-in, and scripts by nonce — nothing inline, here least of all.
      const policy = headers["content-security-policy"];
      // The whole directive, so a looser one cannot pass: this page's own images and the diagrams it makes itself.
      expect(policy).toMatch(/(^|;\s*)img-src 'self' blob:(\s*;|\s*$)/);
      // No audio or video from anywhere: nothing here plays one, and a diagram being laid out must not fetch one.
      expect(policy).toMatch(/(^|;\s*)media-src 'none'(\s*;|\s*$)/);
      expect(policy).toContain("frame-ancestors 'none'");
      expect(policy).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
      expect(policy).not.toContain("unsafe-inline");

      // Everything else on that origin still requires signing in: a page and an API.
      const workspace = await reader.get(`/w/${workspaceId}/knowledge`);
      expect(workspace.status()).not.toBe(200);
      expect(await workspace.text()).not.toContain("first shared body");
      expect((await reader.get("/api/workspaces")).status()).not.toBe(200);

      // The owner edits; the reader sees the new text on the next load (A2).
      await page.keyboard.press("Escape");
      const editorForm = page.locator("main");
      const source = await showMarkdown(editorForm);
      await source.fill("second shared body");
      await expect(page.locator("[data-autosave-status]")).toHaveAttribute("data-autosave-status", "saved", ROUND_TRIP);
      await editorForm.getByRole("button", { name: "Markdown", exact: true }).click();
      await expect(page.locator("article").first().getByText("second shared body")).toBeVisible(ROUND_TRIP);
      expect(await (await reader.get(path!)).text()).toContain("second shared body");

      // Revoking takes two steps, and then the link is gone for everyone.
      await page.goto(`/w/${workspaceId}/shares`);
      // The filter applies as it is typed; there is no Search button.
      await page.getByLabel("Find shares").fill(title);
      await expect(page).toHaveURL(/[?&]q=/, ROUND_TRIP);
      const managed = page.getByRole("list", { name: "Share links" });
      await expect(managed.getByRole("link", { name: title, exact: true })).toBeVisible(ROUND_TRIP);
      await expect(managed).toContainText("for the reader");
      await managed.getByRole("button", { name: `Share actions for ${title} · for the reader`, exact: true }).click();
      await page.getByRole("menuitem", { name: "Revoke", exact: true }).click();
      await page.getByRole("alertdialog", { name: "Revoke share link?" }).getByRole("button", { name: "Confirm revoke" }).click();
      await expect(page.getByText("No shares match these filters.")).toBeVisible(ROUND_TRIP);
      await chooseOption(page.getByLabel("Status", { exact: true }), "revoked");
      await expect(page).toHaveURL(/[?&]status=revoked/, ROUND_TRIP);
      await expect(managed).toContainText("Revoked", ROUND_TRIP);
      const revoked = await reader.get(path!);
      expect(revoked.status()).toBe(404);
      expect(await revoked.text()).toContain("This link is not available");

      // A malformed token and an unknown one look exactly the same.
      for (const unknown of ["/s/not-a-token", `/s/${crypto.randomUUID()}`]) {
        const response = await reader.get(unknown);
        expect(response.status()).toBe(404);
        expect(await response.text()).toContain("This link is not available");
      }
    } finally {
      await reader.dispose();
    }
  });
});
