// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { useIsWide } from "@/components/knowledge/use-is-wide";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Listener = () => void;

function stubMatchMedia(matches: boolean, queries: string[], listeners: Set<Listener>) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => {
      queries.push(query);
      return {
        matches,
        media: query,
        addEventListener: (_type: string, listener: Listener) => {
          listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: Listener) => {
          listeners.delete(listener);
        },
      };
    },
  );
  Object.defineProperty(window, "matchMedia", {
    value: window.matchMedia,
    configurable: true,
    writable: true,
  });
}

function Probe({ breakpoint }: { breakpoint?: number }) {
  const wide = useIsWide(breakpoint);
  return <div data-wide={wide ? "true" : "false"} />;
}

async function renderProbe(breakpoint?: number) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<Probe breakpoint={breakpoint} />);
  });
  return { host, root };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("starts narrow (SSR-safe) and follows the default 1024px query", async () => {
  const queries: string[] = [];
  const listeners = new Set<Listener>();
  stubMatchMedia(true, queries, listeners);
  const { root } = await renderProbe();
  try {
    expect(document.body.querySelector("[data-wide]")?.getAttribute("data-wide")).toBe("true");
    expect(queries).toEqual(["(min-width: 1024px)"]);
  } finally {
    await act(async () => root.unmount());
  }
});

it("reports narrow when the query does not match", async () => {
  const { root } = await renderProbe();
  try {
    expect(document.body.querySelector("[data-wide]")?.getAttribute("data-wide")).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});

it("honours a custom breakpoint", async () => {
  const queries: string[] = [];
  const listeners = new Set<Listener>();
  stubMatchMedia(false, queries, listeners);
  const { root } = await renderProbe(1440);
  try {
    expect(queries).toEqual(["(min-width: 1440px)"]);
    expect(document.body.querySelector("[data-wide]")?.getAttribute("data-wide")).toBe("false");
  } finally {
    await act(async () => root.unmount());
  }
});
