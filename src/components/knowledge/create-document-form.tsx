"use client";

import { useActionState } from "react";
import { createDocumentAction, type CreateDocumentActionState } from "@/app/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: CreateDocumentActionState = { error: null };

export type FolderOption = { id: string; label: string };

export function CreateDocumentForm({ sourceId, sourceName, folders }: { sourceId: string; sourceName: string; folders: FolderOption[] }) {
  const [state, formAction, pending] = useActionState(createDocumentAction, initialState);
  const fieldPrefix = `create-${sourceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <form action={formAction} aria-label={`Create a document in ${sourceName}`} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <input type="hidden" name="sourceId" value={sourceId} />
      <p className="text-sm text-slate-600">Source: <span className="font-medium text-ink">{sourceName}</span></p>
      <div>
        <Label htmlFor={`${fieldPrefix}-parent`}>Parent folder</Label>
        <select id={`${fieldPrefix}-parent`} name="parentId" required={folders.length > 0} defaultValue={folders[0]?.id ?? ""} className="min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent">
          {folders.length === 0 ? <option value="">No active folder available</option> : folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.label}</option>)}
        </select>
      </div>
      <div><Label htmlFor={`${fieldPrefix}-title`}>Title</Label><Input id={`${fieldPrefix}-title`} name="title" required placeholder="A useful team note" /></div>
      <div><Label htmlFor={`${fieldPrefix}-markdown`}>Markdown</Label><Textarea id={`${fieldPrefix}-markdown`} name="markdown" required placeholder="Write the first version of this document." /></div>
      {state.error ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create document"}</Button>
    </form>
  );
}
