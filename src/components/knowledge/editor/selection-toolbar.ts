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

function inList(view: EditorView, name: "bullet_list" | "ordered_list"): boolean {
  const { $from } = view.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) if ($from.node(depth).type.name === name) return true;
  return false;
}

type Item = {
  label: string;
  text: string;
  className?: string;
  active: (view: EditorView) => boolean;
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
  {
    label: "Bulleted list",
    text: "•",
    active: (view) => inList(view, "bullet_list"),
    run: (ctx, view) => ctx.get(commandsCtx).call(inList(view, "bullet_list") ? liftListItemCommand.key : wrapInBulletListCommand.key),
  },
  {
    label: "Numbered list",
    text: "1.",
    active: (view) => inList(view, "ordered_list"),
    run: (ctx, view) => ctx.get(commandsCtx).call(inList(view, "ordered_list") ? liftListItemCommand.key : wrapInOrderedListCommand.key),
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
            button.className = buttonClasses({ variant: "ghost", size: "sm", className: item.className ?? "" });
            button.textContent = item.text;
            button.title = item.label;
            button.setAttribute("aria-label", item.label);
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
              item.run(ctx, editorView, openLink);
              if (!linkMode) editorView.focus();
            });
            buttons.appendChild(button);
            return { item, button };
          });

          const input = document.createElement("input");
          input.type = "url";
          input.placeholder = "https://";
          input.setAttribute("aria-label", "Link address");
          input.className = fieldClasses({ size: "sm", className: "w-56" });
          linkRow.appendChild(input);

          function showButtons() {
            setLinkMode(false);
            input.value = "";
          }
          function openLink() {
            setLinkMode(true);
            input.focus();
          }
          // Stops here: a bare Enter would submit the composer's form, and Esc would leave the page.
          input.addEventListener("keydown", (event) => {
            event.stopPropagation();
            if (event.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              showButtons();
              editorView.focus();
            } else if (event.key === "Enter") {
              event.preventDefault();
              const href = input.value.trim();
              showButtons();
              editorView.focus();
              if (href) ctx.get(commandsCtx).call(toggleLinkCommand.key, { href });
            }
          });

          const provider = new TooltipProvider({ content: element, offset: 8 });
          provider.onHide = showButtons;

          return {
            update: (view, previous) => {
              for (const { item, button } of pressers) button.setAttribute("aria-pressed", String(item.active(view)));
              provider.update(view, previous);
            },
            destroy: () => {
              provider.destroy();
              element.remove();
            },
          };
        },
      });
    },
  };
}
