import type { Suggestion } from "./link-suggestions";

/**
 * What the list says when it has no documents to offer. Words, not silence: an empty box under
 * `[[` reads as broken, and a list that could not be fetched is the one case where "nothing matches"
 * would be a lie.
 */
export type SuggestMessage =
  | { kind: "loading" }
  | { kind: "failed" }
  /** `searched` is how many documents were looked through, and `cut` says there are more the list never held. */
  | { kind: "empty"; searched: number; cut: boolean };

export function messageText(message: SuggestMessage): string {
  switch (message.kind) {
    case "loading":
      return "Loading documents…";
    case "failed":
      return "Couldn't load suggestions. You can still type the link out.";
    case "empty":
      return message.cut
        ? `No match among the ${message.searched.toLocaleString("en-US")} most recently edited documents.`
        : "No matching documents.";
  }
}

export type SuggestView = {
  suggestions: readonly Suggestion[];
  message: SuggestMessage | null;
  active: number;
};

export type SuggestPopup = {
  element: HTMLElement;
  /** The id of the listbox, for the editor's `aria-controls`; the id of the option in force, for `aria-activedescendant`. */
  listboxId: string;
  optionId: (index: number) => string;
  render: (view: SuggestView, onPick: (index: number) => void) => void;
  show: (at: { left: number; top: number; bottom: number }) => void;
  hide: () => void;
  visible: () => boolean;
  destroy: () => void;
};

let sequence = 0;

const ROW = "flex cursor-pointer items-baseline gap-2 rounded-md px-3 py-1.5";
const ROW_ACTIVE = "bg-kh-bg-selected";
const ROW_IDLE = "hover:bg-kh-bg-hover";

/**
 * The floating list, built from the DOM because it belongs to a ProseMirror plugin, not to React.
 * It sits over the page (`fixed`, on `document.body`) so no scrolling ancestor of the editor can
 * clip it, and it never takes focus: the caret stays in the document, and the keys are the plugin's.
 *
 * A polite live region says how many suggestions there are, or why there are none, when that
 * changes; which one is chosen is `aria-activedescendant` on the editor. The page's own
 * `role="status"` is the toast region and is left to it.
 */
export function createSuggestPopup(): SuggestPopup {
  sequence += 1;
  const id = `kh-wikilink-suggest-${sequence}`;
  const element = document.createElement("div");
  element.className = "kh-wikilink-suggest";
  element.dataset.show = "false";

  const announce = document.createElement("div");
  announce.className = "sr-only";
  announce.setAttribute("aria-live", "polite");
  announce.setAttribute("aria-atomic", "true");

  const list = document.createElement("ul");
  list.id = id;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Documents to link to");
  list.className = "max-h-72 overflow-y-auto";

  const message = document.createElement("p");
  message.className = "px-3 py-2 text-body-sm text-kh-text-muted";

  element.append(announce, list, message);
  // Pressing anywhere on the list must not take the caret from the document.
  element.addEventListener("mousedown", (event) => {
    if (event.button === 0) event.preventDefault();
  });
  document.body.appendChild(element);

  const optionId = (index: number) => `${id}-option-${index}`;
  let shown = false;
  let announced = "";

  return {
    element,
    listboxId: id,
    optionId,
    render(view, onPick) {
      list.replaceChildren();
      list.hidden = view.suggestions.length === 0;
      view.suggestions.forEach((suggestion, index) => {
        const row = document.createElement("li");
        row.id = optionId(index);
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(index === view.active));
        row.className = `${ROW} ${index === view.active ? ROW_ACTIVE : ROW_IDLE}`;
        const title = document.createElement("span");
        title.className = `min-w-0 flex-1 truncate text-body font-medium ${index === view.active ? "text-kh-selected-text" : "text-kh-text"}`;
        title.textContent = suggestion.target.title;
        const source = document.createElement("span");
        source.className = "max-w-[40%] shrink-0 truncate text-caption text-kh-text-muted";
        source.textContent = suggestion.target.sourceName;
        row.append(title, source);
        // `mousedown`, not `click`: it is what arrives before the editor could lose its selection
        // (the list's own `mousedown`, above, is what keeps it).
        row.addEventListener("mousedown", (event) => {
          if (event.button === 0) onPick(index);
        });
        list.appendChild(row);
      });
      const text = view.message ? messageText(view.message) : "";
      message.textContent = text;
      message.hidden = text === "";
      const count = view.suggestions.length;
      const said = view.message ? text : `${count} ${count === 1 ? "suggestion" : "suggestions"}.`;
      if (said !== announced) {
        announced = said;
        announce.textContent = said;
      }
      // Keep the chosen row in view when the arrow keys move past the edge of the scrolling list.
      list.children[view.active]?.scrollIntoView?.({ block: "nearest" });
    },
    show(at) {
      shown = true;
      element.dataset.show = "true";
      const margin = 8;
      const gap = 4;
      // Measured at its natural height first: the list is capped by its class, and by the room there is below.
      list.style.maxHeight = "";
      const width = element.offsetWidth || 320;
      const natural = element.offsetHeight;
      const chrome = natural - list.offsetHeight;
      const roomBelow = window.innerHeight - at.bottom - margin - gap;
      const roomAbove = at.top - margin - gap;
      // Under the line, unless it does not fit there and there is more room above it.
      const above = natural > roomBelow && roomAbove > roomBelow;
      const room = above ? roomAbove : roomBelow;
      // Short of room on both sides, the list scrolls rather than covering the line it belongs to.
      if (natural > room) list.style.maxHeight = `${Math.max(48, room - chrome)}px`;
      const height = element.offsetHeight;
      const left = Math.min(Math.max(margin, at.left), Math.max(margin, window.innerWidth - width - margin));
      element.style.left = `${left}px`;
      element.style.top = `${Math.max(margin, above ? at.top - gap - height : at.bottom + gap)}px`;
    },
    hide() {
      shown = false;
      element.dataset.show = "false";
      // Emptied, so that reopening with the same count is said again rather than skipped as unchanged.
      announced = "";
      announce.textContent = "";
    },
    visible: () => shown,
    destroy() {
      element.remove();
    },
  };
}
