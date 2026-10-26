import type { ComponentProps } from "react";
import type { ControlSize } from "./control";
import { fieldClasses } from "./field";

export function Input({
  className = "",
  size = "md",
  ...props
}: Omit<ComponentProps<"input">, "size"> & { size?: ControlSize }) {
  return <input className={fieldClasses({ size, className: `w-full ${className}` })} {...props} />;
}
