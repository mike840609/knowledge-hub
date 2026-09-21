import type { TextareaHTMLAttributes } from "react";
import type { ControlSize } from "./control";
import { fieldClasses } from "./field";

export function Textarea({
  className = "",
  size = "md",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: ControlSize }) {
  return (
    <textarea
      className={fieldClasses({ size, multiline: true, className: `min-h-36 w-full font-mono ${className}` })}
      {...props}
    />
  );
}
