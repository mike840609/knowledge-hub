"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type BindingView = {
  bindingId: string;
  sourceName: string;
  label: string;
  status: "ACTIVE" | "REVOKED";
  hasActiveCredential: boolean;
  createdAt: string;
};

/** Held in component state only: a token never reaches persistent browser storage. */
type Issued = { bindingId: string; token: string };

async function send(path: string, method: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(payload?.error?.message ?? "The request failed.");
  return payload;
}

function Commands({ bindingId, token }: Issued) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const [copied, setCopied] = useState(false);
  const commands = [
    "# once per machine, from a Knowledge Hub checkout",
    "cd <hub-checkout>/tools/knowledge-hub && npm pack && npm install -g ./knowledge-hub-*.tgz",
    "knowledge-hub install-agent",
    "# once per project, in that project; paste the token at the hidden prompt",
    `knowledge-hub configure --hub-url ${origin} --binding-id ${bindingId}`,
  ].join("\n");
  return (
    <div className="space-y-3 rounded-md border border-kh-border p-4" role="status">
      <p className="text-body font-medium">Copy this token now. It is shown only once.</p>
      <div className="flex gap-2">
        <Input readOnly value={token} aria-label="Export token" className="font-mono" onFocus={(event) => event.currentTarget.select()} />
        <Button
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(token);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-md bg-kh-bg-subtle p-3 text-body-sm">{commands}</pre>
    </div>
  );
}

export function TaskExportSetup({ workspaceId, sources, bindings }: { workspaceId: string; sources: { id: string; name: string }[]; bindings: BindingView[] }) {
  const router = useRouter();
  const base = `/api/workspaces/${workspaceId}/task-export-bindings`;
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [revoking, setRevoking] = useState<BindingView | null>(null);

  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-panel space-y-6">
      {issued ? <Commands {...issued} /> : null}
      {error ? <p className="text-body text-kh-danger" role="alert">{error}</p> : null}
      {sources.length === 0 ? (
        <p className="text-body text-kh-text-muted">Sync a Wiki folder into My Space first; a binding links your project to one synced folder.</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const created = (await send(base, "POST", { sourceId, label })) as Issued;
              setIssued(created);
              setLabel("");
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="task-export-source">Wiki folder</Label>
            <Select id="task-export-source" value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="task-export-label">Label</Label>
            <Input id="task-export-label" value={label} maxLength={200} required placeholder="work laptop" onChange={(event) => setLabel(event.target.value)} />
          </div>
          <Button type="submit" disabled={busy}>Create binding</Button>
        </form>
      )}
      {bindings.length > 0 ? (
        <ul className="divide-y divide-kh-border rounded-md border border-kh-border">
          {bindings.map((binding) => (
            <li key={binding.bindingId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-body">{binding.label}</p>
                <p className="text-caption text-kh-text-muted">
                  {binding.sourceName} · {binding.status === "ACTIVE" ? "Active" : "Revoked"} · <span className="font-mono">{binding.bindingId}</span>
                </p>
              </div>
              {binding.status === "ACTIVE" ? (
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act(async () => {
                      const { token } = (await send(`${base}/${binding.bindingId}/credentials`, "POST")) as { token: string };
                      setIssued({ bindingId: binding.bindingId, token });
                    })}
                  >
                    Rotate token
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setRevoking(binding)}>Revoke</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => { if (!open) setRevoking(null); }}
        title="Revoke this binding?"
        description="Exports from projects using it stop at once. Task Results already saved stay in My Space."
        confirmLabel="Revoke"
        onConfirm={() => {
          const target = revoking;
          setRevoking(null);
          if (target) void act(async () => { await send(`${base}/${target.bindingId}`, "DELETE"); });
        }}
      />
    </div>
  );
}
