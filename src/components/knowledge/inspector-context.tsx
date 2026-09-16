"use client";

import { createContext } from "react";

export const InspectorContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);
