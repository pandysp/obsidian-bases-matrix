import { CSS } from "./constants";
import { pickContrastingTextColor } from "./contrast";
import { CLUSTER_DATA_PROXIMITY, clusterMarkRadius } from "./geometry";
import { pickClusterColor } from "./pick-cluster-color";
import { svgEl } from "./svg-utils";
import type { DragOrigin } from "./drag-manager";
import type { PointDatum } from "./point-renderer";

/**
 * Overlap clustering + rendering.
 *
 * Multiple data points whose dots would render at the same (or nearly the
 * same) pixel position are visually fused into a single "cluster mark" — a
 * grey-but-data-colored circle with a count badge. Tap opens the cluster
 * tray (an HTML overlay listing members). Drag-out happens from the tray,
 * not from any SVG petal — the tray creates a ghost dot on demand.
 *
 * Clusters start at 2 members. There used to be a "small cluster" path
 * (≤2 members) that rendered member labels stacked next to the mark, but
 * it was retired: anything ≥2 now goes through the same code path as a
 * "large" cluster and opens the tray on tap.
 */

export interface ClusterCandidate {
  datum: PointDatum;
  cx: number;
  cy: number;
  r: number;
  color: string;
}

export interface Cluster {
  members: ClusterCandidate[];
  /** Geometric centroid — visually the cluster's center. */
  cx: number;
  cy: number;
}

/**
 * Group candidates into clusters using a UNION of two proximity tests:
 *
 *   (a) Data-space (normalized): cluster when each axis's delta, divided
 *       by that axis's data range, has magnitude < `epsilon`. Captures
 *       semantically-close points regardless of plot dimensions.
 *
 *   (b) Pixel-space: cluster when the pixel distance between dot centers
 *       is below `pixelThreshold`. Captures visual overlap — important on
 *       short plots (landscape mobile) where data-far points can render
 *       on top of each other and would otherwise display as a smudge of
 *       overlapping singletons.
 *
 * Two points are merged if EITHER condition fires. Use union-find so
 * clustering is transitive (A near B, B near C → A, B, C all share a
 * cluster even if A and C are technically too far for either test).
 *
 * The pixel positions (cx, cy) are still used for the cluster centroid.
 */
export function clusterPoints(
  candidates: ClusterCandidate[],
  xRange: number,
  yRange: number,
  pixelThreshold: number = 0,
  epsilon: number = CLUSTER_DATA_PROXIMITY,
): Cluster[] {
  const n = candidates.length;
  const parent = new Array(n).fill(0).map((_, i) => i);
  const find = (x: number): number => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const dataThreshSq = epsilon * epsilon;
  const pixelThreshSq = pixelThreshold * pixelThreshold;
  // Guard against zero/negative ranges (degenerate axis config); skip
  // normalization for that axis so we don't divide by zero.
  const xn = xRange > 0 ? xRange : 1;
  const yn = yRange > 0 ? yRange : 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dxData = (candidates[i].datum.x - candidates[j].datum.x) / xn;
      const dyData = (candidates[i].datum.y - candidates[j].datum.y) / yn;
      if (dxData * dxData + dyData * dyData < dataThreshSq) {
        union(i, j);
        continue;
      }
      // Only check pixel distance if a threshold was provided.
      if (pixelThreshold > 0) {
        const dxPx = candidates[i].cx - candidates[j].cx;
        const dyPx = candidates[i].cy - candidates[j].cy;
        if (dxPx * dxPx + dyPx * dyPx < pixelThreshSq) union(i, j);
      }
    }
  }
  const buckets = new Map<number, ClusterCandidate[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const bucket = buckets.get(root);
    if (bucket) bucket.push(candidates[i]);
    else buckets.set(root, [candidates[i]]);
  }
  const out: Cluster[] = [];
  for (const members of buckets.values()) {
    // Centroid = mean of member positions. For singletons this is just the
    // point itself; for clusters this is where the cluster mark sits.
    let sx = 0, sy = 0;
    for (const m of members) { sx += m.cx; sy += m.cy; }
    out.push({ members, cx: sx / members.length, cy: sy / members.length });
  }
  return out;
}

/**
 * Sort clusters by centroid x ascending so the rightmost paints LAST.
 * SVG paints in DOM order — later siblings paint on top — so this gives a
 * stable "right wins" rule for overlapping labels. Pure: returns a new array,
 * does not mutate the input. Stable for equal cx (relies on Array.sort
 * stability, locked by tests).
 */
export function sortClustersForPaint(clusters: Cluster[]): Cluster[] {
  return clusters.slice().sort((a, b) => a.cx - b.cx);
}

/** Rendered petal — caller registers in its point→element map for drag/update.
 *
 *  Retained as an empty-by-default array on `RenderClusterResult` to keep
 *  the result type stable for callers; clusters of any size now route
 *  through the same code path (count glyph + tray) and never produce
 *  member-level SVG elements, so this is always empty in practice. */
export interface RenderedPetal {
  filePath: string;
  circle: SVGCircleElement;
  label: SVGTextElement | null;
  labelBg: SVGRectElement | null;
  radius: number;
  clusterGroup: SVGGElement;
}

export interface RenderClusterCallbacks {
  onHover: (datum: PointDatum, evt: PointerEvent) => void;
  onHoverEnd: () => void;
  onClick: (datum: PointDatum, evt: PointerEvent) => void;
  onPointerDown: (datum: PointDatum, evt: PointerEvent, origin: DragOrigin) => void;
  /** Fired when the user taps a large cluster's mark and a real drag wasn't
   *  detected — caller opens the cluster tray for this cluster. */
  onClusterMarkClick?: (cluster: Cluster, clusterGroup: SVGGElement) => void;
  /** Fired on pointerdown on a large cluster's mark — caller wires it to
   *  DragManager.startClusterDrag so the whole cluster (all members) can be
   *  translated as a unit. The drag is a no-op until the gesture threshold is
   *  crossed; below that, the click handler runs and toggles expand. */
  onClusterMarkPointerDown?: (
    cluster: Cluster,
    clusterGroup: SVGGElement,
    markEl: SVGCircleElement,
    evt: PointerEvent,
  ) => void;
}

export interface RenderClusterConfig {
  baseRadius: number;
  labelMaxLength: number;
}

/** Result returned to the caller. `footprint` is set only for large
 *  (spider-expanding) clusters and describes the bounding circle the spider
 *  occupies when open — caller uses it to hide overlapping singleton labels. */
export interface RenderClusterResult {
  petals: RenderedPetal[];
  footprint: { cx: number; cy: number; radius: number } | null;
}

/**
 * Render a cluster: a single grey cluster mark + count badge at the cluster's
 * centroid. Tap opens the tray (HTML overlay listing members). Drag-out
 * happens from the tray, not from any SVG member element — clusters of any
 * size never render per-member SVG circles.
 *
 * Pointerdown on the mark routes to startClusterDrag (translate the whole
 * cluster as a unit); a no-drag click routes to onClusterMarkClick → tray.open.
 *
 * The returned `petals` array is always empty — kept on the result for
 * shape stability with callers that historically iterated it during the
 * "small cluster" era. Callers that registered member elements there now
 * find nothing to register; that's fine, the tray handles all per-member
 * interaction via its own ghost-dot flow.
 */
export function renderCluster(
  parent: SVGGElement,
  cluster: Cluster,
  config: RenderClusterConfig,
  callbacks: RenderClusterCallbacks,
): RenderClusterResult {
  const group = svgEl("g", {
    class: `${CSS.CLUSTER_GROUP} ${CSS.CLUSTER_GROUP_LARGE}`,
    // Member paths recorded on the element so callers (PointRenderer's
    // applyExpandedClass) can identify "which group is this set" without
    // inspecting child elements — there are no per-member SVG children.
    // See CLUSTER_MEMBERS_SEPARATOR for the separator contract.
    "data-members": cluster.members.map((m) => m.datum.filePath).join(CSS.CLUSTER_MEMBERS_SEPARATOR),
  }) as SVGGElement;
  parent.appendChild(group);

  // Cluster representative color: mode of members' colors, ties broken by
  // first appearance. See pick-cluster-color for the locked contract.
  const clusterColor = pickClusterColor(cluster.members.map((m) => m.color));
  const clusterRadius = clusterMarkRadius(config.baseRadius, cluster.members.length);

  const mark = appendClusterMark(group, cluster, clusterRadius, clusterColor);
  appendClusterCount(group, cluster, cluster.members.length, clusterColor);
  wireClusterMarkInteraction(mark, group, cluster, callbacks);

  return { petals: [], footprint: null };
}

/** Cluster glyph — solid colored circle at the cluster's centroid.
 *  Returned so the caller can wire pointer/click handlers (toggle-expand
 *  for large clusters, drag-the-whole-cluster for any). */
function appendClusterMark(
  parent: SVGGElement,
  cluster: Cluster,
  radius: number,
  fill: string,
): SVGCircleElement {
  const mark = svgEl("circle", {
    cx: cluster.cx, cy: cluster.cy, r: radius,
    fill,
    class: CSS.CLUSTER_MARK,
  }) as SVGCircleElement;
  parent.appendChild(mark);
  return mark;
}

/** Member-count badge text, centered in the cluster mark.
 *
 *  The `fill` attribute is set per-cluster from the luminance of the cluster
 *  color so the count stays readable on both dark theme tokens (white text)
 *  and light palette slots like yellow / lightened variants (black text).
 *  Overrides the CSS fallback `fill: #fff` from `.matrix-cluster-count`. */
function appendClusterCount(
  parent: SVGGElement,
  cluster: Cluster,
  n: number,
  clusterColor: string,
): void {
  parent.appendChild(svgEl("text", {
    x: cluster.cx, y: cluster.cy + 4,
    "text-anchor": "middle",
    fill: pickContrastingTextColor(clusterColor),
    class: CSS.CLUSTER_COUNT,
  }, String(n)));
}

/**
 * Wire pointer + click handlers on a cluster's mark element.
 *   - pointerdown → DragManager.startClusterDrag via callback (moves the
 *     whole cluster as a unit; no-op if drag threshold not crossed).
 *   - click → onClusterMarkClick. The matrix-view's handler opens the
 *     cluster tray for this cluster. Click is suppressed when the
 *     cluster-drag class is present (drag just ran).
 */
function wireClusterMarkInteraction(
  mark: SVGCircleElement,
  group: SVGGElement,
  cluster: Cluster,
  callbacks: RenderClusterCallbacks,
): void {
  mark.addEventListener("pointerdown", (e) => {
    callbacks.onClusterMarkPointerDown?.(cluster, group, mark, e as PointerEvent);
  });
  mark.addEventListener("click", () => {
    // Suppress if a drag just happened — same pattern as singleton points.
    if (group.classList.contains(CSS.CLUSTER_GROUP_DRAGGING)) return;
    callbacks.onClusterMarkClick?.(cluster, group);
  });
}

