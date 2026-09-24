"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/components/shell/use-hydrated";

/**
 * The search form's submit button, and what replaces it once JavaScript runs.
 *
 * Before hydration (and with JavaScript off) this is an ordinary submit
 * button on a GET form, so search still works. Once mounted, the form
 * searches as the reader types: a pause, or a change to Scope, Source or
 * Include archived, replaces the URL with the form's current values. The
 * button then goes, because there is nothing left for it to do; Enter still
 * runs the search at once rather than waiting out the pause.
 */
export function LiveSearchSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  const hydrated = useHydrated();

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
    const later = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(search, 250);
    };
    const now = (event: Event) => {
      event.preventDefault();
      search();
    };
    form.addEventListener("input", later);
    form.addEventListener("submit", now);
    return () => {
      window.clearTimeout(timer);
      form.removeEventListener("input", later);
      form.removeEventListener("submit", now);
    };
  }, [router]);

  // Removed rather than `hidden`: the button's own inline-flex outranks the
  // attribute. With the query as the form's only text field, Enter still
  // submits without a button, and the handler above takes it.
  return (
    <span ref={ref} className="contents">
      {hydrated ? null : <Button type="submit" size="lg">Search</Button>}
    </span>
  );
}
