"use client";

import { createContext, type Dispatch, type SetStateAction } from "react";

export type DocumentTopbarState = {
  pathname: string;
  title: string;
  visible: boolean;
  onDetailsClick: () => void;
};

export const DocumentTopbarContext = createContext<{
  document: DocumentTopbarState | null;
  setDocument: Dispatch<SetStateAction<DocumentTopbarState | null>>;
} | null>(null);
