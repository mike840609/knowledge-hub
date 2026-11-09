import Link from "next/link";
import type { ReactNode } from "react";
import { Status } from "@/components/ui/status";
import { Timestamp } from "@/components/ui/timestamp";
import { agentName } from "./agent-name";
import { verificationKind, verificationLabel } from "./task-verification";

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

const REFERENCE_LABEL: Record<Reference["type"], string> = { WIKI: "Wiki", CODE_FILE: "File", COMMIT: "Commit", PR_URL: "Pull request" };
const STATE: Record<string, string> = { UNRESOLVED: "not found", AMBIGUOUS: "ambiguous", UNAVAILABLE: "unavailable" };

/** Only an https URL becomes a link; anything else stays text. */
function safeHttpsUrl(raw: string): string | null {
  try {
    return new URL(raw).protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

/** A metadata item with its separator, held together so a wrapped line never ends on a dot. */
function Meta({ children, first = false }: { children: ReactNode; first?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {first ? null : <span aria-hidden="true" className="hidden sm:inline">·</span>}
      {children}
    </span>
  );
}

function ReferenceItem({ workspaceId, item }: { workspaceId: string; item: TaskDetailView["references"][number] }) {
  const { reference, document } = item;
  const link = "kh-focus-ring rounded-sm text-kh-link underline-offset-2 hover:underline";
  let value: ReactNode;
  if (reference.type === "WIKI") {
    const locator = "path" in reference ? reference.path : reference.documentId;
    value = document
      ? <Link className={link} href={`/w/${workspaceId}/knowledge/${document.sourceId}/${document.documentId}`}>{document.title ?? locator}</Link>
      : <><span className="break-all font-mono">{locator}</span> <span className="text-caption text-kh-text-muted">({STATE[item.state ?? "UNAVAILABLE"] ?? "unavailable"})</span></>;
  } else if (reference.type === "PR_URL") {
    const href = safeHttpsUrl(reference.url);
    value = href ? <a className={`${link} break-all`} href={href} rel="noopener noreferrer nofollow" target="_blank">{reference.url}</a> : <span className="break-all">{reference.url}</span>;
  } else if (reference.type === "COMMIT") {
    value = <span className="font-mono">{reference.id}</span>;
  } else {
    value = <span className="break-all font-mono">{reference.path}</span>;
  }
  return (
    <div className="flex gap-3">
      <dt className="w-24 shrink-0 text-kh-text-muted">{REFERENCE_LABEL[reference.type]}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </div>
  );
}

function List({ title, items }: { title: string; items?: string[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-body font-medium text-kh-text">{title}</h2>
      <ul className="max-w-measure list-disc space-y-1 pl-5 text-body text-kh-text">
        {items.map((text, index) => <li key={index} className="whitespace-pre-wrap break-words">{text}</li>)}
      </ul>
    </section>
  );
}

export function TaskDetail({ workspaceId, detail }: { workspaceId: string; detail: TaskDetailView }) {
  const { content } = detail;
  const archived = detail.lifecycle === "ARCHIVED";
  const verification = verificationLabel(content.verification.status);
  const checks = content.verification.checks ?? [];
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-kh-text-muted sm:gap-x-2">
          <Meta first><Status kind={verificationKind(content.verification.status)}>Verification {verification.toLowerCase()}</Status></Meta>
          <Meta>{agentName(content.agent)}</Meta>
          <Meta>Completed <Timestamp value={content.completedAt} /></Meta>
          <Meta>via {detail.binding.label}</Meta>
          {detail.binding.status === "REVOKED" ? <Meta><Status kind="danger">Binding revoked</Status></Meta> : null}
          {archived ? <Meta><Status kind="archived">Archived</Status></Meta> : null}
        </p>
        {detail.revisionNo !== detail.latestRevisionNo ? (
          <p className="text-body-sm text-kh-text-muted" role="status">You are viewing revision {detail.revisionNo} of {detail.latestRevisionNo}.</p>
        ) : null}
      </div>

      <section className="space-y-2">
        <h2 className="text-body font-medium text-kh-text">Summary</h2>
        <p className="max-w-measure whitespace-pre-wrap break-words text-body text-kh-text">{content.summary}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-body font-medium text-kh-text">Verification</h2>
        {checks.length > 0 ? (
          <ul className="max-w-measure space-y-1 rounded-md bg-kh-bg-subtle px-3 py-2 text-body-sm">
            {checks.map((check, index) => <li key={index} className="whitespace-pre-wrap break-words font-mono text-kh-text">{check}</li>)}
          </ul>
        ) : (
          <p className="text-body text-kh-text-muted">No checks were recorded.</p>
        )}
      </section>

      <List title="Findings" items={content.findings} />
      <List title="Decisions" items={content.decisions} />
      <List title="Changes" items={content.changes} />

      {detail.references.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-body font-medium text-kh-text">References</h2>
          <dl className="space-y-1.5 text-body text-kh-text">
            {detail.references.map((item, index) => <ReferenceItem key={index} workspaceId={workspaceId} item={item} />)}
          </dl>
        </section>
      ) : null}

      {detail.revisionHistory.length > 1 ? (
        <section className="space-y-2">
          <h2 className="text-body font-medium text-kh-text">Revisions</h2>
          <ul className="flex max-w-measure flex-col gap-1 text-body">
            {detail.revisionHistory.map((revision) => (
              <li key={revision.revisionNo} className="flex items-center justify-between gap-3">
                {revision.revisionNo === detail.revisionNo
                  ? <span className="font-medium text-kh-text" aria-current="true">Revision {revision.revisionNo}</span>
                  : <Link className="kh-focus-ring rounded-sm text-kh-link underline-offset-2 hover:underline" href={`/w/${workspaceId}/tasks/${detail.taskResultId}?revision=${revision.revisionNo}`}>Revision {revision.revisionNo}</Link>}
                <Timestamp value={revision.createdAt} variant="short" label="Created" className="shrink-0 text-caption tabular-nums text-kh-text-muted" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
