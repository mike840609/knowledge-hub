import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { AgentDiagram } from "@/components/task-knowledge/agent-diagram";
import { AGENT_SKILLS } from "@/components/task-knowledge/agent-skills";
import { TaskExportSetup } from "@/components/task-knowledge/task-export-setup";
import { buttonClasses } from "@/components/ui/button";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

function Skills() {
  return (
    <div className="space-y-1.5">
      <ul className="divide-y divide-kh-border">
        {AGENT_SKILLS.map((skill) => (
          <li key={skill.name} className="flex items-baseline gap-3 py-2">
            <code className="w-28 shrink-0 rounded-md border border-kh-border px-2 text-center font-mono text-body-sm text-kh-text">/{skill.name}</code>
            <span className="min-w-0 flex-1 text-body text-kh-text-secondary">{skill.summary}</span>
            <span className="shrink-0 text-caption text-kh-text-muted">{skill.access}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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
        actions={<Link className={buttonClasses({ variant: "secondary" })} href={`/w/${workspaceId}/tasks`}>Task results</Link>}
      />
      <div className="mt-6">
        <TaskExportSetup
          workspaceId={workspaceId}
          bindings={bindings.map((binding) => ({ ...binding, createdAt: binding.createdAt.toISOString(), revokedAt: binding.revokedAt?.toISOString() ?? null }))}
          diagram={<AgentDiagram />}
          skills={<Skills />}
        />
      </div>
    </main>
  );
}
