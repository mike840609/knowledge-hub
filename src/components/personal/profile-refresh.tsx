"use client";
import {useTransition} from "react";
import {useRouter} from "next/navigation";
import {RefreshCw} from "lucide-react";
import {Button} from "@/components/ui/button";
export function ProfileRefresh(){const router=useRouter();const [pending,startTransition]=useTransition();return <Button type="button" variant="ghost" disabled={pending} aria-label="Refresh statistics" onClick={()=>startTransition(()=>router.refresh())}><RefreshCw size={13} className={pending?"animate-spin motion-reduce:animate-none":""} aria-hidden="true"/><span className="text-caption">{pending?"Refreshing…":"Refresh"}</span></Button>;}
