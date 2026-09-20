import { Button as BaseButton } from "@base-ui-components/react/button";
import type { ComponentProps } from "react";

const variantClasses = {
  primary: "border-transparent bg-kh-primary text-kh-on-primary hover:bg-kh-primary-hover",
  secondary: "border-kh-border bg-kh-bg text-kh-text hover:bg-kh-bg-hover",
  ghost: "border-transparent bg-transparent text-kh-text-muted hover:bg-kh-bg-hover hover:text-kh-text",
  danger: "border-transparent bg-kh-danger text-kh-on-primary hover:bg-kh-danger-hover",
  link: "border-transparent bg-transparent text-kh-link underline underline-offset-2 hover:text-kh-text",
} as const;

/** Control heights. `md` is the shell default; `lg` is for page-level forms. */
const sizeClasses = {
  sm: "h-7 gap-1.5 px-2 text-body-sm",
  md: "h-8 gap-2 px-3 text-body",
  lg: "h-9 gap-2 px-4 text-body",
} as const;

const iconSizeClasses = {
  sm: "h-7 w-7",
  md: "h-8 w-8",
  lg: "h-9 w-9",
} as const;

export type ButtonVariant = keyof typeof variantClasses;
export type ButtonSize = keyof typeof sizeClasses;

export type ButtonAppearance = {
  variant?: ButtonVariant;
  /** Square, padding-free shape for icon-only controls. */
  icon?: boolean;
  size?: ButtonSize;
  className?: string;
};

/**
 * The button look, detached from the element. Links and anchors need the same
 * shape as a <button>, and routing them through Base UI's render prop to get
 * it costs more than it returns.
 */
export function buttonClasses({
  variant = "primary",
  size = "md",
  icon = false,
  className = "",
}: ButtonAppearance = {}): string {
  const shape = variant === "link"
    ? "h-auto gap-1 p-0 text-body"
    : icon
      ? iconSizeClasses[size]
      : sizeClasses[size];
  return `kh-focus-ring inline-flex shrink-0 items-center justify-center rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 ${shape} ${variantClasses[variant]} ${className}`;
}

type ButtonProps = ComponentProps<typeof BaseButton> & ButtonAppearance;

export function Button({ variant, size, icon, className, ...props }: ButtonProps) {
  return <BaseButton className={buttonClasses({ variant, size, icon, className })} {...props} />;
}
