import type { HTMLAttributes } from "react";

type BadgeVariant = "default" | "secondary" | "outline" | "success" | "warning" | "danger";

/**
 * Status variants carry a tinted background, not just a text colour. Sharing
 * one neutral fill made success, warning and danger scan identically.
 */
const variantClasses: Record<BadgeVariant, string> = {
  default: "border-transparent bg-kh-bg-hover text-kh-text",
  secondary: "border-transparent bg-kh-bg-subtle text-kh-text-muted",
  outline: "border-kh-border bg-kh-bg text-kh-text-muted",
  success: "border-kh-success-border bg-kh-success-bg text-kh-success",
  warning: "border-kh-warning-border bg-kh-warning-bg text-kh-warning",
  danger: "border-kh-danger-border bg-kh-danger-bg text-kh-danger",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
};

export function Badge({ variant = "default", className = "", ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-sm border px-1.5 py-0.5 text-caption font-medium ${variantClasses[variant]} ${className}`}
      {...props}
    />
  );
}
