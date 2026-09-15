import { DomainError } from "@/shared/domain/errors";

export class SourceImportError extends DomainError {
  readonly details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(code, message);
    this.name = "SourceImportError";
    this.details = details;
  }
}

export function importError(code: string, message: string, details?: Record<string, unknown>): SourceImportError {
  return new SourceImportError(code, message, details);
}
