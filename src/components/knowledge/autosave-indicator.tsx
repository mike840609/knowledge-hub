"use client";
import { useEffect, useRef, useState } from "react";

/** Normal, fast saves stay silent. Keep a stable slot so the toolbar never shifts. */
export function AutosaveIndicator({ state, attention }: { state: string; attention?: string }) {
  const [message, setMessage] = useState("");
  const shown = useRef(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (attention) {
      shown.current = false;
      setMessage("");
    } else if (state === "saving") {
      setMessage("");
      timer = setTimeout(() => { shown.current = true; setMessage("Saving…"); }, 1000);
    } else if (state === "saved" && shown.current) {
      setMessage("Saved");
      timer = setTimeout(() => { shown.current = false; setMessage(""); }, 2000);
    } else {
      shown.current = false;
      setMessage("");
    }
    return () => clearTimeout(timer);
  }, [state, attention]);
  return <span role="status" aria-live="polite" data-autosave-status={state}
    className="inline-block w-20 text-right text-caption text-kh-text-muted">
    {attention ?? message}
  </span>;
}
