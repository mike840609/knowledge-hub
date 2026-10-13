"use client";
import { Dialog } from "@base-ui-components/react/dialog";
import type { RefObject } from "react";
import {useId, useState} from "react";
import {FEEDBACK_CATEGORIES,FEEDBACK_DESCRIPTION_MAX} from "@/modules/personal/domain/feedback-report";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Label } from "@/components/ui/label";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
export function FeedbackReport({ open, onOpenChange, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: RefObject<HTMLElement | null> }){
  const id = useId();
  const [category,setCategory]=useState("Sync");const [description,setDescription]=useState("");const [state,setState]=useState<"idle"|"sending"|"sent"|"failed">("idle");
  async function send(){
    setState("sending");
    const ok=await fetch("/api/feedback-reports",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({category,description,pagePath:window.location.pathname})}).then(response=>response.ok,()=>false);
    if(ok)setDescription("");
    setState(ok?"sent":"failed");
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Backdrop className={dialogBackdropClasses()} />
    <Dialog.Popup finalFocus={returnFocus} className={dialogPopupClasses("max-h-[90dvh] w-[min(30rem,92vw)] overflow-y-auto text-kh-text")}>
    <Dialog.Title className="text-title font-semibold">Report a problem</Dialog.Title><div className="mt-3 space-y-3">
    <Dialog.Description className="text-body-sm text-kh-text-muted">Your report is sent to the maintainers with your employee ID and this page’s address. Document content is not included.</Dialog.Description>
    <Label htmlFor={`${id}-category`}>Category</Label><SelectMenu id={`${id}-category`} className="flex" value={category} onValueChange={value=>{setCategory(value);setState("idle");}} options={FEEDBACK_CATEGORIES.map(value=>({value,label:value}))} />
    <Label htmlFor={`${id}-description`}>What happened?</Label><Textarea id={`${id}-description`} maxLength={FEEDBACK_DESCRIPTION_MAX} value={description} onChange={e=>{setDescription(e.target.value);setState("idle");}} placeholder="Steps to reproduce, what you expected, and any error message" />
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><Button variant="secondary" disabled={!description.trim()||state==="sending"} onClick={send}>Send report</Button></div>
    <p role="status" className="text-caption text-kh-text-muted">{state==="sent"?"Report sent. Thank you.":state==="failed"?"The report could not be sent. Try again.":""}</p>
  </div></Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
