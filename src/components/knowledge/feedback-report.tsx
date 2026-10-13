"use client";
import { Dialog } from "@base-ui-components/react/dialog";
import type { RefObject } from "react";
import {useId, useState} from "react";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Label } from "@/components/ui/label";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
export function FeedbackReport({ open, onOpenChange, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: RefObject<HTMLElement | null> }){
  const id = useId();
  const [category,setCategory]=useState("Sync");const [description,setDescription]=useState("");const [saved,setSaved]=useState(false);
  const [sending,setSending]=useState(false);const [error,setError]=useState("");
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
    <Dialog.Popup finalFocus={returnFocus} className={dialogPopupClasses("max-h-[90dvh] w-[min(30rem,92vw)] overflow-y-auto text-kh-text")}>
    <Dialog.Title className="text-title font-semibold">Report a problem</Dialog.Title><div className="mt-3 space-y-3">
    <Dialog.Description className="text-body-sm text-kh-text-muted">Your report is sent to the maintainers with your employee ID and the page you are on. Document content is not included.</Dialog.Description>
    <Label htmlFor={`${id}-category`}>Category</Label><SelectMenu id={`${id}-category`} className="flex" value={category} onValueChange={value=>{setCategory(value);edited();}} options={["Sync","Search","Reading","Other"].map(value=>({value,label:value}))} />
    <Label htmlFor={`${id}-description`}>What happened?</Label><Textarea id={`${id}-description`} maxLength={5000} value={description} onChange={e=>{setDescription(e.target.value);edited();}} placeholder="Steps to reproduce, what you expected, and any error message" />
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><Button variant="secondary" disabled={!description.trim()||sending} onClick={()=>void send()}>{sending?"Sending…":"Send report"}</Button></div>
    {error?<p role="alert" className="text-body-sm text-kh-text">{error}</p>:null}
    {saved?<p role="status" className="text-caption text-kh-text-muted">Report sent. Thank you.</p>:null}
  </div></Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
