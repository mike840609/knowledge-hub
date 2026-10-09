"use client";

import { AlertDialog } from "@base-ui-components/react/alert-dialog";
import type { ReactNode } from "react";
import { buttonClasses } from "@/components/ui/button";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";

/**
 * A question that has to be answered before anything happens, for the one
 * case the contract keeps a confirmation for: the consequence is real and
 * there is no undo (§15).
 *
 * It replaces `window.confirm`, which was the only native dialog left. The
 * native one cannot be themed, takes the whole page's JavaScript thread with
 * it, and reads differently in every browser. This one is the modal surface
 * every other dialog here is: `xl` radius, `modal` elevation, the same
 * enter and leave.
 *
 * The safe answer is the one focus lands on. Cancel is first in the DOM and
 * takes initial focus, so Enter on an opened dialog never confirms by reflex.
 * Escape and a click on the backdrop both mean "no".
 *
 * Render it outside any `<form>` whose keys it should not inherit: React
 * events bubble through a portal to the component that rendered it.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  onConfirm: () => void;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className={dialogBackdropClasses()} />
        <AlertDialog.Popup className={dialogPopupClasses("w-[min(26rem,92vw)]")}>
          <AlertDialog.Title className="text-title font-semibold text-kh-text">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-body text-kh-text-muted">{description}</AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Close className={buttonClasses({ variant: "ghost" })}>{cancelLabel}</AlertDialog.Close>
            <button
              type="button"
              className={buttonClasses({ variant: tone })}
              onClick={() => {
                onOpenChange(false);
                onConfirm();
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
