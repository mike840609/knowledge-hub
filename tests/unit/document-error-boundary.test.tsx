// @vitest-environment jsdom
import { act, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import WorkspaceError from "@/app/w/[workspaceId]/error";
import SourceDocumentError from "@/app/w/[workspaceId]/knowledge/[sourceId]/error";
import DocumentReadError from "@/app/w/[workspaceId]/knowledge/[sourceId]/[documentId]/error";
import ProfileError from "@/app/w/[workspaceId]/profile/error";

const calls = vi.hoisted(() => [] as string[]);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => calls.push("refresh") }),
  useParams: () => ({ workspaceId: "ws-1" }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { calls.length = 0; document.body.innerHTML = ""; });

type Boundary = ComponentType<{ error: Error & { digest?: string }; reset: () => void }>;

it("offers a retry without leaving the document address", () => {
  const html = renderToStaticMarkup(<DocumentReadError error={new Error("offline")} reset={() => {}} />);
  expect(html).toContain("This document could not be loaded");
  expect(html).toContain("Retry");
});

it.each([
  ["workspace", WorkspaceError as Boundary, "Retry this page"],
  ["source", SourceDocumentError as Boundary, "Retry"],
  ["document", DocumentReadError as Boundary, "Retry"],
  ["profile", ProfileError as Boundary, "Try again"],
])("the %s boundary refetches the server segment before resetting", async (_name, Boundary, label) => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  await act(async () => { root.render(<Boundary error={new Error("offline")} reset={() => calls.push("reset")} />); });
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === label);
  await act(async () => { button!.click(); });
  expect(calls).toEqual(["refresh", "reset"]);
  act(() => root.unmount());
});
