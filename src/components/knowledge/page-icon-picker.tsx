"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Popover } from "@base-ui-components/react/popover";
import { ImagePlus } from "lucide-react";
import { PAGE_ICONS } from "@/lib/page-icon";
import { governanceRequest } from "@/components/workspaces/governance-error";
import { useToast } from "@/components/ui/toast";

/**
 * The page's icon, above its title. A curated palette rather than a full emoji
 * keyboard: the icon is a scanning aid in a dense tree, and a page that can
 * wear any glyph quickly becomes a second title.
 *
 * The icon belongs to the document, not the revision. Changing it is one small
 * authenticated write and never makes a new revision.
 */
export function PageIconPicker({
  documentId,
  icon,
  editable,
}: {
  documentId: string;
  icon: string | null;
  editable: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const [current, setCurrent] = useState(icon);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => setCurrent(icon), [icon]);

  async function save(next: string | null) {
    if (saving) return;
    const previous = current;
    setSaving(true);
    setCurrent(next);
    try {
      await governanceRequest(`/api/documents/${documentId}/icon`, "PUT", { icon: next });
      setOpen(false);
      router.refresh();
    } catch {
      setCurrent(previous);
      toast({ message: "The page icon could not be saved.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  if (!editable) {
    return current ? <span data-page-icon className="mt-2 block select-none text-display leading-8" aria-hidden="true">{current}</span> : null;
  }

  return (
    <div className="mt-2">
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger
          type="button"
          aria-label={current ? "Change page icon" : "Add page icon"}
          className="kh-focus-ring inline-flex h-10 min-w-10 items-center gap-1.5 rounded-md px-1 text-kh-text-muted transition-colors hover:bg-kh-bg-hover hover:text-kh-text aria-expanded:bg-kh-bg-hover aria-expanded:text-kh-text"
        >
          {current ? (
            <span data-page-icon className="select-none text-display leading-8" aria-hidden="true">{current}</span>
          ) : (
            <>
              <ImagePlus className="h-5 w-5" aria-hidden="true" />
              <span className="text-body-sm">Add icon</span>
            </>
          )}
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
            <Popover.Popup className="w-72 rounded-lg border border-kh-border bg-kh-bg p-2 shadow-popover outline-none">
              <Popover.Title className="px-1 pb-2 text-caption font-semibold text-kh-text-muted">Page icon</Popover.Title>
              <div role="group" aria-label="Page icons" className="grid grid-cols-8 gap-0.5">
                {PAGE_ICONS.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    aria-label={`Use ${choice}`}
                    aria-pressed={current === choice}
                    disabled={saving}
                    onClick={() => void save(choice)}
                    className="kh-focus-ring flex h-8 w-8 items-center justify-center rounded-md text-heading hover:bg-kh-bg-hover aria-pressed:bg-kh-bg-selected"
                  >
                    {choice}
                  </button>
                ))}
              </div>
              {current ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void save(null)}
                  className="kh-focus-ring mt-2 w-full rounded-md px-2 py-1.5 text-left text-body-sm text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text"
                >
                  Remove icon
                </button>
              ) : null}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
