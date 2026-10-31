"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui-components/react/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectMenu } from "@/components/ui/select-menu";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { PUBLICATION_COPY } from "./publication-entry-meta";

export type PublishOriginOption =
  | { kind: "FOLDER"; folderNodeId: string; label: string }
  | { kind: "DOCUMENT"; documentId: string; label: string };

export type PublishTeamOption = { id: string; name: string };

type Preview = {
  nameTaken: boolean;
  refusedOriginals: { documentId: string; publicationName: string }[];
  joinSuggestion: { publicationId: string; name: string; overlap: number } | null;
  lowOverlapWarning: boolean;
};

type InlineError = { field: "name" | "claim" | "general"; message: string };

function originBody(origin: PublishOriginOption) {
  return origin.kind === "FOLDER"
    ? { kind: "FOLDER" as const, folderNodeId: origin.folderNodeId }
    : { kind: "DOCUMENT" as const, documentId: origin.documentId };
}

async function errorBody(response: Response): Promise<{ code?: string; message?: string; details?: Record<string, unknown> } | null> {
  try {
    const body = await response.json() as { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
    return body.error ?? null;
  } catch {
    return null;
  }
}

/**
 * 「發佈到團隊」: name a publication, choose one team, preview the outcome,
 * then publish. The dialog stays open on a name or claim error so the reader
 * can fix the name or choose another origin; a submit in flight cannot be
 * sent twice.
 *
 * A strong path overlap against an existing folder publication offers
 * joining it instead. That is guidance only: a new publication is never
 * blocked, because the Hub cannot know two folders are copies of one repo.
 */
export function PublishDialog({
  open,
  onOpenChange,
  origin,
  teams,
  onPublished,
  onOfferJoin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  origin: PublishOriginOption;
  /** Only teams where the caller holds `source.manage`, decided by the server. */
  teams: readonly PublishTeamOption[];
  onPublished?: (result: { publicationId: string }) => void;
  onOfferJoin?: (publication: { publicationId: string; name: string }) => void;
}) {
  const [name, setName] = useState(origin.label);
  const [teamId, setTeamId] = useState(teams.length === 1 ? teams[0].id : "");
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<InlineError>();
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const submitting = useRef(false);
  const previewVersion = useRef(0);
  const teamsKey = teams.map((team) => team.id).join(",");
  const originKey = origin.kind === "FOLDER" ? origin.folderNodeId : origin.documentId;

  useEffect(() => {
    if (!open) return;
    setName(origin.label);
    setTeamId(teams.length === 1 ? teams[0].id : "");
    setPreview(undefined);
    setError(undefined);
    setBusy(false);
    submitting.current = false;
    // Reset only when the dialog opens or its subject changes, not on every render.
  }, [open, originKey, teamsKey]);

  const runPreview = async (nextName = name, nextTeamId = teamId) => {
    if (!nextName.trim() || !nextTeamId) return;
    const version = ++previewVersion.current;
    setPreviewing(true);
    try {
      const response = await fetch("/api/publications/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamWorkspaceId: nextTeamId, name: nextName, origin: originBody(origin) }),
      });
      if (!response.ok) return;
      const body = await response.json() as Preview;
      if (previewVersion.current === version) setPreview(body);
    } catch {
      // A preview is advice; the submit below still decides.
    } finally {
      if (previewVersion.current === version) setPreviewing(false);
    }
  };

  useEffect(() => {
    if (!open || !teamId) return;
    void runPreview();
    // Preview is keyed by the chosen team; the name is previewed on blur.
  }, [open, teamId]);

  async function publish() {
    if (busy || submitting.current || !teamId || !name.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/publications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamWorkspaceId: teamId, name, origin: originBody(origin) }),
      });
      if (!response.ok) {
        const failure = await errorBody(response);
        if (failure?.code === "PUBLICATION_NAME_TAKEN") {
          setError({ field: "name", message: failure.message ?? "已有同名發佈，請取一個能說明內容的名字" });
        } else if (failure?.code === "PUBLICATION_ORIGINAL_TAKEN") {
          const publicationName = typeof failure.details?.publicationName === "string"
            ? failure.details.publicationName
            : undefined;
          setError({
            field: "claim",
            message: publicationName
              ? `這份原稿已在「${publicationName}」發佈。`
              : "這份原稿已在這個團隊發佈。",
          });
        } else {
          setError({ field: "general", message: failure?.message ?? "發佈失敗，請再試一次。" });
        }
        return;
      }
      const body = await response.json() as { publicationId: string };
      onPublished?.(body);
      onOpenChange(false);
    } catch {
      setError({ field: "general", message: "發佈失敗，請再試一次。" });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const refusedNames = [...new Set(preview?.refusedOriginals.map((original) => original.publicationName) ?? [])];

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <Dialog.Portal>
        <Dialog.Backdrop className={dialogBackdropClasses()} />
        <Dialog.Popup className={dialogPopupClasses("w-[min(32rem,92vw)]")}>
          <Dialog.Title className="text-title font-semibold">發佈到團隊</Dialog.Title>
          <Dialog.Description className="mt-1 text-body text-kh-text-muted">
            團隊中的每份文件都只有一位維護者：你。之後的更新會從你的原稿帶進團隊。
          </Dialog.Description>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => { event.preventDefault(); void publish(); }}
          >
            <Label>
              團隊
              <SelectMenu
                aria-label="團隊"
                value={teamId}
                disabled={busy}
                onValueChange={setTeamId}
                options={[
                  { value: "", label: teams.length === 0 ? "沒有可發佈的團隊" : "選擇團隊" },
                  ...teams.map((team) => ({ value: team.id, label: team.name })),
                ]}
              />
            </Label>
            <Label>
              發佈名稱
              <Input
                autoFocus
                value={name}
                maxLength={200}
                required
                disabled={busy}
                aria-invalid={error?.field === "name"}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => void runPreview()}
              />
            </Label>
            {previewing ? <p role="status" className="text-caption text-kh-text-muted">檢查中…</p> : null}
            {preview?.nameTaken ? (
              <p role="alert" data-publication-error="name" className="text-body text-kh-danger">
                已有同名發佈，請取一個能說明內容的名字。
              </p>
            ) : null}
            {refusedNames.length > 0 ? (
              <p role="alert" data-publication-error="claim" className="text-body text-kh-danger">
                {refusedNames.map((publication) => `「${publication}」`).join("、")}已發佈部分原稿；請改為加入，或移除重疊的檔案。
              </p>
            ) : null}
            {preview?.joinSuggestion ? (
              <div data-publication-suggestion="" className="flex flex-wrap items-center gap-2 border-t border-kh-border pt-3">
                <p className="min-w-0 flex-1 text-body text-kh-text-muted">
                  這個資料夾與既有發佈重疊很多，可能來自同一個 repo。
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    onOfferJoin?.({
                      publicationId: preview.joinSuggestion!.publicationId,
                      name: preview.joinSuggestion!.name,
                    });
                    onOpenChange(false);
                  }}
                >
                  {PUBLICATION_COPY.joinInstead(preview.joinSuggestion.name)}
                </Button>
              </div>
            ) : null}
            {preview?.lowOverlapWarning ? (
              <p role="status" data-publication-low-overlap="" className="text-body text-kh-warning">
                {PUBLICATION_COPY.lowOverlap}
              </p>
            ) : null}
            {error && error.field !== "name" && error.field !== "claim" ? (
              <p role="alert" className="text-body text-kh-danger">{error.message}</p>
            ) : null}
            {error && (error.field === "name" || error.field === "claim") ? (
              <p role="alert" className="text-body text-kh-danger">{error.message}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || !teamId || !name.trim()}
              >
                {busy ? "發佈中…" : PUBLICATION_COPY.publish}
              </Button>
            </div>
          </form>
          <DialogCloseButton disabled={busy} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
