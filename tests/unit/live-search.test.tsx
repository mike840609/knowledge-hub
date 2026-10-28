// @vitest-environment jsdom
import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * A filter row with no button (Shares): typing applies after a pause, Enter applies at once, and a chosen
 * option applies at once with the value just chosen — not the one the form held a render earlier. The URL is
 * the state, so each of these is a `router.replace` to the form's action with its fields.
 */
const navigation = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: navigation.replace }) }));

import { applyAndSearch, LiveSearch } from "@/components/search/live-search-submit";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigation.replace.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// The shape of a Shares filter: one text field, and a choice held in state that reaches the form as a hidden field.
function Filters() {
  const form = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState("active");
  return (
    <form ref={form} action="/w/ws-1/shares" method="get">
      <input aria-label="Find shares" name="q" defaultValue="" />
      <input type="hidden" name="status" value={status} />
      <button type="button" onClick={() => applyAndSearch(form.current, () => setStatus("revoked"))}>Choose revoked</button>
      <LiveSearch />
    </form>
  );
}

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const field = () => container.querySelector<HTMLInputElement>('input[name="q"]')!;
async function type(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows no button of its own", async () => {
  await act(async () => root.render(<Filters />));
  expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Choose revoked"]);
  expect(container.querySelector('[type="submit"]')).toBeNull();
});

it("applies what is typed once typing pauses, as one replace", async () => {
  await act(async () => root.render(<Filters />));
  await type("ro");
  await type("road");
  expect(navigation.replace).not.toHaveBeenCalled();
  await wait(300);
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenCalledWith("/w/ws-1/shares?q=road&status=active", { scroll: false });
});

it("applies at once on Enter", async () => {
  await act(async () => root.render(<Filters />));
  await type("roadmap");
  await act(async () => container.querySelector("form")!.requestSubmit());
  expect(navigation.replace).toHaveBeenCalledWith("/w/ws-1/shares?q=roadmap&status=active", { scroll: false });
});

it("applies a chosen option at once, with the value just chosen", async () => {
  await act(async () => root.render(<Filters />));
  await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenCalledWith("/w/ws-1/shares?status=revoked", { scroll: false });
});

it("leaves out empty fields, so clearing the text returns to the unfiltered address", async () => {
  await act(async () => root.render(<Filters />));
  await type("");
  await wait(300);
  expect(navigation.replace).toHaveBeenCalledWith("/w/ws-1/shares?status=active", { scroll: false });
});

// The shape of the Updates filter: a native select and a checkbox, each chosen in one act.
function NativeChoices() {
  return (
    <form action="/w/ws-1/updates" method="get">
      <select aria-label="Folder" name="source" defaultValue="">
        <option value="">All folders</option>
        <option value="src-a">A</option>
      </select>
      <input type="checkbox" aria-label="Unread only" name="unread" value="true" />
      <LiveSearch />
    </form>
  );
}

it("applies a native select or checkbox at once, without waiting for a typing pause", async () => {
  await act(async () => root.render(<NativeChoices />));
  const select = container.querySelector("select")!;
  await act(async () => {
    select.value = "src-a";
    select.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(navigation.replace).toHaveBeenCalledTimes(1);
  expect(navigation.replace).toHaveBeenLastCalledWith("/w/ws-1/updates?source=src-a", { scroll: false });
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(navigation.replace).toHaveBeenCalledTimes(2);
  expect(navigation.replace).toHaveBeenLastCalledWith("/w/ws-1/updates?source=src-a&unread=true", { scroll: false });
});
