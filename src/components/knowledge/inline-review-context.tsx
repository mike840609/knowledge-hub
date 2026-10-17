"use client";

import { createContext } from "react";
import type { ReviewAnchor } from "@/modules/knowledge/domain/document-review";

export type CaptureReviewAnchor = (markdown: string) => ReviewAnchor | null;
export type PreparedReviewComment = { anchor: ReviewAnchor; markdown: string; save: () => Promise<string> };
export const InlineReviewContext = createContext<{
  available: boolean;
  request: (capture: CaptureReviewAnchor) => void;
} | null>(null);
