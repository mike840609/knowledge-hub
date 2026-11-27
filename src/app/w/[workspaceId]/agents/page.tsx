import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { AGENT_SKILLS } from "@/components/task-knowledge/agent-skills";
import { TaskExportSetup } from "@/components/task-knowledge/task-export-setup";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

const STEPS = [
  "Create a binding below, one per machine.",
  "Copy the setup line it shows, once, and run it in a terminal on that machine. It installs the knowledge-hub command and the skills, and saves the token.",
  "In Claude Code or OpenCode, type a skill, such as /hub-search.",
];

export default async function AgentsPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let bindings;
  try {
    bindings = await services.taskExportBindings.list(caller, workspaceId);
  } catch (error) {
    // Bindings exist only in the caller's own My Space; anything else reads as not found.
    if (error instanceof DomainError && error.code === "WORKSPACE_NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="kh-page pb-6">
      <PageHeader
        location="My Space"
        locationHref={`/w/${workspaceId}/home`}
        title="Agents"
        description="Let Claude Code or OpenCode search, read and save tasks to My Space."
      />
      <div className="mt-6 max-w-panel space-y-6">
        <section className="space-y-2">
          <h2 className="text-body font-medium text-kh-text">Connect an agent</h2>
          <ol className="list-decimal space-y-1 pl-5 text-body text-kh-text-secondary">
            {STEPS.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </section>
        <section className="space-y-2">
          <h2 className="text-body font-medium text-kh-text">Skills</h2>
          <ul className="divide-y divide-kh-border">
            {AGENT_SKILLS.map((skill) => (
              <li key={skill.name} className="flex items-baseline gap-3 py-2.5">
                <code className="w-28 shrink-0 font-mono text-body-sm text-kh-text">/{skill.name}</code>
                <span className="min-w-0 flex-1 text-body text-kh-text-secondary">{skill.summary}</span>
                <span className="shrink-0 text-caption text-kh-text-muted">{skill.access}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-kh-text-muted">
            A skill runs only when you type it. Agents read the current documents and task results in this My Space only, and cannot change a document.
          </p>
        </section>
        <TaskExportSetup
          workspaceId={workspaceId}
          bindings={bindings.map((binding) => ({ ...binding, createdAt: binding.createdAt.toISOString(), revokedAt: binding.revokedAt?.toISOString() ?? null }))}
        />
        <Link href={`/w/${workspaceId}/tasks`} className="kh-focus-ring inline-flex items-center gap-1 rounded-md text-body text-kh-link">
          Task results <ArrowRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </main>
  );
}
