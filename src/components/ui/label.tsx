import type { LabelHTMLAttributes } from "react";

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={`mb-2 block text-body font-medium text-kh-text ${className}`} {...props} />;
}
