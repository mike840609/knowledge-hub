import type { ReactNode } from "react";

/**
 * A key, as it is shown next to what it does. Inline chrome, so the `sm`
 * radius (contract §5); `text-faint`, because a hint is not content (§8).
 */
export function Kbd({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={`rounded-sm bg-kh-bg-subtle px-1 text-micro text-kh-text-faint ${className}`}>
      {children}
    </kbd>
  );
}
