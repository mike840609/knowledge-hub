"use client";

import { createContext } from "react";

export const GuidanceVisibilityContext = createContext<{
  dismissed: boolean;
  setDismissed: (dismissed: boolean) => void;
}>({ dismissed: false, setDismissed: () => {} });
