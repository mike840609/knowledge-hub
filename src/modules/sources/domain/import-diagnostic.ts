export type ImportSeverity = "WARNING" | "BLOCKING";

export type ImportDiagnostic = {
  code: string;
  severity: ImportSeverity;
  sourcePath: string | null;
  message: string;
  details?: Record<string, unknown>;
};
