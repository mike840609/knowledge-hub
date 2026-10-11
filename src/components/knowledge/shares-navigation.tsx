import Link from "next/link";
export function SharesNavigation({ workspaceId, active }: { workspaceId:string;active:"mine"|"saved" }) {
  return <nav aria-label="Shares sections" className="mt-4 flex gap-4 border-b border-kh-border text-body-sm">
    {([{id:"mine",label:"My shares",href:`/w/${workspaceId}/shares`},{id:"saved",label:"Saved shares",href:`/w/${workspaceId}/shares?tab=saved`}] as const).map(section=><Link key={section.id} href={section.href} aria-current={active===section.id?"page":undefined} className={`kh-focus-ring border-b-2 px-1 py-2 ${active===section.id?"border-kh-primary font-medium text-kh-text":"border-transparent text-kh-text-muted hover:text-kh-text"}`}>{section.label}</Link>)}
  </nav>;
}
