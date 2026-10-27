"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer } from "@/components/ui/drawer";
import { buttonClasses } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  GovernanceError,
  governanceFailure,
  governanceRequest,
  type GovernanceFailure,
} from "@/components/workspaces/governance-error";
import { MarkdownRenderer } from "./markdown-renderer";
import { leavesPeek, type PeekRequest } from "./peek-request";

type PeekResult = {
  title: string;
  markdown: string;
  ownership: "HUB_MANAGED" | "SOURCE_MANAGED";
  workspaceId: string;
  sourceId: string;
  documentId: string;
};

function readIncludeArchivedSuffix(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("includeArchived") === "true"
    ? "?includeArchived=true"
    : "";
}

/**
 * The narrow-screen side peek, mounted by the knowledge layout only while a
 * peek is open on a viewport under lg. Wide screens show the PeekPane split
 * instead. Any surface — search results, graph, backlinks — opens a read-only
 * peek through requestPeek(), which the layout answers. v1 is read plus an
 * Edit link only; the Drawer never embeds the editor.
 */
export function PeekDialog({
  request,
  onOpenChange,
}: {
  request: PeekRequest | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [peek, setPeek] = useState<PeekResult | null>(null);
  const [error, setError] = useState<GovernanceFailure | null>(null);
  // A response for any other document — the drawer was closed and reopened
  // elsewhere before it arrived — is dropped rather than shown.
  const current = useRef<string | null>(null);

  const load = useCallback(async (id: string) => {
    current.current = id;
    setPeek(null);
    setError(null);
    try {
      const result = await governanceRequest<PeekResult>(`/api/documents/${id}/peek`);
      if (current.current === id) setPeek(result);
    } catch (failure) {
      if (current.current === id) setError(governanceFailure(failure));
    }
  }, []);

  useEffect(() => {
    if (request) void load(request.documentId);
    else current.current = null;
  }, [request, load]);

  const [archivedSuffix, setArchivedSuffix] = useState("");
  useEffect(() => {
    if (request) setArchivedSuffix(readIncludeArchivedSuffix());
  }, [request]);

  const canonicalHref = peek
    ? `/w/${peek.workspaceId}/knowledge/${peek.sourceId}/${peek.documentId}${archivedSuffix}`
    : null;
  const loading = request !== null && peek === null && error === null;

  return (
    <Drawer
      open={request !== null}
      onOpenChange={onOpenChange}
      title={peek?.title ?? "Preview"}
      description={
        peek ? (
          <span className="text-caption text-kh-text-muted">
            {peek.ownership === "HUB_MANAGED"
              ? "Editable in Knowledge Hub."
              : "Synced from a folder; edit the original files."}
          </span>
        ) : undefined
      }
    >
      {loading ? (
        <div className="space-y-3 py-2">
          <p role="status" className="sr-only">
            Loading preview
          </p>
          <div aria-hidden="true" className="space-y-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="py-2">
          {error.code === "UNAUTHENTICATED" ? (
            <p className="text-body text-kh-text">
              Sign in to preview this document.
            </p>
          ) : null}
          <GovernanceError error={error} />
        </div>
      ) : null}
      {peek ? (
        <>
          <MarkdownRenderer markdown={peek.markdown} />
          {canonicalHref ? (
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-kh-border pt-3">
              <Link
                href={canonicalHref}
                onClick={(event) => { if (leavesPeek(event)) onOpenChange(false); }}
                className={buttonClasses({ variant: "secondary", size: "md" })}
              >
                Open as full page
              </Link>
              {peek.ownership === "HUB_MANAGED" ? (
                <Link
                  href={`${canonicalHref.split("?")[0]}/edit`}
                  onClick={(event) => { if (leavesPeek(event)) onOpenChange(false); }}
                  className={buttonClasses({ variant: "primary", size: "md" })}
                >
                  Edit
                </Link>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </Drawer>
  );
}
