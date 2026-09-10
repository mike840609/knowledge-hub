import type { InputHTMLAttributes } from "react";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`min-h-10 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none ring-offset-2 placeholder:text-slate-400 focus:border-accent focus:ring-2 focus:ring-accent ${className}`} {...props} />;
}
