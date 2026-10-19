import type { ReactNode } from "react";

/**
 * A key, as it is shown next to what it does. Inline chrome, so the `sm`
 * radius (contract §5); `text-muted`, so a small action hint remains readable (§8).
 */
export function Kbd({ children, size = "sm", className = "" }: { children: ReactNode; size?: "sm" | "md"; className?: string }) {
  // `md` sits in a 40px field, where the 11px hint read as too small beside 14px text.
  const scale = size === "md" ? "px-1.5 py-0.5 text-body-sm" : "px-1 text-micro";
  return (
    <kbd className={`rounded-sm bg-kh-bg-subtle ${scale} text-kh-text-muted ${className}`}>
      {children}
    </kbd>
  );
}
