"use client";
import { Dialog } from "@base-ui-components/react/dialog";
import type { RefObject } from "react";
import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  type FeedbackCategory,
  type FeedbackStatus,
} from "@/modules/personal/domain/feedback-report";
import type { FeedbackIssuePage } from "@/modules/personal/application/feedback-report-query-service";
import { Label } from "@/components/ui/label";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
import { DialogCloseButton } from "@/components/ui/dialog-close";
import { TabsList, TabsPanel, TabsRoot, TabsTab } from "@/components/ui/tabs";
import { FeedbackIssues, FEEDBACK_ISSUE_STATUS_PRESENTATION } from "@/components/knowledge/feedback-issues";

type Tab = "report" | "issues";
type StatusFilter = FeedbackStatus | "all";

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  ...FEEDBACK_STATUSES.map((value) => ({ value, label: FEEDBACK_ISSUE_STATUS_PRESENTATION[value].label })),
];

/**
 * One panel, two faces: write a report, or read the board. Neither leaves the
 * page, and closing it at any point is enough — nothing here is a route or a
 * Workspace surface.
 */
export function FeedbackReport({ empId, open, onOpenChange, returnFocus }: { empId: string; open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: RefObject<HTMLElement | null> }){
  const id = useId();
  const [tab, setTab] = useState<Tab>("report");
  const [category,setCategory]=useState<FeedbackCategory>("Sync");const [description,setDescription]=useState("");const [saved,setSaved]=useState(false);
  const [sending,setSending]=useState(false);const [error,setError]=useState("");
  const [status,setStatus]=useState<StatusFilter>("all");const [mine,setMine]=useState(false);
  const [items,setItems]=useState<FeedbackIssuePage["items"]>([]);const [nextCursor,setNextCursor]=useState<FeedbackIssuePage["nextCursor"]>(null);
  const [listState,setListState]=useState<"idle"|"loading"|"ready"|"error">("idle");const [loadingMore,setLoadingMore]=useState(false);
  const [listVersion,setListVersion]=useState(0);

  // Reopening always starts at the form; the list is fetched afresh when its tab is shown.
  useEffect(() => { if (!open) setTab("report"); }, [open]);

  useEffect(() => {
    if (!open || tab !== "issues") return;
    const controller = new AbortController();
    setListState("loading");setItems([]);setNextCursor(null);
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (mine) params.set("mine", "true");
    fetch(`/api/feedback-reports?${params}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load reports.");
        return (await response.json()) as FeedbackIssuePage;
      })
      .then((page) => { setItems(page.items);setNextCursor(page.nextCursor);setListState("ready"); })
      .catch((failure: unknown) => {
        if (failure instanceof DOMException && failure.name === "AbortError") return;
        setListState("error");
      });
    return () => controller.abort();
  }, [open, tab, status, mine, listVersion]);

  async function loadMore(){
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (mine) params.set("mine", "true");
    params.set("beforeAt", nextCursor.createdAt);params.set("beforeId", nextCursor.id);
    try {
      const response = await fetch(`/api/feedback-reports?${params}`);
      if (!response.ok) throw new Error("Could not load reports.");
      const page = (await response.json()) as FeedbackIssuePage;
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch { setListState("error"); }
    finally { setLoadingMore(false); }
  }

  async function send(){
    setSending(true);setError("");
    try {
      // Who is reporting is decided on the server from the signed-in caller; the browser sends only what was typed and where.
      const response=await fetch("/api/feedback-reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category,description,pagePath:window.location.pathname})});
      if (!response.ok) { const body=await response.json().catch(()=>null); throw new Error(body?.error?.message??"Could not send the report. Try again."); }
      setSaved(true);setDescription("");
    } catch (failure) {setError(failure instanceof Error?failure.message:"Could not send the report. Try again.");}
    finally {setSending(false);}
  }
  function edited(){setSaved(false);setError("");}
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Backdrop className={dialogBackdropClasses()} />
    <Dialog.Popup finalFocus={returnFocus} className={dialogPopupClasses("max-h-[90dvh] w-[min(40rem,94vw)] overflow-y-auto text-kh-text")}>
    <Dialog.Title className="text-title font-semibold">Report a problem</Dialog.Title><div className="mt-3 space-y-3">
    <Dialog.Description className="text-body-sm text-kh-text-muted">Your report appears on the shared Issues board with your name, employee ID and the page you are on. Document content is not included.</Dialog.Description>
    <TabsRoot value={tab} onValueChange={(value) => setTab(value as Tab)}>
      <TabsList aria-label="Report a problem">
        <TabsTab value="report">Report</TabsTab>
        <TabsTab value="issues">Issues</TabsTab>
      </TabsList>
      <TabsPanel value="report" className="space-y-3">
        {/* Shown so the reporter sees what is attached; the server still takes it from the signed-in caller, never from this field.
            Out of the tab order: nothing to do there, and the dialog's first focus belongs to Category. */}
        <div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-3 gap-y-3">
          <Label htmlFor={`${id}-emp`}>Employee ID</Label><Label htmlFor={`${id}-category`}>Category</Label>
          <Input id={`${id}-emp`} readOnly tabIndex={-1} value={empId} className="cursor-not-allowed read-only:bg-kh-bg-sunken read-only:text-kh-text-muted" />
          <SelectMenu id={`${id}-category`} className="flex" value={category} onValueChange={value=>{setCategory(value);edited();}} options={FEEDBACK_CATEGORIES.map(value=>({value,label:value}))} />
        </div>
        <Label htmlFor={`${id}-description`}>What happened?</Label><Textarea id={`${id}-description`} maxLength={5000} value={description} onChange={e=>{setDescription(e.target.value);edited();}} placeholder="Steps to reproduce, what you expected, and any error message" />
        <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><Button variant="secondary" disabled={!description.trim()||sending} onClick={()=>void send()}>{sending?"Sending…":"Send report"}</Button></div>
        {error?<p role="alert" className="text-body-sm text-kh-text">{error}</p>:null}
        {saved?<p role="status" className="text-caption text-kh-text-muted">Report sent. Thank you.</p>:null}
      </TabsPanel>
      <TabsPanel value="issues" className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Label inline>Status<SelectMenu aria-label="Status" value={status} onValueChange={value=>setStatus(value as StatusFilter)} options={STATUS_OPTIONS} /></Label>
          <label className="flex min-h-8 items-center gap-2 text-body-sm">
            <input type="checkbox" checked={mine} onChange={(event)=>setMine(event.target.checked)} />
            Mine only
          </label>
        </div>
        {listState === "loading" ? <p role="status" className="text-body-sm text-kh-text-muted">Loading reports…</p> : null}
        {listState === "error" ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-body-sm text-kh-text">Could not load reports.</p>
            <Button variant="secondary" onClick={()=>setListVersion((value)=>value+1)}>Try again</Button>
          </div>
        ) : null}
        {listState === "ready" ? (
          <>
            <div className="max-h-[50dvh] overflow-y-auto">
              <FeedbackIssues items={items} filtered={status !== "all" || mine} />
            </div>
            {nextCursor ? (
              <Button variant="secondary" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore ? "Loading…" : "Load more"}</Button>
            ) : null}
          </>
        ) : null}
        <div className="flex flex-wrap items-center justify-end gap-2"><Button variant="ghost" onClick={()=>setTab("report")}>Report a problem</Button><Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button></div>
      </TabsPanel>
    </TabsRoot>
  </div><DialogCloseButton /></Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
