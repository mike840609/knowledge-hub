"use client";
import { createContext } from "react";

/** Mobile contextual navigation stays owned by its route and portals into the shell drawer. */
export const NavigationContext = createContext<{
  mobileExplorerTarget: HTMLElement | null;
  closeNavigation: () => void;
} | null>(null);
