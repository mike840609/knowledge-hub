"use client";

import { useEffect, useState } from "react";

/**
 * False on the server and for the first client render, true once this
 * component has mounted — that is, once its event handlers exist.
 *
 * It matters for a `<form onSubmit>` that is server-rendered with a
 * `type="submit"` button and no `action`. Until React has hydrated, the
 * handler that calls `preventDefault()` is not attached, so a click performs a
 * **native** submit: the browser navigates to the same URL as a GET with the
 * fields as query parameters, the server re-renders from stored state, and
 * everything the reader typed is gone without a word.
 *
 * The window is short and it is real: CI caught it on the document editor,
 * where a second page loading in the same browser delayed hydration enough for
 * a save to land inside it. A control that cannot do its job yet says so by
 * being disabled; that is also what makes the behaviour testable, because a
 * test clicking the button waits for it rather than racing it.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
