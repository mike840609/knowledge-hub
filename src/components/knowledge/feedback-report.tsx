"use client";
import {useState} from "react";
import {feedbackReport} from "@/lib/feedback-report";
import {Button} from "@/components/ui/button";
import {Textarea} from "@/components/ui/textarea";
import { SelectMenu } from "@/components/ui/select-menu";
import { Label } from "@/components/ui/label";
export function FeedbackReport(){
  const [category,setCategory]=useState("Sync");const [description,setDescription]=useState("");const [saved,setSaved]=useState(false);
  function download(){
    const blob=new Blob([feedbackReport(category,description,window.location.pathname)],{type:"text/markdown;charset=utf-8"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download="knowledge-hub-feedback.md";link.click();URL.revokeObjectURL(url);setSaved(true);
  }
  return <details className="rounded-md border border-kh-border p-3"><summary className="kh-focus-ring cursor-pointer rounded-md text-body">Report a problem</summary><div className="mt-3 space-y-3">
    <p className="text-caption text-kh-text-muted">Download a Markdown report and send it to your maintainer. Nothing is submitted automatically; document content is not included.</p>
    <Label htmlFor="feedback-category">Category</Label><SelectMenu id="feedback-category" className="flex" value={category} onValueChange={value=>{setCategory(value);setSaved(false);}} options={["Sync","Search","Reading","Other"].map(value=>({value,label:value}))} />
    <Label htmlFor="feedback-description">What happened?</Label><Textarea id="feedback-description" maxLength={5000} value={description} onChange={e=>{setDescription(e.target.value);setSaved(false);}} placeholder="Steps to reproduce, what you expected, and any error message" />
    <Button variant="secondary" disabled={!description.trim()} onClick={download}>Download feedback report</Button>
    {saved?<p className="text-caption text-kh-text-muted">Report prepared for download. Send the file to your maintainer.</p>:null}
  </div></details>;
}
