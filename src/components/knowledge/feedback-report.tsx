"use client";
import { Dialog } from "@base-ui-components/react/dialog";
import type { RefObject } from "react";
import {useId, useState} from "react";
import {feedbackReport} from "@/lib/feedback-report";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Label } from "@/components/ui/label";
import { dialogBackdropClasses, dialogPopupClasses } from "@/components/ui/dialog";
export function FeedbackReport({ open, onOpenChange, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; returnFocus?: RefObject<HTMLElement | null> }){
  const id = useId();
  const [category,setCategory]=useState("Sync");const [description,setDescription]=useState("");const [saved,setSaved]=useState(false);
  function download(){
    const blob=new Blob([feedbackReport(category,description,window.location.pathname)],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="knowledge-hub-feedback.md";link.click();URL.revokeObjectURL(url);setSaved(true);
  }
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal>
    <Dialog.Backdrop className={dialogBackdropClasses()} />
    <Dialog.Popup finalFocus={returnFocus} className={dialogPopupClasses("max-h-[90dvh] w-[min(30rem,92vw)] overflow-y-auto text-kh-text")}>
    <Dialog.Title className="text-title font-semibold">Report a problem</Dialog.Title><div className="mt-3 space-y-3">
    <Dialog.Description className="text-body-sm text-kh-text-muted">Download a Markdown report and send it to your maintainer. Nothing is submitted automatically; document content is not included.</Dialog.Description>
    <Label htmlFor={`${id}-category`}>Category</Label><SelectMenu id={`${id}-category`} className="flex" value={category} onValueChange={value=>{setCategory(value);setSaved(false);}} options={["Sync","Search","Reading","Other"].map(value=>({value,label:value}))} />
    <Label htmlFor={`${id}-description`}>What happened?</Label><Textarea id={`${id}-description`} maxLength={5000} value={description} onChange={e=>{setDescription(e.target.value);setSaved(false);}} placeholder="Steps to reproduce, what you expected, and any error message" />
    <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><Button variant="secondary" disabled={!description.trim()} onClick={download}>Download feedback report</Button></div>
    {saved?<p role="status" className="text-caption text-kh-text-muted">Report prepared for download. Send the file to your maintainer.</p>:null}
  </div></Dialog.Popup></Dialog.Portal></Dialog.Root>;
}
