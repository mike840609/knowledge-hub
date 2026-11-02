import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const navigation = vi.hoisted(() => ({ pathname: "/s/abc", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

import { OpenInHubHint } from "@/components/knowledge/open-in-hub-hint";

const DOCUMENT_ID = "0199f300-0000-7000-8000-0000000000aa";

function hintHref(): string | null {
  const html = renderToStaticMarkup(<OpenInHubHint />);
  return /href="([^"]*)"/.exec(html)?.[1]?.replaceAll("&amp;", "&") ?? null;
}

beforeEach(() => {
  navigation.pathname = "/s/abc";
  navigation.search = "";
});

describe("OpenInHubHint", () => {
  it("links a share page to its open route", () => {
    expect(hintHref()).toBe("/s/abc/open");
    expect(renderToStaticMarkup(<OpenInHubHint />)).toContain("如果這是分享給你的，請在 Hub 中開啟");
  });

  it("keeps the folder document a page names", () => {
    navigation.search = `d=${DOCUMENT_ID}`;
    expect(hintHref()).toBe(`/s/abc/open?d=${DOCUMENT_ID}`);
  });

  it("carries nothing else of the query", () => {
    navigation.search = "x=1";
    expect(hintHref()).toBe("/s/abc/open");
  });

  it("is not shown on the open route's own not-found, where it would link to itself", () => {
    navigation.pathname = "/s/abc/open";
    expect(renderToStaticMarkup(<OpenInHubHint />)).toBe("");
    navigation.search = `d=${DOCUMENT_ID}`;
    expect(renderToStaticMarkup(<OpenInHubHint />)).toBe("");
  });

  it("renders nothing outside a share path", () => {
    navigation.pathname = "/elsewhere";
    expect(renderToStaticMarkup(<OpenInHubHint />)).toBe("");
  });
});
