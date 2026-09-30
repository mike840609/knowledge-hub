import type { Draft } from "./document-draft";
export type DraftStatus = "loading" | "saved" | "saving" | "local" | "error" | "conflict";
type Envelope = { value: Draft | null; version: number };
/** Serial writes plus optimistic versions prevent late responses and other tabs from overwriting drafts. */
export class PersistentDraft {
  private version = 0;
  private pending: Draft | null | undefined;
  private loaded = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flight: Promise<void> | undefined;
  constructor(private readonly endpoint: string, private readonly key: string, private readonly onStatus: (s: DraftStatus) => void) {}
  private get storageKey() { return `kh:persistent:${this.endpoint}:${this.key}`; }
  private readLocal(): Envelope | null {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (!raw) return null;
      const v = JSON.parse(raw) as Envelope;
      if (!Number.isSafeInteger(v.version) || v.version < 0 || !(v.value === null || typeof v.value?.title === "string" && typeof v.value?.markdown === "string" && (v.value.baseRevisionId === null || typeof v.value.baseRevisionId === "string"))) return null;
      return v;
    } catch { return null; }
  }
  private keepLocal(value: Draft | null): boolean {
    try { localStorage.setItem(this.storageKey, JSON.stringify({ value, version: this.version })); return true; }
    catch { return false; }
  }
  async load(): Promise<Draft | null> {
    const local = this.readLocal();
    try {
      const response = await fetch(`${this.endpoint}?key=${encodeURIComponent(this.key)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const remote = await response.json() as Envelope;
      this.version = remote.version;
      this.loaded = true;
      if (local && JSON.stringify(local.value) !== JSON.stringify(remote.value)) {
        this.pending = local.value;
        if (local.version !== remote.version) { this.stopped = true; this.onStatus("conflict"); }
        else { this.onStatus("local"); this.schedule(); }
        return local.value;
      }
      this.onStatus("saved");
      return remote.value;
    } catch {
      if (local) { this.version = local.version; this.pending = local.value; }
      this.onStatus("error");
      return local?.value ?? null;
    }
  }
  change(value: Draft | null) {
    this.pending = value;
    const kept = this.keepLocal(value);
    this.onStatus(this.stopped ? "conflict" : kept ? "local" : "error");
    this.schedule();
  }
  private schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush(); }, 600);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.flight) { await this.flight; return this.flush(); }
    if (!this.loaded || this.stopped || this.pending === undefined) return;
    const value = this.pending;
    this.pending = undefined;
    this.onStatus("saving");
    this.flight = (async () => {
      try {
        const response = await fetch(this.endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: this.key, value, version: this.version }) });
        if (!response.ok) {
          if (response.status === 409) this.stopped = true;
          throw new Error();
        }
        const result = await response.json() as Envelope;
        this.version = result.version;
        if (this.pending !== undefined) this.keepLocal(this.pending);
        else {
          // Do not delete another tab's local recovery copy.
          const local = this.readLocal();
          if (local && JSON.stringify(local.value) === JSON.stringify(value) && local.version === result.version - 1) localStorage.removeItem(this.storageKey);
        }
        this.onStatus(this.pending === undefined ? "saved" : "local");
      } catch {
        if (this.pending === undefined) this.pending = value;
        this.onStatus(this.stopped ? "conflict" : "error");
      }
    })();
    await this.flight;
    this.flight = undefined;
  }
  async retry() {
    if (this.stopped) return;
    if (!this.loaded) {
      // Establish a version before uploading a recovery copy; load detects divergence.
      const pending = this.pending;
      await this.load();
      if (pending !== undefined) this.pending = pending;
    }
    await this.flush();
  }
  async clear() {
    if (this.stopped) {
      // Discard only our recovery copy; another device owns the newer server version.
      clearTimeout(this.timer);
      this.pending = undefined;
      try { localStorage.removeItem(this.storageKey); } catch { /* unavailable storage */ }
      return;
    }
    this.change(null); await this.flush();
  }
  dispose() { clearTimeout(this.timer); void this.flush(); }
}
