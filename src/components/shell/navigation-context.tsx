"use client";
import { createContext } from "react";

/** Contextual navigation stays owned by its route and portals into the shell. */
export const NavigationContext = createContext<{
  explorerTarget: HTMLElement | null;
  mobileExplorerTarget: HTMLElement | null;
  closeNavigation: () => void;
} | null>(null);
