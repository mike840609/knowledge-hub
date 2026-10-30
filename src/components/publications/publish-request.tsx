"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicationOptions } from "@/modules/sources/application/publication-service";
import { PublishDialog, type PublishOriginOption } from "./publish-dialog";
import { JoinDialog, type JoinFolderOption } from "./join-dialog";

export const PUBLISH_REQUEST_EVENT = "kh:request-publish";

/**
 * Ask the publish dialog to open for one of the caller's own origins. Every
 * surface asks the same way, as the share dialog is asked for, so the event's
 * shape lives in one place.
 */
export function requestPublish(origin: PublishOriginOption): void {
  window.dispatchEvent(new CustomEvent(PUBLISH_REQUEST_EVENT, { detail: origin }));
}

/**
 * The host mounts once per knowledge layout. It reads the teams and folders
 * the caller may use from the server's own options route — never from a page
 * prop — and opens a join dialog in place of the publish dialog when the
 * preview suggests joining an existing publication.
 */
export function PublishDialogHost() {
  const router = useRouter();
  const [origin, setOrigin] = useState<PublishOriginOption>();
  const [options, setOptions] = useState<PublicationOptions>();
  const [join, setJoin] = useState<{ publicationId: string; name: string }>();

  const loadOptions = useCallback(async () => {
    try {
      const response = await fetch("/api/publications/options", { cache: "no-store" });
      if (!response.ok) return;
      setOptions(await response.json() as PublicationOptions);
    } catch {
      // The dialog opens with an empty team list; the submit route still decides.
    }
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<PublishOriginOption>).detail;
      if (!detail) return;
      setOrigin(detail);
      setJoin(undefined);
      void loadOptions();
    };
    window.addEventListener(PUBLISH_REQUEST_EVENT, open);
    return () => window.removeEventListener(PUBLISH_REQUEST_EVENT, open);
  }, [loadOptions]);

  const folders: readonly JoinFolderOption[] | undefined = options?.folders;
  return (
    <>
      {origin ? (
        <PublishDialog
          open={!join}
          onOpenChange={(next) => { if (!next) setOrigin(undefined); }}
          origin={origin}
          teams={options?.teams ?? []}
          onPublished={() => router.refresh()}
          onOfferJoin={(publication) => setJoin(publication)}
        />
      ) : null}
      {join ? (
        <JoinDialog
          open
          onOpenChange={(next) => { if (!next) { setJoin(undefined); setOrigin(undefined); } }}
          publication={join}
          folders={folders}
          onJoined={() => { setJoin(undefined); setOrigin(undefined); router.refresh(); }}
        />
      ) : null}
    </>
  );
}
