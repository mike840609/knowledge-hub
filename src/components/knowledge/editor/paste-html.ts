import { Plugin } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

/**
 * Clipboard HTML other apps write, made into the shapes the schema already parses. Scoped to the
 * editor's paste; the Markdown reader is not involved and nothing here emits markup — the result is
 * only ever handed to ProseMirror's own parser, which keeps what the schema knows.
 *
 * - `<s>` and `<strike>` become `<del>` (strikethrough).
 * - A `<li>` led by a checkbox `<input>` becomes a task item carrying `checked`; the input is dropped.
 * - A `<table>` with no `<thead>` and no `<th>` takes its first row as the header row.
 */
const INTERESTING = /<(s|strike|input|table)[\s>/]/i;

export function transformPastedHtml(html: string): string {
  if (!INTERESTING.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");

  for (const old of Array.from(doc.querySelectorAll("s, strike"))) {
    const del = doc.createElement("del");
    while (old.firstChild) del.appendChild(old.firstChild);
    old.replaceWith(del);
  }

  for (const item of Array.from(doc.querySelectorAll("li"))) {
    const box = firstCheckbox(item);
    if (!box) continue;
    item.setAttribute("data-item-type", "task");
    item.setAttribute("data-checked", box.hasAttribute("checked") ? "true" : "false");
    box.remove();
  }

  for (const table of Array.from(doc.querySelectorAll("table"))) {
    if (table.querySelector("thead, th")) continue;
    const row = table.querySelector("tr");
    if (!row) continue;
    for (const cell of Array.from(row.children)) {
      if (cell.tagName !== "TD") continue;
      const header = doc.createElement("th");
      for (const { name, value } of Array.from(cell.attributes)) header.setAttribute(name, value);
      while (cell.firstChild) header.appendChild(cell.firstChild);
      cell.replaceWith(header);
    }
  }

  return doc.body.innerHTML;
}

/** The checkbox an item starts with: its first child, or the first child of a leading `<p>` / `<label>`. */
function firstCheckbox(item: Element): HTMLInputElement | null {
  let node: Element | null = firstMeaningful(item);
  if (node && (node.tagName === "P" || node.tagName === "LABEL")) node = firstMeaningful(node);
  return node instanceof HTMLInputElement && node.type === "checkbox" ? node : null;
}

function firstMeaningful(parent: Element): Element | null {
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType === 3 && !child.textContent?.trim()) continue;
    return child.nodeType === 1 ? (child as Element) : null;
  }
  return null;
}

export const pasteHtml = $prose(() => new Plugin({ props: { transformPastedHTML: transformPastedHtml } }));
