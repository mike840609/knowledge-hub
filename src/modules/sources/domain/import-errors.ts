import { DomainError } from "@/shared/domain/errors";

export class SourceImportError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "SourceImportError";
  }
}

export function importError(code: string, message: string): SourceImportError {
  return new SourceImportError(code, message);
}
