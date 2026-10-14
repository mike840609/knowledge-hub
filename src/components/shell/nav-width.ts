/** The sidebar's width: dragged or stepped between these bounds, kept as `kh:nav-width`. */
export const NAV_WIDTH = { min: 220, max: 400, default: 256, step: 16 } as const;

export function clampNavWidth(value: number): number {
  return Math.min(NAV_WIDTH.max, Math.max(NAV_WIDTH.min, Math.round(value)));
}

/** A stored value outside the bounds is not trusted; the reader gets the default back. */
export function isNavWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= NAV_WIDTH.min && value <= NAV_WIDTH.max;
}

export function nextNavWidth(current: number, key: string): number | null {
  if (key === "ArrowRight") return clampNavWidth(current + NAV_WIDTH.step);
  if (key === "ArrowLeft") return clampNavWidth(current - NAV_WIDTH.step);
  return null;
}
