"use client";

import { Dialog } from "@base-ui-components/react/dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  label = "Close panel",
  modal = true,
  surfaceClassName = "bg-kh-bg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  label?: string;
  modal?: boolean;
  surfaceClassName?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <Dialog.Portal>
        {modal ? <Dialog.Backdrop className="fixed inset-0 z-40 bg-kh-overlay" /> : null}
        <Dialog.Popup className={`fixed inset-y-0 right-0 z-50 flex w-80 max-w-[85vw] flex-col border-l border-kh-border shadow-modal focus:outline-none ${surfaceClassName}`}>
          <div className="flex items-start justify-between gap-2 border-b border-kh-border px-4 py-3">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-body font-semibold text-kh-text">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-caption text-kh-text-muted">
                  {description}
                </Dialog.Description>
              ) : null}
            </div>
            <Dialog.Close
              aria-label={label}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
