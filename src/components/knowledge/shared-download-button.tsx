"use client";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { downloadMarkdown } from "@/lib/download-markdown";
export function SharedDownloadButton({ title, markdown, metadata }: { title: string; markdown: string; metadata: Record<string, unknown> }) {
  return <Button variant="ghost" className="max-sm:px-2" onClick={async () => { const { exportMarkdown } = await import("@/lib/markdown-export"); downloadMarkdown(title, exportMarkdown({ title, markdown, metadata })); }}><Download className="size-4" aria-hidden="true" /><span className="max-sm:sr-only">Download<span className="sr-only"> Markdown</span></span></Button>;
}
