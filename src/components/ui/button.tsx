import { Button as BaseButton } from "@base-ui-components/react/button";
import type { ComponentProps } from "react";

export function Button({ className = "", ...props }: ComponentProps<typeof BaseButton>) {
  return <BaseButton className={`inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition hover:bg-teal-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`} {...props} />;
}
