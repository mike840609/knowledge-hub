"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Button } from "@/components/ui/button";

type Outcome = "copied" | "failed" | null;

const OUTCOME_SHOWN_MS = 1500;

/**
 * The code as the author wrote it. A `<pre>` holds the code and the newline Markdown puts after
 * it; nobody who copies a block wants that newline pasted into a terminal.
 */
export function codeAsWritten(text: string): string {
  return text.endsWith("\n") ? text.slice(0, -1) : text;
}

/**
 * Copies the code block it sits in. It reads the text from the page when it is clicked, rather than
 * being handed it: a prop would send every block's code a second time, in the page's data, to
 * spare one lookup. `textContent` is the code without the colour — the spans hold the same text.
 *
 * It stands alone. A shared page (`/s/:token`) has no app shell, so there is no toast to use, and
 * the outcome is said here, in words, in a live region: "Copied", or "Could not copy" when the
 * browser refuses (permission, or a page that is not a secure context). Neither throws.
 */
export function CopyCodeButton() {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(event: MouseEvent<HTMLButtonElement>) {
    const pre = event.currentTarget.closest("[data-code-block]")?.querySelector("pre");
    let result: Outcome = "failed";
    if (pre) {
      try {
        await navigator.clipboard.writeText(codeAsWritten(pre.textContent ?? ""));
        result = "copied";
      } catch {
        // Refused, or there is no clipboard here: said below, not thrown.
      }
    }
    setOutcome(result);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutcome(null), OUTCOME_SHOWN_MS);
  }

  return (
    // Opaque, so a long line scrolling under the corner does not show through the icon. Not printed: a page is.
    <div className="absolute right-1.5 top-1.5 flex items-center rounded-md bg-kh-bg-subtle print:hidden">
      <span aria-live="polite" className={`whitespace-nowrap text-caption ${outcome === "failed" ? "text-kh-danger" : "text-kh-text-muted"} ${outcome ? "pl-1.5" : ""}`}>
        {outcome === "copied" ? "Copied" : outcome === "failed" ? "Could not copy" : ""}
      </span>
      <Button variant="ghost" size="sm" icon aria-label="Copy code" onClick={copy}>
        {outcome === "copied" ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </Button>
    </div>
  );
}
