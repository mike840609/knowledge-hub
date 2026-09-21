"use client";

import { Tabs as BaseTabs } from "@base-ui-components/react/tabs";
import type { ComponentProps, ReactNode } from "react";
import { selectableTabClasses, tabListClasses } from "./tab";

export function TabsRoot({ ...props }: ComponentProps<typeof BaseTabs.Root>) {
  return <BaseTabs.Root {...props} />;
}

export function TabsList({ className = "", ...props }: ComponentProps<typeof BaseTabs.List>) {
  return (
    <BaseTabs.List
      className={`${tabListClasses} ${className}`}
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
      className={`${selectableTabClasses} ${className}`}
      {...props}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export function TabsPanel({ className = "", ...props }: ComponentProps<typeof BaseTabs.Panel>) {
  return <BaseTabs.Panel className={`kh-focus-ring py-3 ${className}`} {...props} />;
}
