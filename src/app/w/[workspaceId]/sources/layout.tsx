import { ShareLinkDialogHost } from "@/components/knowledge/share-link-dialog";
import type { ReactNode } from "react";

export default function SourcesLayout({ children, modal }: { children: ReactNode; modal: ReactNode }) {
  return (
    <>
      {children}
      {modal}
      <ShareLinkDialogHost />
    </>
  );
}
