// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MermaidBlock } from "@/components/knowledge/mermaid-block";
import type { DiagramOutcome } from "@/components/knowledge/mermaid-queue";

// The queue is the other half of this contract and has its own tests. Here it is a stub that records
// what the block asks of it and answers when the test says so.
type Call = { key: object; index: number; source: string; resolve: (outcome: DiagramOutcome) => void };
const stub = vi.hoisted(() => ({
  calls: [] as Call[],
  forgotten: [] as object[],
  theme: "light",
  listeners: new Set<() => void>(),
}));

vi.mock("@/components/knowledge/mermaid-queue", () => ({
  diagrams: () => ({
    draw: (key: object, index: number, source: string) =>
      new Promise<DiagramOutcome>((resolve) => { stub.calls.push({ key, index, source, resolve }); }),
    forget: (key: object) => { stub.forgotten.push(key); },
  }),
  readTheme: () => stub.theme,
  subscribeTheme: (listener: () => void) => {
    stub.listeners.add(listener);
    return () => { stub.listeners.delete(listener); };
  },
}));

const FLOW = "flowchart LR\n  A --> B";
const SEQUENCE = "sequenceDiagram\n  Alice->>Bob: Hello";
const drawn = (url: string, type = "flowchart-v2"): DiagramOutcome => ({ drawn: { url, type, width: 121, height: 60 } });

/** The code block as the server sends it: the code, and the newline Markdown puts after it. */
const code = (text: string): ReactNode => (
  <div data-code-block>
    <pre><code>{text + "\n"}</code></pre>
  </div>
);

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  stub.calls = [];
  stub.forgotten = [];
  stub.theme = "light";
  stub.listeners.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function show(children: ReactNode) {
  await act(async () => { root.render(<MermaidBlock>{children}</MermaidBlock>); });
}

/** The server sends other Markdown into the same position: the same block, new children. */
const resend = show;

async function answer(call: Call, outcome: DiagramOutcome) {
  await act(async () => { call.resolve(outcome); });
}

async function changeTheme(theme: string) {
  stub.theme = theme;
  await act(async () => { stub.listeners.forEach((listener) => listener()); });
}

const figure = () => container.querySelector("figure")!;
const picture = () => container.querySelector<HTMLImageElement>("img[data-diagram]");
const reasonLine = () => container.querySelector("[data-diagram-reason]");
const disclosure = () => container.querySelector("details")!;
const summary = () => container.querySelector("summary")!;

describe("a mermaid block, once its drawing arrives", () => {
  it("shows the drawing as an image of the size and kind it was given, closes the source and calls it Source", async () => {
    await show(code(FLOW));
    await answer(stub.calls[0], drawn("blob:one", "flowchart-v2"));
    const image = picture()!;
    expect(image.getAttribute("src")).toBe("blob:one");
    expect(image.getAttribute("width")).toBe("121");
    expect(image.getAttribute("height")).toBe("60");
    expect(image.getAttribute("alt")).toBe("Diagram (flowchart-v2). Its source follows.");
    expect(disclosure().open).toBe(false);
    expect(summary().textContent).toBe("Source");
    expect(summary().classList.contains("hidden")).toBe(false);
    expect(reasonLine()).toBeNull();
  });

  it("is the code block it was until then: open, with its summary hidden", async () => {
    await show(code(FLOW));
    expect(picture()).toBeNull();
    expect(disclosure().open).toBe(true);
    expect(summary().classList.contains("hidden")).toBe(true);
  });

  it("says why it is not drawn, as text, and stays the code block it was", async () => {
    await show(code(FLOW));
    await answer(stub.calls[0], { reason: "Could not draw this diagram: <b>bad</b>" });
    expect(reasonLine()!.textContent).toBe("Could not draw this diagram: <b>bad</b>");
    expect(reasonLine()!.children.length).toBe(0);
    expect(picture()).toBeNull();
    expect(disclosure().open).toBe(true);
    expect(summary().classList.contains("hidden")).toBe(true);
  });

  it("keeps the code block's own nodes, because a comment is anchored in them", async () => {
    await show(code(FLOW));
    const pre = container.querySelector("pre");
    const text = container.querySelector("code")!.firstChild;
    await answer(stub.calls[0], drawn("blob:one"));
    expect(container.querySelector("pre")).toBe(pre);
    expect(container.querySelector("code")!.firstChild).toBe(text);
    expect(pre!.closest("details")).toBe(disclosure());
  });
});

describe("what a mermaid block asks to have drawn", () => {
  it("is its code as written, without the newline Markdown adds, for its own element", async () => {
    await show(code(FLOW));
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].source).toBe(FLOW);
    expect(stub.calls[0].key).toBe(figure());
  });

  it("carries its place among the page's diagrams", async () => {
    await act(async () => {
      root.render(<><MermaidBlock>{code(FLOW)}</MermaidBlock><MermaidBlock>{code(SEQUENCE)}</MermaidBlock></>);
    });
    const byIndex = new Map(stub.calls.map((call) => [call.index, call.source]));
    expect(byIndex.get(0)).toBe(FLOW);
    expect(byIndex.get(1)).toBe(SEQUENCE);
  });

  it("is asked again when the server sends other source into the same place, and the new drawing replaces the old", async () => {
    await show(code(FLOW));
    await answer(stub.calls[0], drawn("blob:flow"));
    expect(picture()!.getAttribute("src")).toBe("blob:flow");

    await resend(code(SEQUENCE));
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1].source).toBe(SEQUENCE);
    expect(stub.calls[1].key).toBe(stub.calls[0].key);
    // Until the replacement arrives the old picture stays, as it does for a theme.
    expect(picture()!.getAttribute("src")).toBe("blob:flow");
    expect(container.querySelector("code")!.textContent).toBe(SEQUENCE + "\n");

    await answer(stub.calls[1], drawn("blob:sequence", "sequence"));
    expect(picture()!.getAttribute("src")).toBe("blob:sequence");
    expect(picture()!.getAttribute("alt")).toBe("Diagram (sequence). Its source follows.");
  });

  it("is not asked again when it renders again with the very same code block", async () => {
    const same = code(FLOW);
    await show(same);
    await answer(stub.calls[0], drawn("blob:one"));
    // The block's own state update was one re-render; the parent sending the same element is another.
    await show(same);
    await show(same);
    expect(stub.calls).toHaveLength(1);
    expect(picture()!.getAttribute("src")).toBe("blob:one");
  });

  it("is asked again when the theme changes, and a source the reader opened stays open", async () => {
    await show(code(FLOW));
    await answer(stub.calls[0], drawn("blob:light"));
    disclosure().open = true;

    await changeTheme("dark");
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[1].source).toBe(FLOW);
    await answer(stub.calls[1], drawn("blob:dark"));
    expect(picture()!.getAttribute("src")).toBe("blob:dark");
    expect(disclosure().open).toBe(true);
  });

  it("opens the source and shows why when the new source of a drawn block cannot be drawn", async () => {
    await show(code(FLOW));
    await answer(stub.calls[0], drawn("blob:flow"));
    expect(disclosure().open).toBe(false);

    await resend(code("flowchart LR\n  A[Unclosed --> B"));
    await answer(stub.calls[1], { reason: "Could not draw this diagram: Parse error" });
    expect(picture()).toBeNull();
    expect(reasonLine()!.textContent).toBe("Could not draw this diagram: Parse error");
    expect(disclosure().open).toBe(true);
    expect(summary().classList.contains("hidden")).toBe(true);
  });
});

describe("a drawing that is no longer wanted", () => {
  it("is not shown when it arrives after a newer request", async () => {
    await show(code(FLOW));
    await changeTheme("dark");
    const [first, second] = stub.calls;

    await answer(second, drawn("blob:dark"));
    await answer(first, drawn("blob:light"));
    expect(picture()!.getAttribute("src")).toBe("blob:dark");
  });

  it("is not shown when it arrives before the newer one does", async () => {
    await show(code(FLOW));
    await changeTheme("dark");
    const [first, second] = stub.calls;

    await answer(first, drawn("blob:light"));
    expect(picture()).toBeNull();
    await answer(second, drawn("blob:dark"));
    expect(picture()!.getAttribute("src")).toBe("blob:dark");
  });

  it("is given back when the block leaves the page", async () => {
    await show(code(FLOW));
    const element = figure();
    await act(async () => root.render(<></>));
    expect(stub.forgotten).toEqual([element]);
  });
});
