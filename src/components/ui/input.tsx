import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`min-h-10 w-full rounded-md border border-kh-border bg-kh-bg px-3 py-2 text-sm text-kh-text outline-none ring-offset-2 placeholder:text-kh-text-muted focus:border-kh-accent focus-visible:ring-2 focus-visible:ring-kh-accent ${className}`} {...props} />;
}
