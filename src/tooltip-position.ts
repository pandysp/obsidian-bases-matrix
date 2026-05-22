/**
 * Pure tooltip placement math — viewport-aware, edge-safe positioning.
 *
 * Extracted from tooltip.show() where the down-right-default + flip-on-
 * overflow + clamp-to-edge-padding logic was inlined and split between
 * the initial render and a rAF-deferred adjustment. The DOM layer (rAF,
 * getBoundingClientRect to measure tip dimensions) stays in tooltip.ts;
 * once the tip is measured, this function computes the final position.
 *
 * Default placement is down-right of the cursor (offset away). If that
 * would overflow the right or bottom edge, the tooltip flips to the
 * opposite side. If the flipped position would still underflow the left
 * or top edge (tip larger than scope on that axis), the position clamps
 * to edgePadding.
 *
 * All coordinates are relative to the scope element.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface TooltipPositionInput {
  /** Cursor position relative to the scope element. */
  cursor: Point;
  /** Scope dimensions (the container the tooltip is placed inside). */
  scope: Size;
  /** Measured tooltip dimensions (caller measures via getBoundingClientRect). */
  tip: Size;
  /** Distance to keep between cursor and tooltip corner. */
  offset: number;
  /** Minimum distance from any scope edge — clamping floor when flipped. */
  edgePadding: number;
}

export interface TooltipPosition {
  left: number;
  top: number;
}

export function computeTooltipPosition(input: TooltipPositionInput): TooltipPosition {
  const { cursor, scope, tip, offset, edgePadding } = input;

  // Default: down-right of cursor.
  let left = cursor.x + offset;
  let top = cursor.y + offset;

  // Flip horizontally if right edge would overflow scope (with edgePadding margin).
  if (left + tip.width > scope.width - edgePadding) {
    left = cursor.x - tip.width - offset;
  }
  // Flip vertically if bottom edge would overflow.
  if (top + tip.height > scope.height - edgePadding) {
    top = cursor.y - tip.height - offset;
  }

  // Clamp to edgePadding floor — protects the case where the tip is larger
  // than the scope on either axis, so even the flipped position underflows.
  if (left < edgePadding) left = edgePadding;
  if (top < edgePadding) top = edgePadding;

  return { left, top };
}
