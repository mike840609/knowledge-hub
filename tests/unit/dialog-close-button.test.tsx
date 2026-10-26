// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Every centred dialog carries a × in its corner (design language §15). It must close the dialog, must not
 * take the first focus from the dialog's first field, must wait while the dialog is busy, and is absent from a
 * confirmation, whose buttons are its answers.
 */
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

function Example({ busy = false, onOpenChange }: { busy?: boolean; onOpenChange: (open: boolean) => void }) {
  const [open, setOpen] = useState(true);
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next && !busy) setOpen(false); }}>
      <Dialog.Portal>
        <Dialog.Popup>
          <Dialog.Title>Rename folder</Dialog.Title>
          <label>Name <input aria-label="Name" /></label>
          <button type="button">Save</button>
          <DialogCloseButton disabled={busy} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const closeButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]');
const dialog = () => document.querySelector('[role="dialog"]');

describe("DialogCloseButton", () => {
  it("closes the dialog it sits in", async () => {
    const onOpenChange = vi.fn();
    await act(async () => root.render(<Example onOpenChange={onOpenChange} />));
    await settle();
    expect(closeButton()).not.toBeNull();
    await act(async () => closeButton()!.click());
    await settle();
    expect(onOpenChange.mock.calls[0]?.[0]).toBe(false);
    expect(dialog()).toBeNull();
  });

  it("leaves the first focus on the dialog's first field", async () => {
    await act(async () => root.render(<Example onOpenChange={() => {}} />));
    await settle();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Name");
  });

  it("cannot close a dialog that is busy", async () => {
    const onOpenChange = vi.fn();
    await act(async () => root.render(<Example busy onOpenChange={onOpenChange} />));
    await settle();
    expect(closeButton()!.disabled || closeButton()!.getAttribute("aria-disabled") === "true").toBe(true);
    await act(async () => closeButton()!.click());
    await settle();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
  });

  it("is not offered on a confirmation", async () => {
    await act(async () => root.render(
      <ConfirmDialog open onOpenChange={() => {}} title="Revoke share link?" description="Anyone holding it loses access." confirmLabel="Confirm revoke" onConfirm={() => {}} />,
    ));
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(closeButton()).toBeNull();
  });
});

/** Every centred dialog in the app, found by the class helper they share, carries the × as its last child. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx$/.test(name) ? [path] : [];
  });
}

describe("every centred dialog", () => {
  const dialogs = sourceFiles(join(process.cwd(), "src"))
    .map((path) => ({ path, text: readFileSync(path, "utf8") }))
    .filter(({ text }) => /<Dialog\.Popup[^>]*dialogPopupClasses\(/.test(text))
    // The image viewer's toolbar ends in its own Close, beside the zoom controls it belongs with.
    .filter(({ path }) => !path.endsWith("markdown-image.tsx"));

  it("is found", () => {
    expect(dialogs.length).toBeGreaterThanOrEqual(6);
  });

  it.each(dialogs.map(({ path, text }) => [path.slice(process.cwd().length + 1), text]))("%s ends its popup with the ×", (_path, text) => {
    expect(text).toMatch(/<DialogCloseButton\b[^>]*\/>\s*<\/Dialog\.Popup>/);
  });
});
