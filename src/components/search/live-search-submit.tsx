"use client";

import { useEffect, useRef, type RefObject } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Typing pause before the URL follows the fields. */
const LIVE_SEARCH_DEBOUNCE_MS = 250;

/**
 * The enclosing GET form searches as the reader types: the fields become the URL, so a search stays
 * shareable, and without JavaScript the form still submits as a plain GET. Enter (a submit) searches at once.
 */
function useLiveSearch(ref: RefObject<HTMLElement | null>) {
  const router = useRouter();

  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    let timer: number | undefined;
    const search = () => {
      window.clearTimeout(timer);
      const params = new URLSearchParams();
      for (const [name, value] of new FormData(form)) {
        if (typeof value === "string" && value !== "") params.append(name, value);
      }
      // Only the fields travel, so a new query starts again at page 1.
      router.replace(`${form.getAttribute("action")}${params.size ? `?${params}` : ""}`, { scroll: false });
    };
    const later = (event: Event) => {
      window.clearTimeout(timer);
      // A native choice is made in one act, so it applies at once; only typing waits for a pause.
      const target = event.target;
      if (target instanceof HTMLSelectElement || (target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio"))) {
        search();
        return;
      }
      timer = window.setTimeout(search, LIVE_SEARCH_DEBOUNCE_MS);
    };
    const now = (event: Event) => {
      event.preventDefault();
      search();
    };
    form.addEventListener("input", later);
    form.addEventListener("submit", now);
    form.dataset.liveSearchReady = "true";
    return () => {
      window.clearTimeout(timer);
      form.removeEventListener("input", later);
      form.removeEventListener("submit", now);
      delete form.dataset.liveSearchReady;
    };
  }, [ref, router]);
}

/** GET fallback and debounced live search share the same form values.
 * The visible submit button also supports Enter across multiple text fields. */
export function LiveSearchSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useLiveSearch(ref);
  return (
    <span ref={ref} className="contents">
      <Button type="submit" size="lg">Search</Button>
    </span>
  );
}

/**
 * The same live search with no button, for a filter row in a client view: what is typed or chosen applies
 * by itself. Enter still applies at once, because a form whose only text field is that one submits on Enter
 * without a button.
 */
export function LiveSearch() {
  const ref = useRef<HTMLSpanElement>(null);
  useLiveSearch(ref);
  return <span ref={ref} hidden />;
}

/**
 * A choice that is not typed (a `SelectMenu`) fires no `input` event, and its hidden field takes the new
 * value only when React commits it. Commit first, then search, so the form is read with the value just chosen.
 */
export function applyAndSearch(form: HTMLFormElement | null, apply: () => void) {
  flushSync(apply);
  form?.requestSubmit();
}
