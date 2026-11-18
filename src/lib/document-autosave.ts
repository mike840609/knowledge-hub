export type DocumentContent = { title: string; markdown: string };
export type RevisionHistory = { state: "WORKING" | "CHECKPOINT"; activityId: string | null; windowStartedAt: Date | string | null; name: string | null; reason: string };
export type SavedRevision = { revisionId: string; revisionNo: number; changed: boolean; history?: RevisionHistory; preservedRevision?: { id: string; revisionNo: number; createdAt: Date | string; createdBy: string; history?: RevisionHistory } };
export type AutosaveStatus = "saved" | "pending" | "saving" | "error";
const equal = (a: DocumentContent, b: DocumentContent) => a.title === b.title && a.markdown === b.markdown;
/**
 * What a request that outlives the page (`fetch` with `keepalive`) may carry: browsers allow 64 KiB in
 * flight. Measured on the content as JSON, which escapes every line break; the request's other fields
 * add a few hundred bytes at most.
 */
export const KEEPALIVE_BYTES = 60_000;
const RETRY_FIRST = 2000;
const RETRY_LONGEST = 30_000;
export type WriteOptions = { keepalive: true };
const fitsKeepalive = (content: DocumentContent) => new TextEncoder().encode(JSON.stringify(content)).length <= KEEPALIVE_BYTES;

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
  /** Gone from the page, with what was unsaved still to send (`leave`). */
  private leaving = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private paused = false;
  private settled = new Set<() => void>();
  constructor(content: DocumentContent, revisionId: string, private readonly options: {
    write: (content: DocumentContent, revisionId: string, options?: WriteOptions) => Promise<SavedRevision>;
    change: () => void;
    saved: (content: DocumentContent, revision: SavedRevision) => void;
    delay?: number;
    maxWait?: number;
    /** A failure worth trying again on its own (the network, a server error); a conflict is not. */
    retryable?: (error: unknown) => boolean;
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
    const remaining = (this.options.maxWait ?? 5000) - (Date.now() - (this.dirtySince ?? Date.now()));
    this.timer = setTimeout(() => { void this.flush(); }, Math.max(0, Math.min(this.options.delay ?? 1000, remaining)));
  }
  /**
   * A conflict settled by merging: `theirs`, saved elsewhere as `revisionId`, becomes the base, and
   * `merged` is what goes on saving against it. Only while that conflict is still the failure.
   */
  rebase(theirs: DocumentContent, revisionId: string, merged: DocumentContent) {
    if (this.disposed || this.flight || !this.error) return false;
    this.error = undefined;
    this.attempts = 0;
    this.saved = theirs;
    this.revisionId = revisionId;
    this.dirtySince = undefined;
    this.change(merged);
    return true;
  }
  /** A failure is being tried again on its own. */
  get retrying() { return this.retryTimer !== undefined; }
  /** `keepalive`: the page may be going (hidden, closing); the request outlives it. */
  async flush({ keepalive = false }: { keepalive?: boolean } = {}) {
    clearTimeout(this.timer);
    if ((this.disposed && !this.leaving) || this.paused || this.flight || this.error || !this.dirty) return;
    const snapshot = this.current;
    // Over the browser's limit such a request is refused outright: a normal one at least may finish.
    keepalive &&= fitsKeepalive(snapshot);
    this.dirtySince = undefined;
    this.flight = true;
    this.status = "saving";
    this.options.change();
    try {
      const revision = await (keepalive ? this.options.write(snapshot, this.revisionId, { keepalive }) : this.options.write(snapshot, this.revisionId));
      this.attempts = 0;
      this.revisionId = revision.revisionId;
      this.saved = snapshot;
      this.flight = false;
      if (this.dirty) this.dirtySince ??= Date.now();
      else this.dirtySince = undefined;
      this.status = this.dirty ? "pending" : "saved";
      // Also rebase the recovery copy when navigation happened during the request.
      this.options.saved(snapshot, revision);
      if (this.leaving) void this.flush({ keepalive: true });
      else if (!this.disposed) {
        this.options.change();
        if (this.dirty && !this.paused) this.schedule();
      }
    } catch (error) {
      this.flight = false;
      this.error = error;
      this.status = "error";
      if (!this.disposed) {
        if (this.options.retryable?.(error)) {
          // 2s, 4s, 8s … at most 30s apart, until one succeeds or the editor goes.
          const wait = Math.min(RETRY_FIRST * 2 ** this.attempts, RETRY_LONGEST);
          this.attempts++;
          this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.retry(false); }, wait);
        } else this.attempts = 0;
        this.options.change();
      }
    } finally {
      for (const resolve of this.settled) resolve();
      this.settled.clear();
    }
  }
  /** Explicit actions such as commenting must wait for an existing write too. */
  async saveCurrent(): Promise<string> {
    while (this.dirty && !this.error) {
      if (this.disposed || this.paused) throw new Error("Finish editing or recovering the document before commenting.");
      if (this.flight) await new Promise<void>(resolve => this.settled.add(resolve));
      else await this.flush();
    }
    if (this.disposed) throw new Error("The document was closed before it finished saving.");
    if (this.error) throw this.error;
    return this.revisionId;
  }
  /** A refreshed server snapshot can replace an idle baseline, never unsaved input. */
  adopt(content: DocumentContent, revisionId: string) {
    if (this.disposed || this.dirty || this.error) return false;
    clearTimeout(this.timer);
    this.current = this.saved = content;
    this.revisionId = revisionId;
    this.status = "saved";
    this.dirtySince = undefined;
    return true;
  }
  /** `manual`: the writer asked (Retry save), so a failure after it waits from the shortest delay again. */
  retry(manual = true) {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (manual) this.attempts = 0;
    this.error = undefined;
    if (this.status === "error") this.status = this.dirty ? "pending" : "saved";
    return this.flush();
  }
  /** The connection came back, or the page did: a failure being tried again is tried now. */
  retryNow() {
    if (this.retrying) void this.retry(false);
  }
  /** Whether what is unsaved could go with the page (`leave`, or `flush` with `keepalive`), or would be left behind. */
  canSendOnLeave() {
    if (!this.dirty) return true;
    if (this.paused || this.error || this.flight) return false;
    return fitsKeepalive(this.current);
  }
  /**
   * The editor goes (navigation inside the app): what is unsaved is sent now, or after the write in
   * flight, with a request that outlives the page; then nothing more is saved or tried again.
   */
  leave() {
    if (this.disposed) return;
    // A failure being tried again gets one last try on the way out; a refusal does not.
    if (this.retrying) this.error = undefined;
    this.leaving = true;
    this.dispose();
    void this.flush({ keepalive: true });
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); clearTimeout(this.retryTimer); this.retryTimer = undefined; }
}
