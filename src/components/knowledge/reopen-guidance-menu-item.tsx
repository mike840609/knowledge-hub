"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MenuItem } from "@/components/ui/menu";
import { useToast } from "@/components/ui/toast";

export function ReopenGuidanceMenuItem({ workspaceId }: { workspaceId: string }) {
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
        if (!saved.ok) throw new Error("Unable to reopen guidance. Try Getting started again.");
      }
      router.refresh();
      toast({ message: "Getting started guide is open on Home." });
    } catch (error) {
      toast({ tone: "danger", message: error instanceof Error ? error.message : "Unable to reopen guidance. Try again." });
    } finally { setBusy(false); }
  }
  return <MenuItem disabled={busy} onClick={() => void reopen()}>{busy ? "Opening guide…" : "Getting started"}</MenuItem>;
}
