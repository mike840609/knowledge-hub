// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ShareLinkDialog } from "@/components/knowledge/share-link-dialog";
import { ToastProvider } from "@/components/ui/toast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/components/shell/use-workspace-authorization", () => ({ requestWorkspaceAccessCheck: vi.fn() }));

const ALICE = { id: "11111111-1111-4111-8111-111111111111", name: "愛麗絲", nameEn: "Alice", empId: "E1" };
const BOB = { id: "22222222-2222-4222-8222-222222222222", name: "鮑勃", nameEn: null, empId: "E2" };
const DOC = { documentId: "doc-1" };

type Call = { url: string; method: string; body: unknown };
let calls: Call[];
let root: Root;
let host: HTMLDivElement;
let writeText: ReturnType<typeof vi.fn>;
let existingLinks: unknown[];
let recipients: Array<{ userId: string; name: string; nameEn: string | null; empId: string; addedAt: string }>;

const link = (over: Record<string, unknown>) => ({
  id: "link-x", label: null, path: "/s/tok-x", createdAt: "2026-11-03T00:00:00.000Z", expiresAt: null, revokedAt: null,
  active: true, totalViews: 0, lastViewedAt: null, audience: "LINK", recipientCount: null, ...over,
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  calls = [];
  existingLinks = [];
  recipients = [];
  writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method, body });
    if (url === "/api/documents/doc-1/share-links" && method === "GET") return json({ links: existingLinks });
    if (url === "/api/documents/doc-1/share-links" && method === "POST") {
      return json({ link: body.recipients ? link({ id: "link-new", path: "/s/tok-new", label: body.label ?? null, audience: "NAMED", recipientCount: body.recipients.length }) : link({ id: "link-new", path: "/s/tok-new", expiresAt: "2026-12-03T00:00:00.000Z" }) }, 201);
    }
    if (url.startsWith("/api/share-recipients/candidates")) return json({ candidates: [ALICE, BOB] });
    if (/\/api\/share-links\/[^/]+\/recipients$/.test(url) && method === "GET") return json({ recipients });
    if (/\/api\/share-links\/[^/]+\/recipients$/.test(url) && method === "POST") {
      for (const id of body.userIds) { const who = [ALICE, BOB].find((person) => person.id === id)!; recipients.push({ userId: who.id, name: who.name, nameEn: who.nameEn, empId: who.empId, addedAt: "2026-11-03T00:00:00.000Z" }); }
      return new Response(null, { status: 204 });
    }
    if (/\/recipients\/[^/]+$/.test(url) && method === "DELETE") {
      const id = url.split("/").pop();
      recipients = recipients.filter((item) => item.userId !== id);
      return new Response(null, { status: 204 });
    }
    if (/\/api\/share-links\/[^/]+\/revoke$/.test(url) && method === "POST") {
      existingLinks = existingLinks.map((item) => ({ ...(item as object), active: false, revokedAt: "2026-11-03T01:00:00.000Z" }));
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected ${method} ${url}`);
  }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function open() {
  await act(async () => { root.render(createElement(ToastProvider, null, createElement(ShareLinkDialog, { target: DOC, onOpenChange: () => {} }))); });
  await flush();
}
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
const byText = <T extends HTMLElement>(selector: string, text: string) => [...document.querySelectorAll<T>(selector)].find((node) => node.textContent?.trim() === text);
const createButton = () => byText<HTMLButtonElement>("button", "Create link")!;
// The audience choice is a native radio group; a reader clicks its label.
const mode = (name: string) => [...document.querySelectorAll<HTMLLabelElement>("label")].find((label) => label.querySelector('input[type="radio"]') && label.querySelector("span")?.textContent === name)!;
const chosen = (name: string) => mode(name).querySelector<HTMLInputElement>("input")!.checked;
const combobox = () => document.querySelector<HTMLInputElement>('form input[role="combobox"]')!;

async function pick(query: string, name: string) {
  const input = combobox();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, query); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.startsWith(name))!;
  act(() => { option.click(); });
}
const submit = () => act(async () => { document.querySelector("form")!.requestSubmit(); });
const posts = () => calls.filter((call) => call.method === "POST" && call.url === "/api/documents/doc-1/share-links");

it("offers anyone-with-the-link (with expiry) first and chosen, specific people second", async () => {
  await open();
  expect(chosen("Anyone with the link")).toBe(true);
  expect(chosen("Specific people")).toBe(false);
  expect(document.body.textContent).toContain("Expires after");
  expect(combobox()).toBeNull();
});

it("a link-mode create still sends the expiry and no recipients", async () => {
  await open();
  await submit();
  expect(posts()[0].body).toEqual({ expiresInDays: 30 });
});

it("named mode hides the expiry, asks for people, and cannot create with none", async () => {
  await open();
  await act(async () => { mode("Specific people").click(); });
  expect(chosen("Specific people")).toBe(true);
  expect(document.body.textContent).not.toContain("Expires after");
  expect(combobox()).not.toBeNull();
  expect(createButton().disabled).toBe(true);
  await submit();
  expect(posts()).toEqual([]);
});

it("a named create posts the chosen ids and no expiry key at all", async () => {
  await open();
  await act(async () => { mode("Specific people").click(); });
  await pick("a", "愛麗絲");
  await pick("b", "鮑勃");
  expect(createButton().disabled).toBe(false);
  await submit();
  await flush();
  expect(posts()).toHaveLength(1);
  expect(posts()[0].body).toEqual({ recipients: [ALICE.id, BOB.id] });
  expect("expiresInDays" in (posts()[0].body as object)).toBe(false);
  // The people are cleared once the link exists, so the next create starts empty.
  expect(document.querySelectorAll('ul[aria-label="Selected people"] li')).toHaveLength(0);
  expect(createButton().disabled).toBe(true);
});

it("a named link's row says no expiry and how many people, and copies the /open address", async () => {
  await open();
  await act(async () => { mode("Specific people").click(); });
  await pick("a", "愛麗絲");
  await submit();
  await flush();
  const row = document.querySelector<HTMLElement>('[data-share-link="/s/tok-new"]')!;
  expect(row.textContent).toContain("No expiry");
  expect(row.textContent).toContain("1 person");
  const field = row.querySelector<HTMLInputElement>("input[readonly]")!;
  expect(field.value).toBe(`${window.location.origin}/s/tok-new/open`);
  await act(async () => { byText<HTMLButtonElement>("button", "Copy link")!.click(); });
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/tok-new/open`);
});

it("an anyone-with-the-link row copies the plain /s address", async () => {
  existingLinks = [link({ id: "l1", path: "/s/tok-1", expiresAt: "2026-12-03T00:00:00.000Z" })];
  await open();
  await act(async () => { byText<HTMLButtonElement>("button", "Copy link")!.click(); });
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/s/tok-1`);
  expect(byText("button", "Manage people")).toBeUndefined();
});

it("Manage people lists who is named, says so plainly when no one is, and adds and removes people", async () => {
  existingLinks = [link({ id: "n1", path: "/s/tok-n", audience: "NAMED", recipientCount: 0, label: "Plan" })];
  await open();
  expect(document.body.textContent).toContain("0 people");
  await act(async () => { byText<HTMLButtonElement>("button", "Manage people")!.click(); });
  await flush();
  expect(calls.some((call) => call.url === "/api/share-links/n1/recipients" && call.method === "GET")).toBe(true);
  expect(document.body.textContent).toContain("No one yet — only you can open it");

  // Add through the picker. The panel's picker is the second combobox: the create form's is hidden in link mode.
  const input = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(input, "a"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 250)); });
  act(() => { [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.startsWith("愛麗絲"))!.click(); });
  await act(async () => { byText<HTMLButtonElement>("button", "Add")!.click(); });
  await flush();
  expect(calls.find((call) => call.url === "/api/share-links/n1/recipients" && call.method === "POST")!.body).toEqual({ userIds: [ALICE.id] });
  const list = document.querySelector<HTMLElement>('ul[aria-label="People who can open this link"]')!;
  expect(list.textContent).toContain("愛麗絲");
  expect(document.body.textContent).toContain("1 person");

  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Remove 愛麗絲 from this link"]')!.click(); });
  await flush();
  expect(calls.some((call) => call.method === "DELETE" && call.url === `/api/share-links/n1/recipients/${ALICE.id}`)).toBe(true);
  expect(document.body.textContent).toContain("No one yet — only you can open it");
  expect(document.body.textContent).toContain("0 people");
});

it("a failed removal shows the server's message and leaves the person listed", async () => {
  recipients = [{ userId: ALICE.id, name: ALICE.name, nameEn: ALICE.nameEn, empId: ALICE.empId, addedAt: "2026-11-03T00:00:00.000Z" }];
  existingLinks = [link({ id: "n1", path: "/s/tok-n", audience: "NAMED", recipientCount: 1 })];
  await open();
  await act(async () => { byText<HTMLButtonElement>("button", "Manage people")!.click(); });
  await flush();
  const original = globalThis.fetch;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => (init?.method === "DELETE" ? json({ error: { code: "SHARE_LINK_NOT_FOUND", message: "That link is gone." } }, 404) : original(url, init))));
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Remove 愛麗絲 from this link"]')!.click(); });
  await flush();
  expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  expect(document.querySelector('ul[aria-label="People who can open this link"]')!.textContent).toContain("愛麗絲");
});

it("a revoked named link offers no Manage people, and revoking closes the people it had open", async () => {
  existingLinks = [link({ id: "l1", path: "/s/tok-1", audience: "NAMED", recipientCount: 0 })];
  await open();
  await act(async () => { byText<HTMLButtonElement>("button", "Manage people")!.click(); });
  await flush();
  expect(document.querySelector('[data-share-link="/s/tok-1"]')!.textContent).toContain("No one yet — only you can open it.");
  await act(async () => { byText<HTMLButtonElement>("button", "Revoke")!.click(); });
  await act(async () => { byText<HTMLButtonElement>("button", "Confirm revoke")!.click(); });
  await flush();
  expect(byText("button", "Manage people")).toBeUndefined();
  expect(document.body.textContent).not.toContain("No one yet — only you can open it.");
  expect(document.body.textContent).toContain("Expired or revoked (1)");
});
