"use client";

import { createContext, type Dispatch, type SetStateAction } from "react";

export type DocumentTopbarState = {
  pathname: string;
  title: string;
  visible: boolean;
  onDetailsClick: () => void;
  /**
   * Opens the share-link dialog; null where sharing is not offered. The
   * document pane decides this from the registry, so the topbar never
   * re-derives the rule — it only keeps the action reachable once the
   * header has scrolled away.
   */
  onShareClick: (() => void) | null;
  /**
   * What the command palette needs in order to offer actions on the document
   * being read. It travels with the topbar state because the palette lives in
   * the topbar and the document pane is the only thing that knows these facts
   * — the route is where the document *is*, not what may be done to it.
   */
  target: {
    documentId: string;
    sourceId: string;
    label: string;
    ownership: "SOURCE_MANAGED" | "HUB_MANAGED";
    status: "ACTIVE" | "ARCHIVED";
    revision: "CURRENT" | "HISTORICAL";
  };
};

export const DocumentTopbarContext = createContext<{
  document: DocumentTopbarState | null;
  setDocument: Dispatch<SetStateAction<DocumentTopbarState | null>>;
} | null>(null);
