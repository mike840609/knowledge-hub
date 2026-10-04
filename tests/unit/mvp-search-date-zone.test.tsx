// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { SearchDateZone } from "@/components/search/search-date-zone";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it("synchronizes the displayed and submitted offset after client navigation", async () => {
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<SearchDateZone offset="480" />));
    expect(host.textContent).toContain("UTC+08:00");
    await act(async () => root.render(<SearchDateZone offset="-300" />));
    expect(host.textContent).toContain("UTC−05:00");
    expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("-300");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
