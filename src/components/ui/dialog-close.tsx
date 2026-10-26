"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import { buttonClasses } from "./button";

/**
 * The × in a dialog's corner, level with its title: a way out a pointer finds where it looks first, beside
 * Escape and the footer's Cancel. The 24px box sits 16px in, so the glyph inside it, not the box, lines up
 * with the 24px padding the fields and footer buttons end on. It is placed last in the popup so the library's first focus still lands on
 * the dialog's first field, not on the way out. A confirmation (`AlertDialog`) has none: it asks a question,
 * and its two buttons are the answers.
 */
export function DialogCloseButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <Dialog.Close
      aria-label="Close dialog"
      disabled={disabled}
      className={buttonClasses({ variant: "ghost", icon: true, size: "sm", className: "absolute right-4 top-6" })}
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </Dialog.Close>
  );
}
