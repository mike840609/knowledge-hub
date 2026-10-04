"use client";
import { Textarea } from "@/components/ui/textarea";
export function ImportExclusionsSettings({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled: boolean }) {
  return <div><p className="mt-3 text-caption text-kh-text-muted">Import scope · {value.split("\n").filter(path => path.trim()).length} excluded paths. Changes are saved only after Apply.</p><details className="mt-3 rounded-md border border-kh-border p-3"><summary className="kh-focus-ring cursor-pointer rounded-md text-body">Excluded paths</summary><div className="mt-3 space-y-2">
    <label htmlFor="excluded-paths" className="block text-body">One file or folder path per line, relative to the selected folder</label>
    <Textarea id="excluded-paths" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={"private\ntmp/cache\nsecret.md"} />
    <p className="text-caption text-kh-text-muted">Up to 50 paths. No wildcards. .git and .obsidian are always excluded. These rules are saved to the source only after Apply succeeds, and used on all devices.</p>
    <p className="text-caption text-kh-warning">Excluding previously synced files will archive those documents when you Apply. Review the Preview before applying.</p>
  </div></details></div>;
}
