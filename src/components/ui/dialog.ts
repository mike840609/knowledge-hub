/**
 * The modal surface, shared by every dialog and the command palette: `xl`
 * radius, `modal` elevation, one enter and leave (contract §5, §6, §9).
 *
 * It lives here because it was spelled out in six places, the way the button
 * class string once was in twenty-one. Like `tab.ts` and `field.ts` it shares
 * the look and not the element: `Dialog` and `AlertDialog` are different Base
 * UI roots, and the palette is placed and padded differently.
 */
const BACKDROP =
  "fixed inset-0 bg-kh-overlay transition-opacity duration-120 ease-out data-[starting-style]:opacity-0 data-[ending-style]:opacity-0";

export const dialogSurfaceClasses =
  "fixed left-1/2 -translate-x-1/2 rounded-xl border border-kh-border bg-kh-bg shadow-modal outline-none " +
  "transition-[opacity,transform] duration-120 ease-out " +
  "data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 " +
  "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0";

/** The palette sits above the other overlays, so it names its own layer. */
export function dialogBackdropClasses(layer = "z-40"): string {
  return `${BACKDROP} ${layer}`;
}

/** A centred dialog. The caller gives the width, which is geometry and its own. */
export function dialogPopupClasses(className = ""): string {
  return `${dialogSurfaceClasses} top-1/2 z-50 -translate-y-1/2 p-6 ${className}`;
}
