"use client";

import { useEffect, useRef, useState, type DragEvent, type RefObject } from "react";
import { dropPlacement, moveDestinations, type DropZone } from "@/lib/knowledge-navigation";
import type { KnowledgeTreeItem } from "@/modules/knowledge/application/knowledge-query-service";
import { CLEAR_FILTER_TO_REORDER, placedNode } from "./organize-messages";
import type { MoveNodeInput } from "./use-tree-mutations";

export type TreeDragIndicator = { kind: "line"; top: number; left: number; width: number } | { kind: "into"; nodeId: string } | null;

type Input = {
  items: KnowledgeTreeItem[]; filtering: boolean; canMove: (id: string) => boolean; isKeyboardBusy: () => boolean; onDragStarted: () => void;
  isCollapsed: (id: string) => boolean; onReorder: (input: { nodeId: string; position: number }) => Promise<boolean>;
  onMove: (input: MoveNodeInput) => Promise<boolean>; onPlaced: (id: string, parentId: string | null, refreshed: boolean) => void;
  onRefreshed: (id: string) => void;
  announce: (text: string) => void; expandFolder: (id: string) => void; treeRef: RefObject<HTMLUListElement | null>;
};

export function useTreeDrag(input: Input) {
  const [enabled, setEnabled] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [indicator, setIndicator] = useState<TreeDragIndicator>(null);
  const dragging = useRef<string | null>(null);
  const destinations = useRef<ReadonlySet<string>>(new Set());
  const busy = useRef(false);
  const operation = useRef(0);
  const expected = useRef<{ id: string; parentId: string | null; position: number | undefined; oldParent: string | null; oldPosition: number } | null>(null);
  const awaitingResponse = useRef(false);
  const refreshed = useRef(false);
  const focusWaiting = useRef(false);
  const pointerY = useRef<number | null>(null);
  const frame = useRef<number | undefined>(undefined);
  const expandTimer = useRef<number | undefined>(undefined);
  const expandFor = useRef<string | null>(null);
  const giveUp = useRef<number | undefined>(undefined);
  const clearExpand = () => { window.clearTimeout(expandTimer.current); expandFor.current = null; };
  const cleanup = () => {
    dragging.current = null; pointerY.current = null; setDraggingId(null); setIndicator(null);
    window.cancelAnimationFrame(frame.current ?? 0); clearExpand();
  };
  useEffect(() => {
    setEnabled(typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
    return () => { window.cancelAnimationFrame(frame.current ?? 0); window.clearTimeout(expandTimer.current); window.clearTimeout(giveUp.current); };
  }, []);
  useEffect(() => {
    const wanted = expected.current;
    const row = wanted && input.items.find((item) => item.id === wanted.id);
    const changed = row && wanted && (row.parentId !== wanted.oldParent || row.position !== wanted.oldPosition);
    const appended = wanted?.position === undefined || wanted.position === Number.MAX_SAFE_INTEGER;
    const atDestination = row && wanted && row.parentId === wanted.parentId && (appended
      ? input.items.every((item) => item.parentId !== wanted.parentId || item.id === row.id || item.position < row.position)
      : row.position === wanted.position);
    if (changed && atDestination) {
      if (awaitingResponse.current) refreshed.current = true;
      else if (focusWaiting.current && wanted) {
        focusWaiting.current = false;
        busy.current = false;
        window.clearTimeout(giveUp.current);
        input.onRefreshed(wanted.id);
      }
    }
  }, [input.items]);
  const zoneFor = (event: DragEvent<HTMLElement>, item: KnowledgeTreeItem): DropZone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    if (item.type === "folder" && item.status !== "ARCHIVED") return ratio < 0.25 ? "before" : ratio > 0.75 ? "after" : "into";
    return ratio < 0.5 ? "before" : "after";
  };
  const scroll = () => {
    if (!dragging.current) return;
    const nav = input.treeRef.current?.closest("nav");
    if (nav && pointerY.current !== null) {
      const rect = nav.getBoundingClientRect();
      if (pointerY.current >= rect.top && pointerY.current < rect.top + 24) nav.scrollTop -= 12;
      else if (pointerY.current <= rect.bottom && pointerY.current > rect.bottom - 24) nav.scrollTop += 12;
    }
    frame.current = window.requestAnimationFrame(scroll);
  };
  const rowProps = (nodeId: string) => ({
    draggable: enabled && input.canMove(nodeId),
    "data-row-node-id": nodeId,
    onDragStart: (event: DragEvent<HTMLElement>) => {
      if (!enabled || busy.current || input.isKeyboardBusy() || !input.canMove(nodeId) || input.filtering) {
        event.preventDefault(); if (input.filtering) input.announce(CLEAR_FILTER_TO_REORDER); return;
      }
      operation.current++;
      focusWaiting.current = false;
      input.onDragStarted();
      event.stopPropagation(); event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-kh-tree-node", nodeId);
      destinations.current = new Set(moveDestinations(input.items, nodeId).map((destination) => destination.id));
      dragging.current = nodeId; setDraggingId(nodeId); frame.current = window.requestAnimationFrame(scroll);
    },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!dragging.current || busy.current) return;
      event.stopPropagation(); event.preventDefault(); event.dataTransfer.dropEffect = "move";
      pointerY.current = event.clientY;
      const item = input.items.find((entry) => entry.id === nodeId);
      if (!item) return;
      const zone = zoneFor(event, item);
      if (!dropPlacement(input.items, dragging.current, nodeId, zone, destinations.current)) { setIndicator(null); clearExpand(); return; }
      const rect = event.currentTarget.getBoundingClientRect();
      if (zone === "into") {
        setIndicator({ kind: "into", nodeId });
        if (input.isCollapsed(nodeId) && expandFor.current !== nodeId) {
          clearExpand(); expandFor.current = nodeId;
          expandTimer.current = window.setTimeout(() => { input.expandFolder(nodeId); expandFor.current = null; }, 500);
        }
      } else {
        clearExpand();
        const bottom = item.type === "folder" ? event.currentTarget.closest("[data-node-id]")?.getBoundingClientRect().bottom ?? rect.bottom : rect.bottom;
        setIndicator({ kind: "line", top: zone === "before" ? rect.top : bottom, left: rect.left, width: rect.width });
      }
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
      setIndicator(null); clearExpand(); pointerY.current = null;
    },
    onDrop: async (event: DragEvent<HTMLElement>) => {
      if (!dragging.current || busy.current) return;
      event.stopPropagation(); event.preventDefault();
      if (input.isKeyboardBusy()) { cleanup(); return; }
      const source = input.items.find((entry) => entry.id === dragging.current);
      const target = input.items.find((entry) => entry.id === nodeId);
      if (!source || !target) { cleanup(); return; }
      const zone = zoneFor(event, target);
      const placement = dropPlacement(input.items, source.id, target.id, zone, destinations.current);
      if (!placement) { cleanup(); return; }
      busy.current = true; awaitingResponse.current = true; refreshed.current = false;
      expected.current = { id: source.id, parentId: placement.kind === "move" ? placement.parentId : source.parentId,
        position: placement.position, oldParent: source.parentId, oldPosition: source.position };
      const currentOperation = operation.current;
      giveUp.current = window.setTimeout(() => {
        if (operation.current === currentOperation) busy.current = false;
      }, 3000);
      let succeeded = false;
      try {
        const parentId = placement.kind === "move" ? placement.parentId : source.parentId;
        const ok = placement.kind === "reorder"
          ? await input.onReorder({ nodeId: source.id, position: placement.position })
          : await input.onMove({ nodeId: source.id, label: source.label, from: { parentId: source.parentId, position: source.position }, to: { parentId, label: input.items.find((entry) => entry.id === parentId)?.label ?? null, position: placement.position } });
        if (operation.current !== currentOperation) return;
        succeeded = ok;
        if (ok && !refreshed.current) focusWaiting.current = true;
        if (ok) { if (placement.kind === "reorder") input.announce(placedNode(source.label, placement.index, placement.count)); input.onPlaced(source.id, parentId, refreshed.current); }
      } finally {
        if (operation.current === currentOperation) {
          awaitingResponse.current = false;
          if (!succeeded || refreshed.current) { window.clearTimeout(giveUp.current); busy.current = false; }
          cleanup();
        }
      }
    },
    onDragEnd: () => cleanup(),
  });
  return { rowProps, indicator, draggingId, isBusy: () => busy.current || dragging.current !== null,
    invalidatePending: () => { operation.current++; focusWaiting.current = false; } };
}
