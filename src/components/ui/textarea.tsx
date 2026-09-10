import type { TextareaHTMLAttributes } from "react";

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`min-h-36 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm shadow-sm outline-none ring-offset-2 placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent ${className}`} {...props} />;
}
