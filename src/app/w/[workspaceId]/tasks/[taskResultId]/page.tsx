import { notFound } from "next/navigation";
import { PageHeader } from "@/components/shell/page-header";
import { TaskDetail } from "@/components/task-knowledge/task-detail";
import { TaskLifecycleAction } from "@/components/task-knowledge/task-lifecycle-action";
import { applicationServices } from "@/server/composition";
import { DomainError } from "@/shared/domain/errors";

type Props = { params: Promise<{ workspaceId: string; taskResultId: string }>; searchParams: Promise<{ revision?: string }> };

const NOT_FOUND = new Set(["WORKSPACE_NOT_FOUND", "WORKSPACE_ARCHIVED", "TASK_RESULT_NOT_FOUND"]);

export default async function TaskResultPage({ params, searchParams }: Props) {
  const { workspaceId, taskResultId } = await params;
  const { revision } = await searchParams;
  const revisionNo = revision && /^[1-9]\d{0,8}$/.test(revision) ? Number(revision) : undefined;
  const services = applicationServices();
  const { caller } = await services.establishTrustedCaller();
  let detail;
  try {
    detail = await services.taskResults.get(caller, workspaceId, taskResultId, { revisionNo });
  } catch (error) {
    if (error instanceof DomainError && NOT_FOUND.has(error.code)) notFound();
    throw error;
  }
  return (
    <main className="kh-page pb-6">
      <PageHeader
        location="Tasks"
        locationHref={`/w/${workspaceId}/tasks`}
        title={detail.content.title}
        actions={<TaskLifecycleAction workspaceId={workspaceId} taskResultId={taskResultId} lifecycle={detail.lifecycle} />}
      />
      <div className="mt-6">
        <TaskDetail
          workspaceId={workspaceId}
          detail={{
            ...detail,
            revisionHistory: detail.revisionHistory.map((item) => ({ revisionNo: item.revisionNo, createdAt: item.createdAt.toISOString() })),
          }}
        />
      </div>
    </main>
  );
}
