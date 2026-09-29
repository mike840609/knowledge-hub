"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minus, Plus } from "lucide-react";
import { buttonClasses } from "@/components/ui/button";
import { adjacency, matchesQuery, nodeLabel, type GraphViewData } from "./graph-model";

type View = { k: number; x: number; y: number };
const HOME: View = { k: 1, x: 0, y: 0 };
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 6;
/** Labels are drawn at this many screen pixels whatever the zoom, so they stay readable and do not swell with the drawing. */
const LABEL_PX = 11;
/** Up to this many nodes every label is shown; beyond it only the ones being looked at. None in the small drawing, where they would only collide: the sections beside it name every document. */
const LABEL_ALL_LIMIT = 80;
const LABEL_ALL_LIMIT_COMPACT = 0;

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

/**
 * The graph, drawn. Positions arrive finished from the server; this only
 * paints them and lets the reader move around (pan, zoom) and look (hover to
 * see a node's neighbours, type to find one).
 *
 * Every node is an anchor, so it is a real link: focusable, reachable by Tab in
 * the order the server sent (best-connected first), openable in a new tab.
 * Colour comes from the theme's variables and nothing else, so it follows
 * light and dark; emphasis is opacity and stroke, not hue.
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
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>(HOME);
  const [hovered, setHovered] = useState<string | null>(null);
  const [pxPerUnit, setPxPerUnit] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; last: { x: number; y: number } } | null>(null);

  const neighbours = useMemo(() => adjacency(data.edges), [data.edges]);
  const searching = query.trim() !== "";
  const matches = useMemo(() => new Set(data.nodes.filter((node) => matchesQuery(node, query)).map((node) => node.id)), [data.nodes, query]);
  const emphasised = hovered ?? focusId;
  const emphasisedSet = useMemo(
    () => (emphasised ? new Set([emphasised, ...(neighbours.get(emphasised) ?? [])]) : null),
    [emphasised, neighbours],
  );
  const positions = useMemo(() => new Map(data.nodes.map((node) => [node.id, node])), [data.nodes]);

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

  const labelSize = pxPerUnit === null ? null : LABEL_PX / (pxPerUnit * view.k);
  const showAllLabels = data.nodes.length <= (interactive ? LABEL_ALL_LIMIT : LABEL_ALL_LIMIT_COMPACT);

  return (
    <div className="relative h-full w-full">
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
          {data.edges.map((edge) => {
            const from = positions.get(edge.from);
            const to = positions.get(edge.to);
            if (!from || !to) return null;
            const lit = emphasisedSet !== null && (edge.from === emphasised || edge.to === emphasised);
            const dim = (emphasisedSet !== null && !lit) || (searching && !(matches.has(edge.from) && matches.has(edge.to)));
            return (
              <line
                key={`${edge.from}>${edge.to}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                vectorEffect="non-scaling-stroke"
                strokeWidth={Math.min(1 + (edge.count - 1) * 0.5, 3)}
                className={`${lit ? "stroke-kh-primary" : "stroke-kh-border-strong"} ${dim ? "opacity-20" : lit ? "opacity-100" : "opacity-60"}`}
              />
            );
          })}
          {data.nodes.map((node) => {
            const isFocus = node.id === focusId;
            const inEmphasis = emphasisedSet === null || emphasisedSet.has(node.id);
            const found = searching && matches.has(node.id);
            const dim = (emphasisedSet !== null && !inEmphasis) || (searching && !found);
            const unresolved = node.kind === "UNRESOLVED";
            const showLabel = labelSize !== null && (showAllLabels || isFocus || found || (emphasisedSet?.has(node.id) ?? false));
            const summary = `${node.title}${unresolved ? " (unresolved)" : ""}, ${node.inDegree} incoming, ${node.outDegree} outgoing`;
            const body = (
              <>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.radius}
                  strokeDasharray={unresolved ? "2 2" : undefined}
                  className={`${
                    unresolved
                      ? "fill-kh-bg stroke-kh-text-muted"
                      : node.id === emphasised
                        ? "fill-kh-primary stroke-kh-text"
                        : emphasisedSet !== null && inEmphasis
                          ? "fill-kh-primary stroke-kh-primary"
                          : "fill-kh-text-muted stroke-kh-text-muted"
                  } group-focus-visible:stroke-kh-focus`}
                  strokeWidth={node.id === emphasised || found ? 3 : 1.5}
                />
                {showLabel ? (
                  <text
                    x={node.x}
                    y={node.y + node.radius + labelSize * 1.1}
                    textAnchor="middle"
                    fontSize={labelSize}
                    className={`pointer-events-none fill-kh-text ${dim ? "opacity-40" : ""}`}
                  >
                    {nodeLabel(node.title)}
                  </text>
                ) : null}
              </>
            );
            const className = `group outline-none ${dim ? "opacity-30" : ""} ${node.href ? "cursor-pointer" : "cursor-default"}`;
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
                <title>{summary}</title>
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
                <title>{summary}</title>
                {body}
              </g>
            );
          })}
        </g>
      </svg>
      {interactive ? (
        <div className="absolute right-3 top-3 flex flex-col gap-1">
          <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(null, null, 1.3)} className={buttonClasses({ variant: "secondary", icon: true, size: "sm" })}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(null, null, 1 / 1.3)} className={buttonClasses({ variant: "secondary", icon: true, size: "sm" })}>
            <Minus className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button type="button" aria-label="Reset view" title="Reset view" onClick={() => setView(HOME)} className={buttonClasses({ variant: "secondary", icon: true, size: "sm" })}>
            <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
