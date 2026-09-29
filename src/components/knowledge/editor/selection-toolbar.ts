import { commandsCtx } from "@milkdown/kit/core";
import type { Ctx, MilkdownPlugin } from "@milkdown/kit/ctx";
import { TooltipProvider, tooltipFactory } from "@milkdown/kit/plugin/tooltip";
import {
  liftListItemCommand,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  turnIntoTextCommand,
  wrapInBulletListCommand,
  wrapInHeadingCommand,
  wrapInOrderedListCommand,
} from "@milkdown/kit/preset/commonmark";
import type { EditorView } from "@milkdown/kit/prose/view";
import { buttonClasses } from "@/components/ui/button";
import { fieldClasses } from "@/components/ui/field";

const tooltip = tooltipFactory("khSelectionToolbar");

function markActive(view: EditorView, name: string): boolean {
  const type = view.state.schema.marks[name];
  if (!type) return false;
  const { from, to, empty, $from } = view.state.selection;
  return empty ? Boolean(type.isInSet(view.state.storedMarks ?? $from.marks())) : view.state.doc.rangeHasMark(from, to, type);
}

function headingLevel(view: EditorView): number {
  const { parent } = view.state.selection.$from;
  return parent.type.name === "heading" ? Number(parent.attrs.level) : 0;
}

type ListName = "bullet_list" | "ordered_list";

/** The list the caret is directly in (the innermost one), if any. */
function currentList(view: EditorView): ListName | null {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const name = $from.node(depth).type.name;
    if (name === "bullet_list" || name === "ordered_list") return name;
  }
  return null;
}

// A pressed toggle reads as selected, as the composer's own Markdown toggle does.
const PRESSED = "aria-pressed:bg-kh-bg-selected aria-pressed:text-kh-text";
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** `example.com` is a web address; a path, an anchor or anything with a scheme (`mailto:`) is left as typed. */
function withScheme(value: string): string {
  if (!value || HAS_SCHEME.test(value) || value.startsWith("/") || value.startsWith("#")) return value;
  return `https://${value}`;
}

type Item = {
  label: string;
  text: string;
  className?: string;
  active: (view: EditorView) => boolean;
  disabled?: (view: EditorView) => boolean;
  run: (ctx: Ctx, view: EditorView, openLink: () => void) => void;
};

const items: Item[] = [
  { label: "Bold", text: "B", className: "font-bold", active: (view) => markActive(view, "strong"), run: (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key) },
  { label: "Italic", text: "I", className: "italic", active: (view) => markActive(view, "emphasis"), run: (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key) },
  {
    label: "Link",
    text: "Link",
    active: (view) => markActive(view, "link"),
    run: (ctx, view, openLink) => (markActive(view, "link") ? ctx.get(commandsCtx).call(toggleLinkCommand.key) : openLink()),
  },
  ...[1, 2].map<Item>((level) => ({
    label: `Heading ${level}`,
    text: `H${level}`,
    active: (view) => headingLevel(view) === level,
    run: (ctx, view) => {
      const commands = ctx.get(commandsCtx);
      if (headingLevel(view) === level) commands.call(turnIntoTextCommand.key);
      else commands.call(wrapInHeadingCommand.key, level);
    },
  })),
  // Inside a list, the other type's button is disabled: wrapping would put a list first in a
  // list item, which the schema refuses, so it could only ever do nothing.
  {
    label: "Bulleted list",
    text: "•",
    active: (view) => currentList(view) === "bullet_list",
    disabled: (view) => currentList(view) === "ordered_list",
    run: (ctx, view) => ctx.get(commandsCtx).call(currentList(view) === "bullet_list" ? liftListItemCommand.key : wrapInBulletListCommand.key),
  },
  {
    label: "Numbered list",
    text: "1.",
    active: (view) => currentList(view) === "ordered_list",
    disabled: (view) => currentList(view) === "bullet_list",
    run: (ctx, view) => ctx.get(commandsCtx).call(currentList(view) === "ordered_list" ? liftListItemCommand.key : wrapInOrderedListCommand.key),
  },
];

/**
 * The toolbar that floats over a text selection (composer spec §11.4). Built
 * from the DOM because it lives inside a ProseMirror plugin, not React.
 *
 * Every button is `type="button"`: the editor sits inside the composer's
 * `<form>`, where the default type submits — that is, saves. `mousedown` is
 * cancelled on them so pressing one does not take the selection with it.
 */
export function selectionToolbar(): { plugins: MilkdownPlugin[]; configure: (ctx: Ctx) => void } {
  return {
    plugins: [tooltip].flat() as MilkdownPlugin[],
    configure: (ctx) => {
      ctx.set(tooltip.key, {
        view: (editorView) => {
          const element = document.createElement("div");
          element.className = "kh-selection-toolbar";
          element.setAttribute("role", "toolbar");
          element.setAttribute("aria-label", "Formatting");

          // One of the two rows is shown. Their whole class list is swapped rather than
          // toggling `hidden`, which a `flex` on the same element would override.
          const buttons = document.createElement("div");
          const linkRow = document.createElement("div");
          let linkMode = false;
          function setLinkMode(on: boolean) {
            linkMode = on;
            buttons.className = on ? "hidden" : "flex items-center gap-0.5";
            linkRow.className = on ? "flex items-center gap-1" : "hidden";
          }
          setLinkMode(false);
          element.append(buttons, linkRow);

          const pressers = items.map((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = buttonClasses({ variant: "ghost", size: "sm", className: `${PRESSED} ${item.className ?? ""}` });
            button.textContent = item.text;
            button.title = item.label;
            button.setAttribute("aria-label", item.label);
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              if (!editorView.editable || button.disabled) return;
              item.run(ctx, editorView, openLink);
              if (!linkMode) editorView.focus();
            });
            buttons.appendChild(button);
            return { item, button };
          });

          const input = document.createElement("input");
          // Not `type="url"`: inside the composer's validating form that would block Save on half-typed text.
          input.type = "text";
          input.setAttribute("inputmode", "url");
          input.setAttribute("autocomplete", "off");
          input.placeholder = "https://";
          input.setAttribute("aria-label", "Link address");
          input.className = fieldClasses({ size: "sm", className: "w-56" });
          linkRow.appendChild(input);
          // Pressing the toolbar's padding must not take focus (and with it the toolbar) from the editor either.
          element.addEventListener("mousedown", (event) => {
            if (event.target !== input) event.preventDefault();
          });

          function showButtons() {
            setLinkMode(false);
            input.value = "";
          }
          function openLink() {
            setLinkMode(true);
            input.focus();
          }
          // Enter and Esc stop here: a bare Enter would submit the composer's form, and Esc would leave
          // the page. Every other key still bubbles, so ⌘K reaches the global search.
          input.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== "Escape") return;
            event.stopPropagation();
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Escape") {
              event.preventDefault();
              showButtons();
              editorView.focus();
            } else if (event.key === "Enter") {
              event.preventDefault();
              const href = withScheme(input.value.trim());
              showButtons();
              editorView.focus();
              if (href) ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
            }
          });

          const provider = new TooltipProvider({ content: element, offset: 8 });
          provider.onHide = showButtons;
          // The provider re-evaluates only on ProseMirror updates, and neither a blur nor a focus
          // dispatches one. Focus moving into the toolbar itself (the link box) keeps it; focus
          // coming back (from the Markdown view, the title field) re-evaluates, so an unchanged
          // selection gets its toolbar back.
          function hideOnBlur(event: FocusEvent) {
            if (event.relatedTarget instanceof Node && element.contains(event.relatedTarget)) return;
            provider.hide();
          }
          // The link box, from its side: leaving it for the page closes it; going back into the
          // editor (Enter, Esc) or elsewhere in the toolbar does not.
          function hideOnLinkBoxBlur(event: FocusEvent) {
            const next = event.relatedTarget;
            if (next instanceof Node && (element.contains(next) || editorView.dom.contains(next))) return;
            provider.hide();
          }
          const showOnFocus = () => provider.update(editorView);
          editorView.dom.addEventListener("blur", hideOnBlur);
          editorView.dom.addEventListener("focus", showOnFocus);
          input.addEventListener("blur", hideOnLinkBoxBlur);

          return {
            update: (view, previous) => {
              for (const { item, button } of pressers) {
                button.setAttribute("aria-pressed", String(item.active(view)));
                button.disabled = item.disabled?.(view) ?? false;
              }
              provider.update(view, previous);
            },
            destroy: () => {
              editorView.dom.removeEventListener("blur", hideOnBlur);
              editorView.dom.removeEventListener("focus", showOnFocus);
              provider.destroy();
              element.remove();
            },
          };
        },
      });
    },
  };
}
