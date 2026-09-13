import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`min-h-36 w-full rounded-md border border-kh-border bg-kh-bg px-3 py-2 font-mono text-sm text-kh-text shadow-sm outline-none ring-offset-2 placeholder:text-kh-text-muted focus:border-kh-accent focus-visible:ring-2 focus-visible:ring-kh-accent ${className}`} {...props} />;
}
