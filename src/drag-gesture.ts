/**
 * Pure gesture-detection helpers for the drag manager.
 *
 * The drag manager has two callers (single-point drag + cluster drag) that
 * both need to answer the same question: "has this pointer moved enough to
 * count as a drag, or is it still a click?" Centralizing the predicate here
 * keeps the two callers in lockstep — drift between them caused at least one
 * shipped bug (BUG-15: drag-and-drop release opening the note).
 */

/** Default movement threshold in pixels — anything below counts as a click. */
export const DEFAULT_DRAG_THRESHOLD_PX = 4;

/**
 * True when the pointer has moved far enough from its start position to be
 * treated as a drag rather than a click.
 *
 * The boundary is **inclusive on the threshold**: distance == threshold is
 * already a drag. Distance is Euclidean; coordinates are in client (pixel)
 * space. Threshold of 0 makes any non-zero movement a drag (and same-point
 * a degenerate "drag" at distance 0, which the >= comparison admits — this
 * is documented behavior and tested explicitly).
 */
export function crossedDragThreshold(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  thresholdPx: number,
): boolean {
  const dx = currentX - startX;
  const dy = currentY - startY;
  return Math.hypot(dx, dy) >= thresholdPx;
}
