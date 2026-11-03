"use client";

import { X } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { governanceFailure, governanceRequest } from "@/components/workspaces/governance-error";
import { DEBOUNCE_MS } from "./mention-autocomplete";

export type Recipient = { id: string; name: string; nameEn: string | null; empId: string };

const optionText = (person: Recipient) => [person.name, person.empId, person.nameEn].filter(Boolean).join(" · ");

/**
 * Search signed-in Hub users and collect them as chips. Focus stays in the field and the list is
 * pointed at with `aria-activedescendant`, the same shape as the `@` list. `exclude` names people
 * who are already in the place the chips will go, so they are never offered.
 */
export function RecipientPicker({
  value,
  onChange,
  disabled = false,
  exclude = [],
  id,
  label = "Search people by name or employee ID",
}: {
  value: Recipient[];
  onChange: (next: Recipient[]) => void;
  disabled?: boolean;
  exclude?: readonly string[];
  /** Lets a visible `<label htmlFor>` name the field; pass the same words as `label`. */
  id?: string;
  label?: string;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [found, setFound] = useState<{ query: string; people: Recipient[] }>();
  const [failure, setFailure] = useState<string>();
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const query = text.trim();

  useEffect(() => {
    if (query === "") return;
    let current = true;
    const timer = window.setTimeout(() => {
      governanceRequest<{ candidates: Recipient[] }>(`/api/share-recipients/candidates?query=${encodeURIComponent(query)}`)
        .then((result) => { if (current) { setFound({ query, people: result.candidates }); setFailure(undefined); setActive(0); } })
        .catch((error) => { if (current) setFailure(governanceFailure(error).message); });
    }, DEBOUNCE_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [query]);

  const taken = new Set([...value.map((person) => person.id), ...exclude]);
  const answered = query !== "" && found?.query === query;
  // The last answer stays up while the next one is on its way, so the list does not blink at each keystroke.
  const people = query !== "" && found ? found.people.filter((person) => !taken.has(person.id)) : [];
  const hint = query === "" || dismissed ? undefined : failure ?? (answered && people.length === 0 ? "No one found." : undefined);
  const listed = people.length > 0 && !dismissed && failure === undefined;
  const row = Math.min(active, people.length - 1);
  const optionId = (index: number) => `${listId}-option-${index}`;

  function choose(person: Recipient) {
    if (taken.has(person.id)) return;
    onChange([...value, person]);
    setText("");
    setFound(undefined);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      // The picker sits inside the dialog's form: Enter picks, it never submits.
      event.preventDefault();
      if (listed) choose(people[row]);
    } else if (event.key === "Escape" && (listed || hint)) {
      // The list's, not the dialog's.
      event.preventDefault(); event.stopPropagation();
      setDismissed(true);
    } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && listed) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (Math.min(index, people.length - 1) + step + people.length) % people.length);
    }
  }

  return (
    <div className="space-y-2">
      {value.length > 0 ? (
        <ul aria-label="Selected people" className="flex flex-wrap gap-1">
          {value.map((person) => (
            <li key={person.id} className="inline-flex h-6 items-center gap-1 rounded-md border border-kh-border bg-kh-bg-selected pl-2 pr-1 text-body-sm text-kh-selected-text">
              <span className="truncate">{person.name}</span>
              <button
                type="button"
                aria-label={`Remove ${person.name}`}
                disabled={disabled}
                onClick={() => onChange(value.filter((item) => item.id !== person.id))}
                className="kh-focus-ring rounded-sm p-0.5 hover:bg-kh-highlight disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {/* The list and its hint float over what follows instead of pushing it down. */}
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={listed}
          aria-controls={listed ? listId : undefined}
          aria-activedescendant={listed ? optionId(row) : undefined}
          autoComplete="off"
          placeholder="Name or employee ID"
          value={text}
          disabled={disabled}
          onChange={(event) => { setText(event.target.value); setDismissed(false); setFailure(undefined); }}
          onKeyDown={onKeyDown}
        />
        {listed ? (
          <ul id={listId} role="listbox" aria-label="People matching your search" className="absolute inset-x-0 top-full z-30 mt-1 max-h-[12rem] overflow-y-auto rounded-md border border-kh-border bg-kh-bg p-1 shadow-popover">
            {people.map((person, index) => (
              <li
                key={person.id}
                id={optionId(index)}
                role="option"
                aria-selected={index === row}
                className={`cursor-default truncate rounded-md px-2 py-1 text-body-sm ${index === row ? "bg-kh-bg-selected text-kh-selected-text" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(person)}
              >
                {optionText(person)}
              </li>
            ))}
          </ul>
        ) : hint ? (
          <p className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-kh-border bg-kh-bg px-2 py-1 text-body-sm text-kh-text-muted shadow-popover">{hint}</p>
        ) : null}
      </div>
    </div>
  );
}
