import { beforeEach, expect, it, vi } from "vitest";
import { DocumentNotFoundError } from "@/modules/knowledge/domain/errors";
import { documentExcerpt } from "@/shared/markdown/document-excerpt";

const injected = vi.hoisted(() => ({ read: vi.fn(), caller: { userId: "reader" } }));
vi.mock("@/server/composition", () => ({ applicationServices: () => ({
  establishTrustedCaller: async () => ({ caller: injected.caller }),
  queries: { getCurrentRevision: injected.read },
}) }));
import { GET } from "@/app/api/documents/[documentId]/preview/route";
const request = () => GET(new Request("http://hub.test/api/documents/d1/preview"), { params: Promise.resolve({ documentId: "d1" }) });
beforeEach(() => { injected.read.mockReset(); });

it("checks the current caller's read access and returns only a bounded preview without caching", async () => {
  injected.read.mockResolvedValue({ title: "Guide", markdown: "Hello **world**. ".repeat(50), metadata: { private: true } });
  const response = await request();
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(injected.read).toHaveBeenCalledWith(injected.caller, "d1");
  expect(Object.keys(body).sort()).toEqual(["excerpt", "title"]);
  expect(body.excerpt.length).toBeLessThanOrEqual(280);
  expect(body.excerpt).toContain("Hello world.");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});

it("does not reveal an inaccessible or archived document", async () => {
  injected.read.mockRejectedValue(new DocumentNotFoundError());
  const response = await request();
  expect(response.status).toBe(404);
  expect(await response.text()).not.toContain("excerpt");
});

it("extracts visible prose without HTML comments, code blocks or link destinations", () => {
  expect(documentExcerpt("# Guide\n\nHello **world** and [docs](https://secret.test).\n\n<!-- private -->\n\n```js\nsecret()\n```\n\nNext line.")).toBe("Guide Hello world and docs. Next line.");
});
