"use client";
import {Button} from "@/components/ui/button";
export default function ProfileError({reset}:{reset:()=>void}){return <main className="kh-page py-10"><h1 className="text-lg font-medium">Statistics are temporarily unavailable</h1><p className="mt-3 text-body text-kh-text-muted">Your knowledge is still available. Try loading your overview again.</p><Button className="mt-5" variant="secondary" onClick={reset}>Try again</Button></main>;}
