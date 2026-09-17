import { Button as BaseButton } from "@base-ui-components/react/button";
import type { ComponentProps } from "react";

const variantClasses = {
  primary: "border-transparent bg-kh-primary text-white hover:bg-kh-primary-hover",
  secondary: "border-kh-border bg-kh-bg text-kh-text hover:bg-kh-bg-hover",
};

type ButtonProps = ComponentProps<typeof BaseButton> & {
  variant?: keyof typeof variantClasses;
};

export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return <BaseButton className={`inline-flex min-h-10 items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]} ${className}`} {...props} />;
}
