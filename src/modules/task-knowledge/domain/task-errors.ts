import { DomainError } from "@/shared/domain/errors";

export type TaskArtifactErrorCode =
  | "MALFORMED_JSON"
  | "PAYLOAD_TOO_LARGE"
  | "INVALID_ARTIFACT"
  | "UNSUPPORTED_SCHEMA_VERSION";

/**
 * A task artifact failed its contract. Messages name the field that failed,
 * never the value: an Agent's payload may carry a secret it should not have.
 */
export class TaskArtifactError extends DomainError {
  declare readonly code: TaskArtifactErrorCode;

  constructor(code: TaskArtifactErrorCode, message: string) {
    super(code, message);
    this.name = "TaskArtifactError";
  }
}
