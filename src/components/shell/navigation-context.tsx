"use client";
import { createContext } from "react";

/** Lets a link inside the narrow drawer close it. */
export const NavigationContext = createContext<{ closeNavigation: () => void } | null>(null);
