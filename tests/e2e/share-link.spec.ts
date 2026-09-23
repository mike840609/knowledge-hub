import { expect, test, type Page } from "@playwright/test";
import { phase3UnconfiguredOrigin } from "./fixtures/phase3-identities";

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
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Run npm run test:e2e to provision the no-sign-in origin.");

  async function createMySpaceDocument(page: Page, title: string, body: string): Promise<{ workspaceId: string }> {
    await page.goto("/");
    await page.waitForURL(/\/w\/[^/]+\/knowledge/);
    const workspaceId = new URL(page.url()).pathname.split("/")[2];
    await page.goto(`/w/${workspaceId}/knowledge/new`);
    await page.getByLabel("Document title").fill(title);
    await page.getByLabel(/Content/).fill(body);
    await expect(page.getByRole("button", { name: "Create document" })).toBeEnabled(ROUND_TRIP);
    await page.getByRole("button", { name: "Create document" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible(ROUND_TRIP);
    return { workspaceId };
  }

  test("owner shares, an anonymous reader follows the edits, and revoking ends it", async ({ page, context, playwright }) => {
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

    const reader = await playwright.request.newContext({ baseURL: phase3UnconfiguredOrigin() });
    try {
      const shared = await reader.get(path!);
      expect(shared.status()).toBe(200);
      const html = await shared.text();
      expect(html).toContain(title);
      expect(html).toContain("first shared body");
      expect(html).toContain("Shared by E2E Knowledge User");
      expect(html).not.toMatch(/property="og:/);
      const headers = shared.headers();
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["cache-control"]).toContain("no-store");
      expect(headers["x-robots-tag"]).toContain("noindex");
      // Both directives, in one header: a second CSP rule would replace the
      // global img-src lockdown rather than add to it.
      expect(headers["content-security-policy"]).toBe("img-src 'self'; frame-ancestors 'none'");

      // Everything else on that origin still requires signing in: a page and an API.
      const workspace = await reader.get(`/w/${workspaceId}/knowledge`);
      expect(workspace.status()).not.toBe(200);
      expect(await workspace.text()).not.toContain("first shared body");
      expect((await reader.get("/api/workspaces")).status()).not.toBe(200);

      // The owner edits; the reader sees the new text on the next load (A2).
      await page.keyboard.press("Escape");
      await page.getByRole("link", { name: "Edit", exact: true }).click();
      const editorForm = page.locator("main form").first();
      await editorForm.getByLabel("Markdown").fill("second shared body");
      await editorForm.getByRole("button", { name: "Save" }).click();
      await expect(page.locator("article").first().getByText("second shared body")).toBeVisible(ROUND_TRIP);
      expect(await (await reader.get(path!)).text()).toContain("second shared body");

      // Revoking takes two steps, and then the link is gone for everyone.
      await page.locator("main").getByRole("button", { name: "Share link…" }).click();
      await dialog.getByRole("button", { name: "Revoke" }).click();
      await dialog.getByRole("button", { name: "Confirm revoke" }).click();
      await expect(dialog.getByText("No active links.")).toBeVisible(ROUND_TRIP);
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
