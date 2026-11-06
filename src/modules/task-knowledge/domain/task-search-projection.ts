import type { TaskArtifactV1 } from "./task-artifact";

export type TaskSearchProjection = {
  taskResultId: string;
  revisionNo: number;
  completedAtEpochMs: number;
  agent: TaskArtifactV1["agent"];
  verificationStatus: TaskArtifactV1["verification"]["status"];
  title: string;
  summary: string;
  searchBody: string;
};

/** One derived row per Task, rebuilt solely from its latest immutable artifact. */
export function projectTaskSearch(taskResultId: string, artifact: TaskArtifactV1): TaskSearchProjection {
  // Date.parse accepts explicit offsets and four-digit years 0000..9999.
  // Date.UTC(year, ...) would silently reinterpret years 00..99 as 1900..1999.
  const completedAtEpochMs = Date.parse(artifact.completedAt);
  if (!Number.isSafeInteger(completedAtEpochMs)) {
    throw new Error("Completed task timestamp could not be normalized.");
  }
  const searchBody = [
    artifact.summary,
    ...(artifact.findings ?? []),
    ...(artifact.decisions ?? []),
    ...(artifact.changes ?? []),
  ].join("\n");
  return {
    taskResultId,
    revisionNo: artifact.artifactRevision,
    completedAtEpochMs,
    agent: artifact.agent,
    verificationStatus: artifact.verification.status,
    title: artifact.title,
    summary: artifact.summary,
    searchBody,
  };
}

