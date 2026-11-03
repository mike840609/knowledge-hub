import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { foreignHubShareRedirect, REQUEST_PATH_HEADER } from "@/lib/share-paths";
import { middleware } from "@/middleware";

const TOKEN = "2f1c7e9a-4b3d-4c5e-9f6a-7b8c9d0e1f2a";
const OWN = "0199f300-0000-7000-8000-00000000000b";

/** Named-recipient share spec, "Where a NAMED share is read": a copied Hub reader URL on someone else's Workspace. */
describe("foreignHubShareRedirect", () => {
  it("sends a share reader path to the caller's own Workspace, keeping the whole query", () => {
    expect(foreignHubShareRedirect(`/w/other/shares/${TOKEN}`, OWN)).toBe(`/w/${OWN}/shares/${TOKEN}`);
    expect(foreignHubShareRedirect(`/w/other/shares/${TOKEN}?d=doc&thread=t`, OWN)).toBe(`/w/${OWN}/shares/${TOKEN}?d=doc&thread=t`);
  });

  it("leaves every other path alone, so it stays a 404", () => {
    for (const path of [null, "", "/w/other/inbox", "/w/other/shares", "/w/other/shares/not-a-token", `/w/other/shares/${TOKEN}/x`,
      `/w/other/knowledge/${TOKEN}`, `/x/w/other/shares/${TOKEN}`, `/w/other/shares/${TOKEN.toUpperCase()}`, "/w/other/shares/2f1c7e9a-4b3d-1c5e-9f6a-7b8c9d0e1f2a"]) {
      expect(foreignHubShareRedirect(path, OWN), String(path)).toBeNull();
    }
  });
});

describe("the middleware's request path header", () => {
  it("is the page's own path and query, never one the client sent", async () => {
    const request = new NextRequest(`https://km.example.com/w/other/shares/${TOKEN}?d=doc`, { headers: { [REQUEST_PATH_HEADER]: "/w/other/shares/forged" } });
    const response = await middleware(request);
    expect(response.headers.get(`x-middleware-request-${REQUEST_PATH_HEADER}`)).toBe(`/w/other/shares/${TOKEN}?d=doc`);
  });
});
