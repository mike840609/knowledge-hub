import { test, expect } from "@playwright/test";

/**
 * The policy `middleware.ts` sends with every page. What it has to prove is two things at once:
 * the app still runs under it, and markup that reached a page some other way does not.
 */
test.describe("the Content-Security-Policy", () => {
  test("lets the app run: a page hydrates and nothing it needs is refused", async ({ page }) => {
    const refused: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) refused.push(message.text());
    });
    const response = await page.goto("/");
    const policy = response!.headers()["content-security-policy"];
    expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic' 'sha256-[A-Za-z0-9+/=]+'(;|$)/);
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
    // The whole directive, so a looser one cannot pass: this page's own images and the diagrams it makes itself.
    expect(policy).toMatch(/(^|;\s*)img-src 'self' blob:(\s*;|\s*$)/);
    // No audio or video from anywhere: nothing here plays one, and a diagram being laid out must not fetch one.
    expect(policy).toMatch(/(^|;\s*)media-src 'none'(\s*;|\s*$)/);

    // The theme script ran before paint, and React attached: the palette opens only if it did.
    await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByRole("listbox", { name: "Actions and documents" })).toBeVisible();
    expect(refused).toEqual([]);
  });

  test("gives each response a nonce of its own", async ({ page }) => {
    const nonce = async () => /'nonce-([^']+)'/.exec((await page.goto("/"))!.headers()["content-security-policy"])![1];
    expect(await nonce()).not.toBe(await nonce());
  });

  test("does not run script that arrives as markup", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", /^(light|dark)$/);
    const result = await page.evaluate(
      () =>
        new Promise<{ ran: string[]; blocked: string[] }>((resolve) => {
          const ran: string[] = [];
          const blocked: string[] = [];
          (window as unknown as { khRan: string[] }).khRan = ran;
          document.addEventListener("securitypolicyviolation", (event) => blocked.push(event.violatedDirective));
          const holder = document.createElement("div");
          // An event handler written into markup, and a link that is script.
          holder.innerHTML = `<img src="/icon.svg" onload="window.khRan.push('handler')" onerror="window.khRan.push('handler')"><a id="kh-js" href="javascript:window.khRan.push('url')">x</a>`;
          document.body.appendChild(holder);
          (holder.querySelector("#kh-js") as HTMLAnchorElement).click();
          // A script the parser meets in a document under this policy.
          const frame = document.createElement("iframe");
          frame.srcdoc = `<script>parent.khRan.push('parsed')</script>`;
          document.body.appendChild(frame);
          setTimeout(() => resolve({ ran, blocked }), 1000);
        }),
    );
    expect(result.ran).toEqual([]);
    // The handler and the link are refused here and say so; the frame's script is refused in the frame's own document.
    expect(result.blocked.length).toBeGreaterThanOrEqual(2);
  });
});
