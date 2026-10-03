import type {ImportSafetySummary} from "@/modules/sources/domain/import-safety";
export function ImportSafetyWarning({safety}:{safety:ImportSafetySummary}){
 return <section aria-label="Folder scope" className={`rounded-md border p-4 ${safety.highRisk?"border-kh-warning text-kh-warning":"border-kh-border text-kh-text-muted"}`}>
 <h2 className="text-body font-medium">{safety.highRisk?"Check the selected folder before applying":"Folder scope"}</h2>
 <p className="mt-1 text-caption">Previously {safety.previousDocuments} documents · Selected {safety.incomingDocuments} · Matched {safety.matchedDocuments} · Archive {safety.archivedDocuments} ({Math.round(safety.archiveRatio*100)}%)</p>
 {safety.highRisk?<p className="mt-2 text-body">This folder may be incomplete or different from the original. These documents will be archived. Verify the folder and confirm the source name before Apply.</p>:null}
 </section>;
}
