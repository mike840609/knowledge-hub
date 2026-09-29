"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minus, Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { adjacency, LABEL_PX, matchesQuery, nodeLabel, selectVisibleLabels, type GraphViewData, type GraphViewNode } from "./graph-model";

type View = { k: number; x: number; y: number };
const HOME: View = { k: 1, x: 0, y: 0 };
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 6;
const ZOOM_STEP = 1.3;

/** A point on screen, in the drawing's own coordinates. */
function toDrawing(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
  return { x: point.x, y: point.y };
}

function plainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** One path for a set of edges: a thousand `<line>`s is a thousand elements to restyle on hover; this is one. */
function edgePath(edges: readonly { from: string; to: string }[], at: ReadonlyMap<string, GraphViewNode>): string {
  const parts: string[] = [];
  for (const edge of edges) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (from && to) parts.push(`M${from.x} ${from.y}L${to.x} ${to.y}`);
  }
  return parts.join("");
}

/**
 * A node's card, shown while it is hovered or focused: what it is, where it
 * lives, how connected it is. A floating surface, so it is the one place on
 * the canvas that takes `lg` radius, a border and the popover elevation
 * (design language §5, §6); it never takes pointer events, so it cannot get
 * between the reader and the graph.
 */
function NodeCard({ node, left, top, below }: { node: GraphViewNode; left: number; top: number; below: boolean }) {
  const unresolved = node.kind === "UNRESOLVED";
  return (
    <div
      role="tooltip"
      data-graph-card
      style={{ left, top }}
      className={`pointer-events-none absolute z-10 max-w-64 rounded-lg border border-kh-border bg-kh-bg px-2.5 py-1.5 shadow-popover ${
        below ? "-translate-x-1/2" : "-translate-x-1/2 -translate-y-full"
      }`}
    >
      <p className="truncate text-body-sm font-medium text-kh-text">{node.title}</p>
      <p className="mt-0.5 flex items-center gap-1.5 text-caption tabular-nums text-kh-text-muted">
        {unresolved ? (
          <span>No document yet · linked from {node.inDegree}</span>
        ) : (
          <>
            {node.sourceName ? <span className="truncate">{node.sourceName}</span> : null}
            {node.sourceName ? <span aria-hidden="true">·</span> : null}
            <span>{node.inDegree} in</span>
            <span aria-hidden="true">·</span>
            <span>{node.outDegree} out</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The graph, drawn. Positions arrive finished from the server; this only
 * paints them and lets the reader move around (pan, zoom) and look (hover to
 * see a node's neighbours, type to find one).
 *
 * The drawing is quiet on purpose (design language §2: low decoration,
 * restrained colour). At rest it is neutral: small dots and hairlines in the
 * theme's own greys. The one accent means "this, and what it is connected
 * to" — the node under the pointer or the document being read, and its
 * neighbours — and everything else steps back rather than everything shouting.
 * Colour comes from the token layer only, so it follows light and dark.
 *
 * Every node is an anchor, so it is a real link: focusable, reachable by Tab in
 * the order the server sent (best-connected first), openable in a new tab.
 */
export function GraphCanvas({
  data,
  focusId = null,
  query = "",
  interactive = true,
  ariaLabel,
}: {
  data: GraphViewData;
  /** The document being read: drawn as the one to look at. */
  focusId?: string | null;
  query?: string;
  /** Pan, zoom and their controls. Off for the small graph in the inspector. */
  interactive?: boolean;
  ariaLabel: string;
}) {
  const router = useRouter();
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pxPerUnit, setPxPerUnit] = useState<number | null>(null);
  const [card, setCard] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const drag = useRef<{ pointerId: number; last: { x: number; y: number } } | null>(null);

  const positions = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);
  const neighbours = useMemo(() => adjacency(data.edges), [data.edges]);
  const searching = query.trim() !== "";
  const matches = useMemo(() => new Set(data.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id)), [data.nodes, query]);
  const emphasised = hovered ?? focusId;
  const emphasisedSet = useMemo(
    () => (emphasised ? new Set([emphasised, ...(neighbours.get(emphasised) ?? [])]) : null),
    [emphasised, neighbours],
  );
  const unlinkedCount = useMemo(() => data.nodes.filter((node) => node.kind === "DOCUMENT" && node.inDegree + node.outDegree === 0).length, [data.nodes]);
  const hasUnresolved = useMemo(() => data.nodes.some((node) => node.kind === "UNRESOLVED"), [data.nodes]);

  // How many screen pixels one unit of the drawing is, for label size. Measured
  // after mount, so the server render has no labels rather than wrong-sized ones.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) setPxPerUnit(Math.min(rect.width / data.width, rect.height / data.height));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [data.width, data.height]);

  const zoomAt = useCallback((clientX: number | null, clientY: number | null, factor: number) => {
    const svg = svgRef.current;
    setView((current) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.k * factor));
      if (!svg || k === current.k) return current;
      const centre = clientX === null || clientY === null
        ? { x: data.width / 2, y: data.height / 2 }
        : toDrawing(svg, clientX, clientY);
      // Keep the point under the cursor where it is.
      return { k, x: centre.x - (centre.x - current.x) * (k / current.k), y: centre.y - (centre.y - current.y) * (k / current.k) };
    });
  }, [data.width, data.height]);

  // A wheel listener has to be non-passive to stop the page scrolling under it.
  useEffect(() => {
    const svg = svgRef.current;
    if (!interactive || !svg) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [interactive, zoomAt]);

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!interactive || event.button !== 0 || (event.target as Element).closest("a")) return;
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, last: toDrawing(svg, event.clientX, event.clientY) };
  };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    const svg = svgRef.current;
    if (!active || !svg || active.pointerId !== event.pointerId) return;
    const point = toDrawing(svg, event.clientX, event.clientY);
    const dx = point.x - active.last.x;
    const dy = point.y - active.last.y;
    active.last = point;
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };
  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  // The same three keys the controls advertise; the container hears them from
  // whichever node or button inside it has focus.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") zoomAt(null, null, ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") zoomAt(null, null, 1 / ZOOM_STEP);
    else if (event.key === "0") setView(HOME);
    else return;
    event.preventDefault();
  };

  const scale = pxPerUnit === null ? null : pxPerUnit * view.k;

  // Which labels there is room for at this zoom (graph-model.selectVisibleLabels).
  const visibleLabels = useMemo(() => {
    if (scale === null) return new Set<string>();
    const forced = new Set<string>();
    if (focusId) forced.add(focusId);
    if (hovered) forced.add(hovered);
    const boosted = new Set<string>();
    if (emphasisedSet) for (const id of emphasisedSet) boosted.add(id);
    if (searching) for (const id of matches) boosted.add(id);
    return selectVisibleLabels(data.nodes, { pxPerUnit: scale, forced, boosted });
  }, [scale, data.nodes, focusId, hovered, emphasisedSet, searching, matches]);

  // Where the card goes: on screen, beside the hovered node, wherever pan and
  // zoom have put it. Read from the DOM after layout, so it is never a frame behind.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const svg = svgRef.current;
    const node = hovered ? positions.get(hovered) : undefined;
    if (!frame || !svg || !node || scale === null) {
      setCard(null);
      return;
    }
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(node.x * view.k + view.x, node.y * view.k + view.y).matrixTransform(matrix);
    const box = frame.getBoundingClientRect();
    const reach = node.radius * scale + 10;
    const left = Math.min(Math.max(point.x - box.left, 100), Math.max(box.width - 100, 100));
    const y = point.y - box.top;
    const below = y < 84;
    setCard({ left, top: below ? y + reach : y - reach, below });
  }, [hovered, positions, view, scale]);

  const lit = (id: string) => emphasisedSet !== null && emphasisedSet.has(id);
  const litEdges = data.edges.filter((edge) => (emphasised !== null && (edge.from === emphasised || edge.to === emphasised)) || (searching && matches.has(edge.from) && matches.has(edge.to)));
  const restEdges = data.edges.filter((edge) => !litEdges.includes(edge));
  const restPath = useMemo(() => edgePath(restEdges, positions), [restEdges, positions]);
  const litPath = useMemo(() => edgePath(litEdges, positions), [litEdges, positions]);
  const stepBack = emphasisedSet !== null || searching;

  const labelSize = scale === null ? null : LABEL_PX / scale;
  const cardNode = hovered ? positions.get(hovered) : undefined;

  return (
    <div ref={frameRef} className="relative h-full w-full" onKeyDown={onKeyDown}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${data.width} ${data.height}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={ariaLabel}
        className={`h-full w-full select-none ${interactive ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <path
            d={restPath}
            fill="none"
            vectorEffect="non-scaling-stroke"
            strokeWidth={1}
            className={`stroke-kh-border-strong transition-opacity duration-120 ${stepBack ? "opacity-10" : "opacity-40"}`}
          />
          <path d={litPath} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.25} className="stroke-kh-primary opacity-80 transition-opacity duration-120" />

          {unlinkedCount > 0 && data.unlinked && labelSize !== null ? (
            <text
              x={data.unlinked.x}
              y={data.unlinked.y}
              textAnchor="middle"
              fontSize={labelSize}
              letterSpacing="0"
              className="pointer-events-none fill-kh-text-muted font-medium"
            >
              Not linked · {unlinkedCount}
            </text>
          ) : null}

          {data.nodes.map((node) => {
            const isFocus = node.id === focusId;
            const isEmphasised = node.id === emphasised;
            const inEmphasis = lit(node.id);
            const found = searching && matches.has(node.id);
            const dim = (emphasisedSet !== null && !inEmphasis && !found) || (searching && !found && !inEmphasis);
            const unresolved = node.kind === "UNRESOLVED";
            const summary = `${node.title}${unresolved ? " (unresolved)" : ""}, ${node.inDegree} incoming, ${node.outDegree} outgoing`;
            const accent = !unresolved && (inEmphasis || found);
            const body = (
              <>
                {isFocus && !unresolved ? <circle cx={node.x} cy={node.y} r={node.radius + 6} className="fill-kh-highlight" /> : null}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius + 3.5}
                  fill="none"
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={1.5}
                  className={`stroke-kh-focus transition-opacity duration-120 ${isEmphasised ? "opacity-100" : "opacity-0 group-focus-visible:opacity-100"}`}
                />
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  strokeDasharray={unresolved ? "2 1.5" : undefined}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={unresolved ? 1.25 : 0}
                  className={`transition-colors duration-120 ${
                    unresolved ? "fill-kh-bg stroke-kh-text-muted" : accent ? "fill-kh-primary" : "fill-kh-border-strong"
                  }`}
                />
                {labelSize !== null && visibleLabels.has(node.id) ? (
                  <text
                    x={node.x}
                    y={node.y + node.radius + 2 * (1 / (scale ?? 1)) + labelSize * 0.95}
                    textAnchor="middle"
                    fontSize={labelSize}
                    letterSpacing="-0.01em"
                    paintOrder="stroke"
                    strokeWidth={labelSize * 0.4}
                    strokeLinejoin="round"
                    className={`pointer-events-none stroke-kh-bg ${isEmphasised || isFocus ? "fill-kh-text font-medium" : inEmphasis || found ? "fill-kh-text" : "fill-kh-text-secondary"}`}
                  >
                    {nodeLabel(node.title)}
                  </text>
                ) : null}
              </>
            );
            const className = `group outline-none transition-opacity duration-120 ${dim ? "opacity-25" : ""} ${node.href ? "cursor-pointer" : "cursor-default"}`;
            return node.href ? (
              <a
                key={node.id}
                href={node.href}
                aria-label={summary}
                className={className}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
                onFocus={() => setHovered(node.id)}
                onBlur={() => setHovered(null)}
                onClick={(event) => {
                  if (!plainClick(event)) return;
                  event.preventDefault();
                  router.push(node.href!);
                }}
              >
                {body}
              </a>
            ) : (
              // Not a link — there is no page — but still something in the graph
              // that a screen reader must be able to say is there.
              <g
                key={node.id}
                role="img"
                aria-label={summary}
                className={className}
                onMouseEnter={() => setHovered(node.id)}
                onMouseLeave={() => setHovered(null)}
              >
                {body}
              </g>
            );
          })}
        </g>
      </svg>

      {cardNode && card ? <NodeCard node={cardNode} left={card.left} top={card.top} below={card.below} /> : null}

      {interactive ? (
        <>
          <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-3 text-caption text-kh-text-muted">
            <span className="flex items-center gap-1.5">
              <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3.5" className="fill-kh-border-strong" /></svg>
              Document
            </span>
            {hasUnresolved ? (
              <span className="flex items-center gap-1.5">
                <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true"><circle cx="4" cy="4" r="3" strokeDasharray="2 1.5" strokeWidth="1.25" className="fill-kh-bg stroke-kh-text-muted" /></svg>
                Unresolved
              </span>
            ) : null}
            <span className="hidden text-kh-text-faint sm:inline">Scroll to zoom · drag to pan</span>
          </div>
          <div role="group" aria-label="Zoom" className="absolute bottom-3 right-3 flex items-center rounded-md border border-kh-border bg-kh-bg">
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomAt(null, null, 1 / ZOOM_STEP)} className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}>
              <Minus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span aria-live="polite" className="w-10 text-center text-caption tabular-nums text-kh-text-muted">{Math.round(view.k * 100)}%</span>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomAt(null, null, ZOOM_STEP)} className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-kh-border" />
            <button type="button" aria-label="Reset view" title="Reset view (0)" onClick={() => setView(HOME)} className={buttonClasses({ variant: "ghost", icon: true, size: "sm" })}>
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
