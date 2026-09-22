import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { phase3Origin, phase3UserId, type Phase3Persona } from "./fixtures/phase3-identities";

/**
 * The feedback layer, asserted by what it does rather than by what it says.
 *
 * The rule this encodes: an action is offered undo only where a reverse
 * operation already exists, and "Undo" must restore the state — not merely
 * announce itself. Each case below therefore checks the page after the undo,
 * not the toast.
 */

async function session(browser: Browser, persona: Phase3Persona) {
  const context = await browser.newContext({ baseURL: phase3Origin(persona) });
  return { context, page: await context.newPage() };
}
async function createTeam(request: APIRequestContext, name: string) {
  const response = await request.post("/api/workspaces", { data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json()).id as string;
}

test.describe("Toasts and undo", () => {
  test.skip(!process.env.KM_PHASE3_APP_ROOT, "Use the isolated HTTP harness via npm run test:e2e.");

  test("archiving acts at once, and undo restores the workspace", async ({ browser }) => {
    const { context, page } = await session(browser, "owner");
    try {
      const workspaceId = await createTeam(context.request, `Undo archive ${Date.now()}`);
      await page.goto(`/w/${workspaceId}/settings`);

      // One click, no second step.
      await page.getByRole("button", { name: "Archive workspace", exact: true }).click();
      await expect(page.getByText("State: ARCHIVED")).toBeVisible();

      const toast = page.getByRole("status").filter({ hasText: "archived" });
      await expect(toast).toBeVisible();
      await toast.getByRole("button", { name: "Undo" }).click();

      // The assertion is the state, not the message.
      await expect(page.getByText("State: ACTIVE")).toBeVisible();
      await expect(page.getByRole("button", { name: "Save name" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("undo puts a renamed workspace back to the name it had", async ({ browser }) => {
    const { context, page } = await session(browser, "owner");
    try {
      const original = `Undo rename ${Date.now()}`;
      const workspaceId = await createTeam(context.request, original);
      await page.goto(`/w/${workspaceId}/settings`);

      await page.getByLabel("Team name").fill("Renamed by mistake");
      await page.getByRole("button", { name: "Save name" }).click();
      await expect(page.getByLabel("Workspace: Renamed by mistake", { exact: true })).toBeVisible();

      await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
      await expect(page.getByLabel(`Workspace: ${original}`, { exact: true })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("undo re-grants a removed member at the role they held", async ({ browser }) => {
    const { context, page } = await session(browser, "owner");
    try {
      const workspaceId = await createTeam(context.request, `Undo member ${Date.now()}`);
      expect(
        (await context.request.post(`/api/workspaces/${workspaceId}/members`, {
          data: { userId: phase3UserId("viewer"), role: "EDITOR" },
        })).ok(),
      ).toBe(true);
      await page.goto(`/w/${workspaceId}/settings/members`);

      const row = page.getByRole("row").filter({ hasText: "Phase3 viewer" });
      await expect(row).toContainText("EDITOR");
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(page.getByRole("row").filter({ hasText: "Phase3 viewer" })).toHaveCount(0);

      await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
      // Restoring a grant goes through the add endpoint, because a role change
      // on a membership that no longer exists is refused — so this assertion
      // is the whole point of the test.
      await expect(page.getByRole("row").filter({ hasText: "Phase3 viewer" })).toContainText("EDITOR");
    } finally {
      await context.close();
    }
  });

  test("feedback lives outside the panel that produced it, in a region that was already there", async ({ browser }) => {
    const { context, page } = await session(browser, "owner");
    try {
      const workspaceId = await createTeam(context.request, `Toast region ${Date.now()}`);
      await page.goto(`/w/${workspaceId}/settings`);

      // Present before there is anything to say: a live region inserted at the
      // same moment as its content is not reliably announced.
      const region = page.getByRole("status");
      await expect(region).toHaveCount(1);
      await expect(region).toHaveAttribute("aria-live", "polite");
      await expect(region).toBeEmpty();

      await page.getByRole("button", { name: "Archive workspace", exact: true }).click();
      await expect(region).toContainText("archived");

      // And not inside the section that performed the mutation, which is what
      // used to make a message push the rest of that panel down.
      await expect(page.locator("main").getByRole("status")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
