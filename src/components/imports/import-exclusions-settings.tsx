"use client";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
export function ImportExclusionsSettings({ value, onChange, disabled }: { value: string; onChange: (text: string) => void; disabled: boolean }) {
  return <div><details className="mt-3 rounded-md border border-kh-border p-3"><summary className="kh-focus-ring cursor-pointer rounded-md text-body"><span>Excluded paths</span> · {value.split("\n").filter(path => path.trim()).length}</summary><div className="mt-3 space-y-2">
    <Label htmlFor="excluded-paths">One file or folder path per line, relative to the selected folder</Label>
    <Textarea id="excluded-paths" className="font-mono" value={value} disabled={disabled} onChange={e => onChange(e.target.value)} placeholder={"private\ntmp/cache\nsecret.md"} />
    <p className="text-caption text-kh-text-muted">Up to 50 paths. No wildcards. Hidden files and folders and node_modules are always skipped. These rules are saved to the source only after Apply succeeds, and used on all devices.</p>
    <p className="text-caption text-kh-warning">Excluding previously synced files will archive those documents when you Apply. Review the Preview before applying.</p>
  </div></details></div>;
}
