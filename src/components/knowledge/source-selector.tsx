import type { SourceView } from "@/modules/knowledge/application/knowledge-query-service";

export function SourceSelector({ sources, selectedSourceId }: { sources: SourceView[]; selectedSourceId: string | undefined }) {
  return (
    <div className="min-w-64">
      <label className="block text-sm font-medium text-slate-700" htmlFor="source-selector">Choose a source</label>
      <select id="source-selector" name="sourceId" defaultValue={selectedSourceId ?? ""} className="mt-1 min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
        <option value="">All sources</option>
        {sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
      </select>
    </div>
  );
}
