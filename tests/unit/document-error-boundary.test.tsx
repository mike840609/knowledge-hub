import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import DocumentReadError from "@/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error";

it("offers a retry without leaving the document address", () => {
  const html = renderToStaticMarkup(<DocumentReadError error={new Error("offline")} reset={() => {}} />);
  expect(html).toContain("This document could not be loaded");
  expect(html).toContain("Retry");
});
