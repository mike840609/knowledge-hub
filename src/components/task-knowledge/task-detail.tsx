"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Timestamp } from "@/components/ui/timestamp";
import { agentName } from "./task-list";

type Reference =
  | { type: "WIKI"; path: string }
  | { type: "WIKI"; documentId: string }
  | { type: "CODE_FILE"; path: string }
  | { type: "COMMIT"; id: string }
  | { type: "PR_URL"; url: string };

export type TaskDetailView = {
  taskResultId: string;
  lifecycle: "ACTIVE" | "ARCHIVED";
  latestRevisionNo: number;
  revisionNo: number;
  revisionHistory: { revisionNo: number; createdAt: string }[];
  binding: { label: string; status: "ACTIVE" | "REVOKED" };
  content: {
    agent: string;
    title: string;
    summary: string;
    completedAt: string;
    verification: { status: string; checks?: string[] };
    findings?: string[];
    decisions?: string[];
    changes?: string[];
  };
  references: { reference: Reference; state: "RESOLVED" | "UNRESOLVED" | "AMBIGUOUS" | "UNAVAILABLE" | null; document: { documentId: string; sourceId: string; title: string | null } | null }[];
};

const VERIFICATION: Record<string, string> = { passed: "Passed", failed: "Failed", not_run: "Not run", not_applicable: "Not applicable" };
const STATE: Record<string, string> = { UNRESOLVED: "not found", AMBIGUOUS: "ambiguous", UNAVAILABLE: "unavailable" };

/** Only an https URL becomes a link; anything else stays text. */
function safeHttpsUrl(raw: string): string | null {
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

function ReferenceItem({ workspaceId, item }: { workspaceId: string; item: TaskDetailView["references"][number] }) {
  const { reference, document } = item;
  const link = "kh-focus-ring rounded-sm text-kh-link underline-offset-2 hover:underline";
  if (reference.type === "WIKI") {
    const locator = "path" in reference ? reference.path : reference.documentId;
    if (document) {
      return <li><span className="text-kh-text-muted">Wiki </span><Link className={link} href={`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}`}>{document.title ?? locator}</Link></li>;
    }
    return <li><span className="text-kh-text-muted">Wiki </span><span className="font-mono">{locator}</span> <span className="text-caption text-kh-text-muted">({STATE[item.state ?? "UNAVAILABLE"] ?? "unavailable"})</span></li>;
  }
  if (reference.type === "PR_URL") {
    const href = safeHttpsUrl(reference.url);
    return <li><span className="text-kh-text-muted">Pull request </span>{href ? <a className={`${link} break-all`} href={href} rel="noopener noreferrer nofollow" target="_blank">{reference.url}</a> : <span className="break-all">{reference.url}</span>}</li>;
  }
  if (reference.type === "COMMIT") return <li><span className="text-kh-text-muted">Commit </span><span className="font-mono">{reference.id}</span></li>;
  return <li><span className="text-kh-text-muted">File </span><span className="font-mono break-all">{reference.path}</span></li>;
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-body font-semibold">{title}</h2>
      <ul className="list-disc space-y-1 pl-5 text-body">{items.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text}</li>)}</ul>
    </section>
  );
}

export function TaskDetail({ workspaceId, detail }: { workspaceId: string; detail: TaskDetailView }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { content } = detail;
  const archived = detail.lifecycle === "ARCHIVED";

  async function toggleLifecycle() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/workspaces/${workspaceId}/task-results/${detail.taskResultId}/lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: archived ? "restore" : "archive" }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) return setError("The task could not be updated. Try again.");
    router.refresh();
  }

  return (
    <div className="max-w-panel space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-caption text-kh-text-muted">
        <span>{agentName(content.agent)}</span>
        <Timestamp value={content.completedAt} label="Completed" />
        <span>Binding {detail.binding.label}</span>
        {detail.binding.status === "REVOKED" ? <Badge variant="outline">Binding revoked</Badge> : null}
        {archived ? <Badge variant="warning">Archived</Badge> : null}
        <Button variant="secondary" size="sm" className="ml-auto" disabled={busy} onClick={toggleLifecycle}>{archived ? "Restore" : "Archive"}</Button>
      </div>
      {error ? <p className="text-body text-kh-danger" role="alert">{error}</p> : null}
      {detail.revisionNo !== detail.latestRevisionNo ? (
        <p className="text-body text-kh-text-muted" role="status">You are viewing revision {detail.revisionNo} of {detail.latestRevisionNo}.</p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-body font-semibold">Summary</h2>
        <p className="whitespace-pre-wrap break-words text-body">{content.summary}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-body font-semibold">Verification</h2>
        <p className="text-body">{VERIFICATION[content.verification.status] ?? content.verification.status}</p>
        {content.verification.checks?.length ? (
          <ul className="space-y-1 text-body">{content.verification.checks.map((check, index) => <li key={index} className="whitespace-pre-wrap break-words font-mono">{check}</li>)}</ul>
        ) : null}
      </section>

      <List title="Findings" items={content.findings} />
      <List title="Decisions" items={content.decisions} />
      <List title="Changes" items={content.changes} />

      {detail.references.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-body font-semibold">References</h2>
          <ul className="space-y-1 text-body">{detail.references.map((item, index) => <ReferenceItem key={index} workspaceId={workspaceId} item={item} />)}</ul>
        </section>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-body font-semibold">Revisions</h2>
        <ul className="space-y-1 text-body">
          {detail.revisionHistory.map((revision) => (
            <li key={revision.revisionNo} className="flex items-center gap-2">
              {revision.revisionNo === detail.revisionNo
                ? <span className="font-medium" aria-current="true">Revision {revision.revisionNo}</span>
                : <Link className="kh-focus-ring rounded-sm text-kh-link" href={`/w/${workspaceId}/tasks/${detail.taskResultId}?revision=${revision.revisionNo}`}>Revision {revision.revisionNo}</Link>}
              <Timestamp value={revision.createdAt} className="text-caption text-kh-text-muted" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
