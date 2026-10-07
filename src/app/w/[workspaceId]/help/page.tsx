import Link from "next/link";
import {applicationServices} from "@/server/composition";
import {GuideContentBlock} from "@/components/imports/import-guide";
import {userGuideContent} from "@/components/help/user-guide-content";

export default async function UserGuidePage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{lang?:string}>}) {
  const {workspaceId}=await params,{lang}=await searchParams;
  const services=applicationServices(),{caller}=await services.establishTrustedCaller();
  const state=await services.workspaceAdmin.workspaceState(caller,workspaceId);
  const personal=state.workspace.type==="PERSONAL";
  const locale=lang==="zh-TW"?"zh-TW":"en",zh=locale==="zh-TW",content=userGuideContent(locale),base=`/w/${workspaceId}`;
  const link="kh-focus-ring rounded-md text-kh-link underline-offset-4 hover:underline";
  return <main className="kh-page py-6" lang={locale}>
    <Link className={link} href={`${base}/${personal?"home":"sources"}`}>{personal?(zh?"返回 Home":"Back to Home"):(zh?"返回 Sources":"Back to Sources")}</Link>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><h1 className="text-heading font-semibold">{content.title}</h1><nav aria-label="Guide language" className="flex gap-3">{[{lang:"en",label:"English"},{lang:"zh-TW",label:"繁體中文"}].map(l=><Link key={l.lang} lang={l.lang} className={link} href={`${base}/help?lang=${l.lang}`} aria-current={locale===l.lang?"page":undefined}>{l.label}</Link>)}</nav></div>
    <p className="mt-2 text-body text-kh-text-muted">{content.intro}</p>
    {!personal?<p className="mt-3 text-body text-kh-text-muted">{zh?"你目前位於 Team workspace。同步與疑難排解步驟依你的權限使用；Home、Insights 與個人整理章節適用 My Space。":"You are in a Team workspace. Sync and troubleshooting steps depend on your permissions; Home, Insights and personal organization sections apply to My Space."}</p>:null}
    <nav aria-label={zh?"手冊章節":"Guide sections"} className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-b border-kh-border pb-5">{content.sections.map(s=><Link key={s.id} href={`#${s.id}`} className={`${link} text-body`}>{s.title}</Link>)}</nav>
    <div className="mt-4 flex flex-wrap gap-4 text-body"><Link className={link} href={`${base}/sources/import`}>{zh?"開始匯入":"Import folder"}</Link><Link className={link} href={`${base}/sources/import/guide?lang=${locale}`}>{zh?"Markdown 格式、knowledge_id 與匯入限制":"Markdown format, knowledge_id and import limits"}</Link></div>
    <div className="max-w-reading">{content.sections.map(s=><section key={s.id} id={s.id} aria-labelledby={`${s.id}-heading`} className="mt-6 scroll-mt-6"><h2 id={`${s.id}-heading`} className="text-title font-semibold">{s.title}</h2>{s.body.map((block,i)=><GuideContentBlock key={i} block={block} caption={s.title}/>)}</section>)}</div>
  </main>;
}
