"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CopyCodeButton } from "@/components/knowledge/copy-code-button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Status } from "@/components/ui/status";
import { Timestamp } from "@/components/ui/timestamp";

type BindingView = {
  bindingId: string;
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
  const local = /^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin) ? " --allow-insecure-localhost" : "";
  const line = `npm install -g ${origin}/cli/knowledge-hub.tgz && knowledge-hub install-agent && knowledge-hub configure --hub-url ${origin} --binding-id ${bindingId} --token ${token}${local}`;
  return (
    <div className="space-y-3 rounded-md border border-kh-border p-4" role="status">
      <p className="text-body font-medium">Copy the setup line now. It carries the token and is shown only once.</p>
      <p className="text-caption text-kh-text-muted">Run it once per machine. Treat this line as a secret: run it only on your own machine, and rotate the token if it was pasted anywhere else.</p>
      <div data-code-block className="relative">
        <pre className="overflow-x-auto rounded-md bg-kh-bg-subtle p-3 pr-12 text-body-sm">{line}</pre>
        <CopyCodeButton />
      </div>
    </div>
  );
}

export function TaskExportSetup({ workspaceId, bindings }: { workspaceId: string; bindings: BindingView[] }) {
  const router = useRouter();
  const base = `/api/workspaces/${workspaceId}/task-export-bindings`;
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
      <section className="space-y-3">
        <h2 className="text-body font-medium text-kh-text">Create a binding</h2>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const created = (await send(base, "POST", { label })) as Issued;
              setIssued(created);
              setLabel("");
            });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="task-export-label">Label</Label>
            <Input id="task-export-label" value={label} maxLength={200} required placeholder="work laptop" aria-describedby="task-export-label-hint" onChange={(event) => setLabel(event.target.value)} />
            <p id="task-export-label-hint" className="text-caption text-kh-text-muted">One binding per machine. For another machine, create another binding; rotating a token stops the machine that uses it.</p>
          </div>
          <Button type="submit" disabled={busy}>Create binding</Button>
        </form>
      </section>
      <section className="space-y-2">
        <h2 className="text-body font-medium text-kh-text">Bindings</h2>
        {bindings.length === 0 ? (
          <p className="text-body text-kh-text-muted">No bindings yet. Create one for each machine you export from.</p>
        ) : (
          <ul className="divide-y divide-kh-border">
            {bindings.map((binding) => (
              <li key={binding.bindingId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
                  <p className="truncate text-body font-medium text-kh-text">{binding.label}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-kh-text-muted">
                    <Status kind={binding.status === "ACTIVE" ? "active" : "danger"}>{binding.status === "ACTIVE" ? "Active" : "Revoked"}</Status>
                    <span aria-hidden="true">·</span>
                    <span>Created <Timestamp value={binding.createdAt} variant="date" label="Created" /></span>
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
        )}
      </section>
      {bindings.length > 0 ? (
        <details className="border-t border-kh-border pt-3">
          <summary className="kh-focus-ring rounded-md text-caption text-kh-text-muted">Binding IDs</summary>
          <dl className="mt-2 space-y-1 text-caption">
            {bindings.map((binding) => (
              <div key={binding.bindingId} className="flex gap-3">
                <dt className="w-24 shrink-0 truncate text-kh-text-muted">{binding.label}</dt>
                <dd className="break-all font-mono text-kh-text-muted">{binding.bindingId}</dd>
              </div>
            ))}
          </dl>
        </details>
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
