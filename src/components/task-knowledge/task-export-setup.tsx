"use client";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
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
      <p className="text-caption text-kh-text-muted">Run it once per machine. Treat this line as a secret: run it only on your own machine, and rotate the token if it was pasted anywhere else. The token can read every document and task result in your My Space, and add task results; it cannot change a document.</p>
      <div data-code-block className="relative">
        <pre className="overflow-x-auto rounded-md bg-kh-bg-subtle p-3 pr-12 text-body-sm">{line}</pre>
        <CopyCodeButton />
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden="true" className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-kh-border text-caption text-kh-text-secondary">{n}</span>
      <div className="min-w-0 flex-1 space-y-2">
        <h2 className="text-body font-medium text-kh-text">{title}</h2>
        {children}
      </div>
    </li>
  );
}

/**
 * The Agents page body (2026-11-27-agents-destination-design.md). With no binding yet it is the three steps in order,
 * each holding its own control; once there is one it is a management page, with the binding form behind "Add a machine".
 * `diagram` and `skills` are server-rendered and placed by this layout.
 */
export function TaskExportSetup({ workspaceId, bindings, diagram, skills }: { workspaceId: string; bindings: BindingView[]; diagram: ReactNode; skills: ReactNode }) {
  const router = useRouter();
  const base = `/api/workspaces/${workspaceId}/task-export-bindings`;
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [revoking, setRevoking] = useState<BindingView | null>(null);
  const [adding, setAdding] = useState(false);
  // The first binding's setup line stays in its step until the reader leaves; later ones show above the list.
  const stepped = bindings.length === 0 || (issued !== null && bindings.length === 1);

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

  const form = (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void act(async () => {
          const created = (await send(base, "POST", { label })) as Issued;
          setIssued(created);
          setLabel("");
          setAdding(false);
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
  );

  const bindingList = (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-body font-medium text-kh-text">Bindings</h2>
        {!adding ? <Button variant="secondary" onClick={() => setAdding(true)}>Add a machine</Button> : null}
      </div>
      <p className="text-caption text-kh-text-muted">Bind each machine once. After that, type a skill in any project; bind again only if you rotate the token or revoke the binding.</p>
      {adding ? <div className="rounded-md border border-kh-border p-4">{form}</div> : null}
      <ul className="divide-y divide-kh-border border-y border-kh-border">
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
      <details className="pt-1">
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
    </section>
  );

  return (
    <div className="max-w-panel space-y-6">
      {error ? <p className="text-body text-kh-danger" role="alert">{error}</p> : null}
      {stepped ? (
        <>
          {diagram}
          <ol className="space-y-6">
            <Step n={1} title="Create a binding">
              <p className="text-caption text-kh-text-muted">One per machine. A binding is what lets that machine's agent in.</p>
              {form}
            </Step>
            <Step n={2} title="Run the setup line on that machine">
              {issued ? <Commands {...issued} /> : (
                <>
                  <p className="text-caption text-kh-text-muted">Once per machine. It appears here when you create the binding, installs the command and the skills, and saves the token. After this, type a skill in any project.</p>
                  <div aria-hidden="true" className="rounded-md bg-kh-bg-subtle p-3 text-body-sm text-kh-text-faint">npm install -g …/cli/knowledge-hub.tgz && knowledge-hub install-agent …</div>
                </>
              )}
            </Step>
            <Step n={3} title="Type a skill in your agent">{skills}<p className="text-caption text-kh-text-muted">No need to bind again, unless you rotate the token or revoke the binding.</p></Step>
          </ol>
          {bindings.length > 0 ? bindingList : null}
        </>
      ) : (
        <>
          {issued ? <Commands {...issued} /> : null}
          {bindingList}
          <section className="space-y-2"><h2 className="text-body font-medium text-kh-text">Skills</h2>{skills}</section>
          {diagram}
          <details className="border-t border-kh-border pt-3">
            <summary className="kh-focus-ring rounded-md text-body text-kh-text-muted">How to connect another machine</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-body text-kh-text-secondary">
              <li>Add a machine to create a binding.</li>
              <li>Run the setup line it shows, once, on that machine.</li>
              <li>Type a skill in Claude Code or OpenCode.</li>
            </ol>
          </details>
        </>
      )}
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
