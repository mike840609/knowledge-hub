import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger";

const variantClasses: Record<BadgeVariant, string> = {
  default: "border-transparent bg-kh-bg-hover text-kh-text",
  secondary: "border-transparent bg-kh-bg-hover text-kh-text",
  outline: "border-kh-border bg-kh-bg text-kh-text-muted",
  success: "border-transparent bg-kh-bg-hover text-kh-success",
  warning: "border-transparent bg-kh-bg-hover text-kh-warning",
  danger: "border-transparent bg-kh-bg-hover text-kh-danger",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ variant = "default", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-caption font-medium ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
