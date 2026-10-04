"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** GET fallback and debounced live search share the same form values.
 * The visible submit button also supports Enter across multiple text fields. */
export function LiveSearchSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
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

  return (
    <span ref={ref} className="contents">
      <Button type="submit" size="lg">Search</Button>
    </span>
  );
}
