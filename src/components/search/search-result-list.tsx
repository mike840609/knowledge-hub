"use client";

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const ROW = "a[data-search-result]";

/**
 * Arrow-key navigation over the results, matching the idiom the knowledge tree
 * and the ⌘K palette already use. The rows stay server-rendered — this only
 * moves focus, so Enter, ⌘-click and middle-click keep their native meaning.
 *
 * Links keep their natural tab stop rather than taking a roving tabindex: a
 * roving one would leave every row unreachable if this script never runs.
 */
export function SearchResultList({ label, children }: { label: string; children: ReactNode }) {
  const listRef = useRef<HTMLUListElement>(null);
  const rows = () => Array.from(listRef.current?.querySelectorAll<HTMLAnchorElement>(ROW) ?? []);

  // ArrowDown out of the search field drops into the results, so the list is
  // reachable without tabbing past the scope and source selects.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "ArrowDown") return;
      if ((event.target as HTMLElement | null)?.id !== "search-q") return;
      const first = rows()[0];
      if (!first) return;
      event.preventDefault();
      first.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const items = rows();
    if (items.length === 0) return;
    const current = (event.target as HTMLElement).closest?.(ROW) as HTMLAnchorElement | null;
    const index = current ? items.indexOf(current) : -1;
    const focusAt = (next: number) => {
      const target = items[next];
      if (target) {
        event.preventDefault();
        target.focus();
      }
    };
    switch (event.key) {
      case "ArrowDown":
        focusAt(index < 0 ? 0 : Math.min(index + 1, items.length - 1));
        break;
      case "ArrowUp":
        // Stepping up off the first row returns to the query, so the list and
        // the field behave as one control.
        if (index === 0) {
          const input = document.getElementById("search-q");
          if (input) {
            event.preventDefault();
            input.focus();
          }
          break;
        }
        focusAt(index < 0 ? 0 : index - 1);
        break;
      case "Home":
        focusAt(0);
        break;
      case "End":
        focusAt(items.length - 1);
        break;
      default:
        break;
    }
  }

  return (
    <ul ref={listRef} aria-label={label} onKeyDown={handleKeyDown} className="flex flex-col gap-0.5">
      {children}
    </ul>
  );
}
