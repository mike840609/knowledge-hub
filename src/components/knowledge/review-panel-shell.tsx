"use client";
import { useEffect, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";

export function ReviewPanelShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { const show = () => { if (window.matchMedia("(max-width: 1199px)").matches) setOpen(true); }; const hide = () => setOpen(false); document.addEventListener("review-focus-thread",show); document.addEventListener("review-focus-passage",hide); return () => { document.removeEventListener("review-focus-thread",show); document.removeEventListener("review-focus-passage",hide); }; }, []);
  return <>
    <div className="hidden min-[1200px]:block">{children}</div>
    <div className="kh-reading-column flex justify-end py-2 min-[1200px]:hidden"><Button type="button" variant="secondary" onPointerDown={event => event.preventDefault()} onClick={() => setOpen(true)}>Open discussions</Button></div>
    <Drawer open={open} onOpenChange={setOpen} title="Comments" label="Close discussions">{children}</Drawer>
  </>;
}
