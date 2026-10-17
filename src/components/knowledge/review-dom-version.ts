"use client";
import { useLayoutEffect, useState } from "react";

/** The editor's document replaces its loading preview asynchronously. Review overlays
 * resolve fresh DOM ranges after canonical paths have been stamped on that document. */
export function useReviewDomVersion() {
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    const refresh = () => setVersion(value => value + 1);
    document.addEventListener("kh:review-dom-ready", refresh);
    return () => document.removeEventListener("kh:review-dom-ready", refresh);
  }, []);
  return version;
}
