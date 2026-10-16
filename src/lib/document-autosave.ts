export type DocumentContent = { title: string; markdown: string };
export type SavedRevision = { revisionId: string; revisionNo: number; changed: boolean };
export type AutosaveStatus = "saved" | "pending" | "saving" | "error";
const equal = (a: DocumentContent, b: DocumentContent) => a.title === b.title && a.markdown === b.markdown;

/** One writer per mounted document. Only acknowledged snapshots advance the revision/baseline. */
export class DocumentAutosave {
  current: DocumentContent;
  saved: DocumentContent;
  revisionId: string;
  status: AutosaveStatus = "saved";
  error: unknown;
  private timer?: ReturnType<typeof setTimeout>;
  private flight = false;
  private dirtySince: number | undefined;
  private disposed = false;
  private paused = false;
  constructor(content: DocumentContent, revisionId: string, private readonly options: {
    write: (content: DocumentContent, revisionId: string) => Promise<SavedRevision>;
    change: () => void;
    saved: (content: DocumentContent, revision: SavedRevision) => void;
    delay?: number;
    maxWait?: number;
  }) {
    this.current = this.saved = content;
    this.revisionId = revisionId;
  }
  get dirty() { return this.flight || !equal(this.current, this.saved); }
  change(content: DocumentContent) {
    this.current = content;
    if (this.dirty) this.dirtySince ??= Date.now();
    else this.dirtySince = undefined;
    clearTimeout(this.timer);
    if (!this.error && !this.flight) this.status = this.dirty ? "pending" : "saved";
    this.options.change();
    if (this.dirty && !this.error && !this.paused) this.schedule();
  }
  pause(paused: boolean) {
    this.paused = paused;
    clearTimeout(this.timer);
    if (!paused && this.dirty && !this.error) this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.disposed || this.flight) return;
    const remaining = (this.options.maxWait ?? 15_000) - (Date.now() - (this.dirtySince ?? Date.now()));
    this.timer = setTimeout(() => { void this.flush(); }, Math.max(0, Math.min(this.options.delay ?? 3000, remaining)));
  }
  async flush() {
    clearTimeout(this.timer);
    if (this.disposed || this.paused || this.flight || this.error || !this.dirty) return;
    const snapshot = this.current;
    this.dirtySince = undefined;
    this.flight = true;
    this.status = "saving";
    this.options.change();
    try {
      const revision = await this.options.write(snapshot, this.revisionId);
      this.revisionId = revision.revisionId;
      this.saved = snapshot;
      this.flight = false;
      if (this.dirty) this.dirtySince ??= Date.now();
      else this.dirtySince = undefined;
      this.status = this.dirty ? "pending" : "saved";
      // Also rebase the recovery copy when navigation happened during the request.
      this.options.saved(snapshot, revision);
      if (!this.disposed) {
        this.options.change();
        if (this.dirty && !this.paused) this.schedule();
      }
    } catch (error) {
      this.flight = false;
      this.error = error;
      this.status = "error";
      if (!this.disposed) this.options.change();
    }
  }
  retry() {
    this.error = undefined;
    return this.flush();
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
