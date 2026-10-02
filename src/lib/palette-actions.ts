import type { Action } from "@/components/actions/action-registry";

/** Empty palettes serve the current task; typed searches keep all matches. */
export function prioritizePaletteActions(actions: readonly Action[], pathname: string, query: string): readonly Action[] {
  if (query.trim()) return actions;
  const priority = { document: 0, folder: 0, create: 1, navigate: 2 };
  return actions.filter(action => {
    if (action.group !== "navigate" || action.effect.kind !== "navigate") return true;
    const href = action.effect.href.split("?")[0];
    return pathname !== href && !pathname.startsWith(`${href}/`);
  }).slice().sort((a, b) => priority[a.group] - priority[b.group]);
}
