"use client";
import {useEffect} from "react";
export function ReadRevisionMarker({workspaceId,documentId,revisionId}:{workspaceId:string;documentId:string;revisionId:string}){
 useEffect(()=>{const controller=new AbortController();void fetch(`/api/workspaces/${workspaceId}/documents/${documentId}/read`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({revisionId}),signal:controller.signal}).catch(()=>{});return()=>controller.abort();},[workspaceId,documentId,revisionId]);return null;
}
