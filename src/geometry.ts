/**
 * Pure geometric / numeric helpers used across the plugin. No DOM, no state
 * — every function is fully testable in isolation.
 */

/**
 * Round a value to a precision derived from the axis range:
 *   range 0–1   → 2 decimals
 *   range 0–10  → 1 decimal
 *   range 0–100 → 0 decimals
 * Non-finite or non-positive ranges pass the value through unchanged so the
 * caller's intent isn't silently lost (e.g., snap-exact mode skips rounding).
 */
export function roundForRange(value: number, range: number): number {
  if (!Number.isFinite(range) || range <= 0) return value;
  const decimals = Math.max(0, 2 - Math.floor(Math.log10(range)));
  const m = Math.pow(10, decimals);
  return Math.round(value * m) / m;
}

/** Coarse-pointer (touch) devices need a tap-friendly minimum dot radius.
 *  Apply a floor: r=10 gives a 20px-diameter dot, small but practical and
 *  visually proportional to a desktop r=10 setting. */
export const TOUCH_MIN_RADIUS = 10;

export function effectiveBaseRadius(baseRadius: number, isCoarsePointer: boolean): number {
  return isCoarsePointer ? Math.max(baseRadius, TOUCH_MIN_RADIUS) : baseRadius;
}

/** Narrow viewports (iPhone portrait, slim sidebars) get shorter labels to
 *  keep collisions tractable. Below 400px plot width, knock label max length
 *  down to 70% of the config max, floored at 8 characters per line. */
export const NARROW_VIEWPORT_PX = 400;
export const NARROW_LABEL_SCALE = 0.7;
export const LABEL_MAX_LENGTH_FLOOR = 8;

export function effectiveLabelMaxLength(plotWidth: number, configMax: number): number {
  if (plotWidth >= NARROW_VIEWPORT_PX) return configMax;
  return Math.max(LABEL_MAX_LENGTH_FLOOR, Math.floor(configMax * NARROW_LABEL_SCALE));
}

/**
 * Spider radius for a large-cluster expansion. Scales with member count so
 * radial labels don't crash into each other at high N. Tighter values on
 * coarse-pointer (phone) so the spider fits inside narrow viewports.
 */
export function spiderRadiusForCluster(memberCount: number, isCoarsePointer: boolean): number {
  return isCoarsePointer
    ? Math.max(40, memberCount * 6)
    : Math.max(70, memberCount * 11);
}

/** Outward offset from petal dot to petal label in a spider. Tighter on
 *  coarse-pointer for the same reason as spider radius. */
export function clusterLabelOffsetBase(isCoarsePointer: boolean): number {
  return isCoarsePointer ? 15 : 24;
}

/** Cluster glyph radius — grows slightly with member count so very large
 *  clusters read as "more stuff here" without ballooning. Capped at +6 over
 *  the small-cluster baseline so the glyph never dominates the chart at
 *  extreme N. */
export function clusterMarkRadius(baseRadius: number, memberCount: number): number {
  return baseRadius + 5 + Math.min(6, Math.max(0, memberCount - 4));
}

/** Touch-drag vertical offset used to keep the dragged dot visible above the
 *  finger. 50px clears the finger-tip contact ellipse on a typical iPhone
 *  (iOS text-selection handles use ~30px, but the dot needs to read clearly
 *  above the finger, not just at its edge). The ratio is intentionally
 *  permissive (40% of plot height): we only scale below 50 on extremely
 *  short plots (~125px or less — e.g., split-pane mobile with the keyboard
 *  up). Normal landscape mobile plots are ~190px tall, comfortably above
 *  the threshold, so they get the full 50px lift just like portrait.
 *  Returns 0 for non-positive plot heights. */
export const TOUCH_DRAG_FINGER_OFFSET_MAX = 50;
export const TOUCH_DRAG_FINGER_OFFSET_RATIO = 0.4;

export function touchDragFingerOffset(plotHeight: number): number {
  if (plotHeight <= 0) return 0;
  return Math.min(TOUCH_DRAG_FINGER_OFFSET_MAX, plotHeight * TOUCH_DRAG_FINGER_OFFSET_RATIO);
}

/** Cluster proximity threshold in NORMALIZED DATA SPACE. Two points cluster
 *  when their distance, with each axis normalized to its own data range,
 *  is below this value. So 0.06 means "if both axes' deltas, expressed as
 *  fractions of the configured axis range, are within ~6% of each other".
 *
 *  Why data-space and not pixel-space: pixel-space clustering is sensitive
 *  to plot dimensions. On landscape mobile the inner plot is short, so the
 *  same data delta in Y maps to fewer pixels, and a pixel-distance
 *  threshold over-clusters. Data-space clustering is dimension-independent
 *  and matches user intuition: "these notes have nearly the same urgency
 *  and importance — group them" regardless of orientation.
 *
 *  Tuned to roughly preserve the previous portrait/desktop clustering
 *  behavior; landscape mobile becomes notably less aggressive. */
export const CLUSTER_DATA_PROXIMITY = 0.06;

/** Legacy: pixel-space cluster proximity factor — points within `factor ×
 *  baseRadius` cluster
 *  together. Same constant used by clusterPoints; the snap-target search
 *  uses it so dragged dots reliably join clusters they're visually near. */
export const CLUSTER_PROXIMITY_FACTOR = 3.0;

/**
 * Concentric ring radii in DATA UNITS. Radii are integer multiples 1..count,
 * so they visually align with the axis tick marks at integer values. Returns
 * [] for non-positive count.
 *
 * Data space (not pixel space) so rings line up with the axis grid: a ring
 * at radius 2 passes exactly through the data point (2, 0). The renderer
 * converts to pixels per axis (`r · pxPerX`, `r · pxPerY`) — rings render
 * as ellipses on non-square plots, true circles when `pxPerX === pxPerY`
 * (i.e., `squarePlot: true`).
 */
export function ringRadii(count: number): number[] {
  if (count <= 0) return [];
  const radii: number[] = [];
  for (let i = 1; i <= count; i++) radii.push(i);
  return radii;
}

/**
 * SVG path `d` for an axis-aligned ellipse, drawn as N cubic-Bézier
 * segments. We construct the path explicitly instead of using <ellipse>
 * because the renderer's native approximation visibly shortcuts the curve
 * at off-axis points on large radii — rings read as faintly egg-shaped
 * with anchors clean at 0/90/180/270° and slack at 45° midpoints.
 *
 * Control-point factor h = (4/3) tan(α/4) where α = 2π/N. At N=8 the peak
 * radial error is ~0.002% of the radius — invisible at any reasonable zoom.
 * Bigger N is unnecessary and just inflates the path string.
 *
 * Passes `rx === ry` cleanly: an ellipse with equal axes is a circle.
 */
export function ellipsePath(
  cx: number, cy: number,
  rx: number, ry: number,
  segments = 8,
): string {
  const alpha = (2 * Math.PI) / segments;
  const h = (4 / 3) * Math.tan(alpha / 4);
  const cmds: string[] = [];
  for (let i = 0; i < segments; i++) {
    const t0 = i * alpha;
    const t1 = (i + 1) * alpha;
    const c0 = Math.cos(t0), s0 = Math.sin(t0);
    const c1 = Math.cos(t1), s1 = Math.sin(t1);
    const x0 = cx + rx * c0, y0 = cy + ry * s0;
    const x1 = cx + rx * c1, y1 = cy + ry * s1;
    // P1 = P0 + h · tangent(t0);  P2 = P3 − h · tangent(t1)
    // tangent on the parametrized ellipse at angle t: (−rx sin t, ry cos t)
    const cp1x = x0 - h * rx * s0, cp1y = y0 + h * ry * c0;
    const cp2x = x1 + h * rx * s1, cp2y = y1 - h * ry * c1;
    if (i === 0) cmds.push(`M${x0} ${y0}`);
    cmds.push(`C${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x1} ${y1}`);
  }
  cmds.push("Z");
  return cmds.join(" ");
}

/**
 * Data-space Y offset (from plot midpoint, in positive=up convention) for
 * the i-th ring's label. Each label sits in the annular gap of its ring —
 * for ring i, between data radii i-1 and i, i.e., at data Y = i - 0.5.
 *
 * The renderer converts the returned data Y to pixels via `midY - offset · pxPerY`
 * (subtracting because pixel Y goes down while data Y goes up).
 */
export function ringLabelOffsetY(ringIndex: number, radii: number[]): number {
  if (ringIndex < 0 || ringIndex >= radii.length) return 0;
  const inner = ringIndex === 0 ? 0 : radii[ringIndex - 1];
  const outer = radii[ringIndex];
  return (inner + outer) / 2;
}

/**
 * Find the closest candidate point (excluding given paths) within
 * `pixelThreshold` of (x, y) in PIXEL space. Returns the candidate's
 * (x, y) for snapping, or null if nothing is in range.
 *
 * Pixel-space distance ensures snap-target detection matches the cluster
 * algorithm regardless of axis range or viewport size.
 */
export interface FindSnapTargetInput {
  x: number;
  y: number;
  candidates: Array<{ filePath: string; x: number; y: number }>;
  excludePaths: Set<string>;
  pixelsPerX: number;
  pixelsPerY: number;
  pixelThreshold: number;
}

export function findSnapTarget(
  input: FindSnapTargetInput,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDist = Infinity;
  for (const c of input.candidates) {
    if (input.excludePaths.has(c.filePath)) continue;
    const pxDist = Math.hypot(
      (c.x - input.x) * input.pixelsPerX,
      (c.y - input.y) * input.pixelsPerY,
    );
    if (pxDist < input.pixelThreshold && pxDist < bestDist) {
      best = { x: c.x, y: c.y };
      bestDist = pxDist;
    }
  }
  return best;
}
