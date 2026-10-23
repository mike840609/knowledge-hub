"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import type {MouseEvent} from "react";
import type {GuideLocale} from "@/components/imports/import-guide-content";

const labels:Record<GuideLocale,Record<string,string>>={
  "en":{"quick-start":"Quick start",sync:"Daily sync",troubleshooting:"Troubleshooting",reading:"Read and organize",insights:"Insights","sharing-export":"Share and export",
    example:"Example",checklist:"Checklist","titles-links":"Titles and links","knowledge-id":"Renames and knowledge_id",limits:"Limits"},
  "zh-TW":{"quick-start":"開始使用",sync:"日常同步",troubleshooting:"疑難排解",reading:"閱讀與整理",insights:"Insights","sharing-export":"分享與匯出",
    example:"完整範例",checklist:"檢查清單","titles-links":"標題與連結","knowledge-id":"改名與 knowledge_id",limits:"限制與略過"},
};

type NavSection={id:string;title:string};

/** The guide's chapters, then an optional reference group under its own label; one current position across both. */
export function UserGuideNavigation({sections,reference,locale}:{sections:NavSection[];reference?:{id:string;label:string;sections:NavSection[]};locale:GuideLocale}) {
  const all=useMemo(()=>[...sections,...(reference?.sections??[])],[sections,reference]);
  const [active,setActive]=useState(all[0]?.id);
  const mobile=useRef<HTMLDetailsElement>(null);
  const zh=locale==="zh-TW";

  useEffect(()=>{
    const nodes=all.map(section=>document.getElementById(section.id)).filter((node):node is HTMLElement=>!!node);
    if(!nodes.length)return;
    // The shell may scroll its content pane instead of the document.
    let scroller:HTMLElement|null=nodes[0].parentElement;
    while(scroller&&!/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))scroller=scroller.parentElement;
    const root=scroller??document.scrollingElement;
    const part=reference?document.getElementById(reference.id):null;
    const firstReference=nodes.find(node=>node.id===reference?.sections[0]?.id);
    let frame=0;
    const update=()=>{
      frame=0;
      const top=scroller?scroller.getBoundingClientRect().top:0;
      let current=nodes[0];
      for(const node of nodes)if(node.getBoundingClientRect().top<=top+96)current=node;
      // Reaching the reference part's own heading already means its first entry.
      if(part&&firstReference&&part.getBoundingClientRect().top<=top+96&&nodes.indexOf(current)<nodes.indexOf(firstReference))current=firstReference;
      const bottom=scroller?scroller.getBoundingClientRect().bottom:window.innerHeight;
      const last=nodes[nodes.length-1];
      // The final section can be fully visible before the pane's bottom padding;
      // at the bottom, a linked section still on screen keeps the highlight.
      if(root&&root.scrollHeight>root.clientHeight&&last.getBoundingClientRect().bottom<=bottom+2){
        const linked=nodes.find(node=>`#${node.id}`===location.hash)?.getBoundingClientRect().top;
        const shown=linked!==undefined&&linked>=top-2&&linked<bottom;
        current=shown?nodes.find(node=>`#${node.id}`===location.hash)!:last;
      }
      setActive(current.id);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const observer=new ResizeObserver(schedule);
    if(nodes[0].parentElement)observer.observe(nodes[0].parentElement);
    document.addEventListener("scroll",schedule,true);
    window.addEventListener("resize",schedule);
    window.addEventListener("hashchange",schedule);
    update();
    return ()=>{
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("scroll",schedule,true);
      window.removeEventListener("resize",schedule);
      window.removeEventListener("hashchange",schedule);
    };
  },[all,reference]);

  function navigate(event:MouseEvent<HTMLAnchorElement>,id:string,compact:boolean) {
    if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
    if(compact&&mobile.current)mobile.current.open=false;
    // Let native fragment navigation scroll/focus its target first.
    requestAnimationFrame(()=>document.getElementById(`${id}-heading`)?.focus({preventScroll:true}));
    setActive(id);
  }

  const list=(items:NavSection[],compact:boolean)=><ul className="space-y-1">{items.map(section=><li key={section.id}><a href={`#${section.id}`} onClick={event=>navigate(event,section.id,compact)} aria-current={active===section.id?"location":undefined} className={`kh-focus-ring block rounded-md px-2 py-2 text-body ${active===section.id?"bg-kh-bg-selected font-medium text-kh-primary":"text-kh-text-secondary hover:bg-kh-bg-subtle hover:text-kh-link"}`}>{labels[locale][section.id]??section.title}</a></li>)}</ul>;
  const links=(compact:boolean)=><>{list(sections,compact)}{reference?<><p className="mb-2 mt-4 border-t border-kh-border px-2 pt-4 text-body-sm font-medium text-kh-text-muted">{reference.label}</p>{list(reference.sections,compact)}</>:null}</>;
  return <>
    <nav aria-label={zh?"手冊章節":"Guide sections"} className="sticky top-6 hidden border-r border-kh-border pr-4 xl:block">
      <p className="mb-3 px-2 text-body-sm font-medium text-kh-text-muted">{zh?"本頁章節":"On this page"}</p>{links(false)}
    </nav>
    <details ref={mobile} className="rounded-md border border-kh-border px-4 py-3 xl:hidden">
      <summary className="kh-focus-ring cursor-pointer rounded-md text-body font-medium">{zh?"本頁章節":"On this page"}</summary>
      <nav aria-label={zh?"手冊章節":"Guide sections"} className="pt-3">{links(true)}</nav>
    </details>
  </>;
}
