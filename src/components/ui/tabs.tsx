"use client";

import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentProps, ReactNode } from "react";

export function TabsRoot({ ...props }: ComponentProps<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...props} />;
}

export function TabsList({ className = "", ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={`flex items-center gap-1 border-b border-kh-border ${className}`}
      {...props}
    />
  );
}

export function TabsTab({
  className = "",
  children,
  ...props
}: ComponentProps<typeof BaseTabs.Tab> & { children: ReactNode }) {
  return (
    <BaseTabs.Tab
      className={`-mb-px border-b-2 border-transparent px-3 py-2 text-[13px] font-medium text-kh-text-muted transition hover:text-kh-text focus:outline-none focus-visible:ring-2 focus-visible:ring-kh-focus data-[selected]:border-kh-primary data-[selected]:text-kh-selected-text ${className}`}
      {...props}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export function TabsPanel({ className = "", ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={`py-3 focus:outline-none ${className}`} {...props} />;
}
