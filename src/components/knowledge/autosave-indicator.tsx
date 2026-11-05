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
  const showing = Boolean(attention ?? message);
  // The slot never moves; the sentence arrives and leaves softly. A save that is over in a moment
  // stays silent, so this fade is only ever seen on a slow save, the confirmation after it, and the
  // states that ask for attention.
  return <span role="status" aria-live="polite" data-autosave-status={state}
    className={`inline-block text-right text-caption transition-opacity duration-120 ease-out ${attention ? "text-kh-danger" : "text-kh-text-muted"} ${showing ? "w-20 opacity-100" : "w-20 opacity-0 max-sm:w-0 max-sm:overflow-hidden"}`}>
    {attention ?? message}
  </span>;
}
