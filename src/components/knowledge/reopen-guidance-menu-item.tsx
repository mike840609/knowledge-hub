"use client";

import { Button } from "@/components/ui/button";
import { GuidanceVisibilityContext } from "./guidance-visibility";
import { useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";

export function ReopenGuidanceMenuItem({ workspaceId, surface = "menu" }: { workspaceId: string; surface?: "menu" | "empty" }) {
  const visibility = useContext(GuidanceVisibilityContext);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();
  async function reopen() {
    if (busy) return;
    setBusy(true);
    try {
      const endpoint = `/api/workspaces/${workspaceId}/onboarding`;
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) throw new Error("Unable to load guidance settings.");
      const preference = await response.json();
      if (preference.value.dismissed) {
        const saved = await fetch(endpoint, {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: { schemaVersion: 1, dismissed: false }, version: preference.version }),
        });
        if (!saved.ok) throw new Error("Unable to reopen guidance. Try showing the guide again.");
      }
      visibility.setDismissed(false);
      router.refresh();
      toast({ message: "Getting started guide is open on Home." });
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "Unable to reopen guidance. Try again." });
    } finally { setBusy(false); }
  }
  if (surface === "empty") return <Button variant="ghost" size="sm" disabled={busy} onClick={() => void reopen()}>{busy ? "Opening guide…" : "Show getting started guide"}</Button>;
  return <MenuItem disabled={busy} onClick={() => void reopen()}>{busy ? "Opening guide…" : "Show getting started guide"}</MenuItem>;
}
