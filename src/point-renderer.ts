import { CSS, DEFAULTS } from "./constants";
import { clearChildren, makeLabelBg, makeScale, rectsOverlap, splitLabel, svgEl, syncLabelBg } from "./svg-utils";
import type { PlotDims } from "./axes-renderer";
import type { DragOrigin } from "./drag-manager";
import { clusterPoints, renderCluster, sortClustersForPaint, type Cluster, type ClusterCandidate } from "./cluster-renderer";
import { setsEqual } from "./cluster-tray-utils";
import {
  runLayout,
  type SingletonInput,
} from "./label-layout-adapter";
import { CLUSTER_PROXIMITY_FACTOR, effectiveBaseRadius, effectiveLabelMaxLength } from "./geometry";
import { wirePointerInteraction } from "./pointer-interaction";
import { buildColorMap, DEFAULT_PALETTE } from "./color-mapping";
import {
  detectGradientType,
  gradientColorFor,
  parseGradientValue,
  type GradientPaletteName,
} from "./gradient-color";

export interface PointDatum {
  /** The Bases entry (used by callers to access file, frontmatter). */
  entry: unknown;
  /** Path to the underlying file, used as a stable identifier. */
  filePath: string;
  /** Display label (resolved from the note's first H1 by the view, not us). */
  label: string;
  /** Data-space x coordinate. */
  x: number;
  /** Data-space y coordinate. */
  y: number;
  /** Optional color category (string used to pick a color slot). */
  color?: string | null;
  /** Optional size factor (multiplier on baseRadius). 1 = default. */
  sizeFactor?: number;
}

export interface PointsConfig {
  baseRadius: number;
  xMin: number; xMax: number; yMin: number; yMax: number;
  /** Inferred axis types — drive tooltip value formatting and (eventually)
   *  drag-write round-trip so a dragged dot in a "5:45" pace column writes
   *  the new position back as a time string, not a raw second-count. */
  xType: import("./value-type").ValueType;
  yType: import("./value-type").ValueType;
  showLabels: boolean;
  labelMaxLength: number;
  /** "categorical" (force hash-based discrete colors), a gradient palette
   *  name (force continuous gradient), or null/undefined (auto-detect:
   *  all-numeric or all-ISO-date values → gradient; else categorical). */
  colorScale: "categorical" | "red-yellow-green" | "viridis" | "red-white-blue" | null;
  /** For diverging gradient palettes, flips the mapping so low values land
   *  on the "good" end of the palette (e.g., faster 5k time = green). */
  colorDirection: "low-is-good" | "high-is-good";
}

/**
 * SVG point layer. Plots points using data-space coordinates that are scaled
 * to the pixel plot area on each render. Emits hover/click events upward.
 */
interface RenderedPoint {
  circle: SVGCircleElement;
  label: SVGTextElement | null;
  /** Chip rect rendered BEHIND the text for readability against overlapping
   *  labels and backgrounds. Color comes from the --dot-color CSS var on the
   *  parent group; positioning is kept in sync with the text. */
  labelBg: SVGRectElement | null;
  radius: number;
  /** Whether the label was placed to the left of the point (flipped for right-edge points). */
  labelFlipped?: boolean;
  /** Distance from the dot's center to the label's anchor X. Always
   *  `radius + 8` now (singletons-only — cluster members aren't tracked
   *  here). Kept as a stored field for the flip helper. */
  labelOffsetX?: number;
}

export class PointRenderer {
  private layer: SVGGElement;
  private currentPoints: Map<string, RenderedPoint> = new Map();
  /** True after the first render so we only animate the entrance once per
   *  view lifetime — drag-induced re-renders should snap, not cascade. */
  private hasRendered = false;
  /** Snapshot of the cluster list from the most recent render. Exposed so
   *  matrix-view can pass it to the tray (for member-set lookups on data
   *  refresh) without re-running clusterPoints. */
  private lastClusters: Cluster[] = [];

  // Color palette is now centralized in ./color-mapping (DEFAULT_PALETTE) so
  // any other view (cluster glyph, future renderers) reuses the same hues.

  constructor(parent: SVGElement) {
    this.layer = svgEl("g", { class: CSS.POINTS }) as SVGGElement;
    parent.appendChild(this.layer);
  }

  render(
    points: PointDatum[],
    dims: PlotDims,
    config: PointsConfig,
    callbacks: {
      onHover: (datum: PointDatum, evt: PointerEvent) => void;
      onHoverEnd: () => void;
      onClick: (datum: PointDatum, evt: PointerEvent) => void;
      onPointerDown: (datum: PointDatum, evt: PointerEvent, origin: DragOrigin) => void;
      onClusterMarkClick?: (cluster: Cluster, clusterGroup: SVGGElement) => void;
      onClusterMarkPointerDown?: (
        cluster: Cluster,
        clusterGroup: SVGGElement,
        markEl: SVGCircleElement,
        evt: PointerEvent,
      ) => void;
    },
  ): void {
    clearChildren(this.layer);
    this.currentPoints.clear();

    const left = dims.padding.left;
    const right = dims.width - dims.padding.right;
    const top = dims.padding.top;
    const bottom = dims.height - dims.padding.bottom;
    const xScale = makeScale(config.xMin, config.xMax, left, right);
    // Y axis is inverted in screen coords (top = 0).
    const yScale = makeScale(config.yMin, config.yMax, bottom, top);

    // Build a value → color map. Two modes:
    //   1. Categorical (current behavior): hash-based discrete colors via
    //      buildColorMap. Used when colorScale === "categorical" OR auto-
    //      detect determines values are non-numeric.
    //   2. Gradient (new): continuous color along a 3-stop palette. Used
    //      when colorScale names a gradient palette OR auto-detect finds
    //      all values are numeric or ISO dates.
    const rawColorValues = points.map((p) => p.color).filter((c): c is string => c != null);
    const colorMap = buildPointColorMap(rawColorValues, config);
    const animateEntrance = !this.hasRendered;

    const isCoarse = typeof window !== "undefined"
      && window.matchMedia?.("(pointer: coarse)").matches;
    const effectiveRadius = effectiveBaseRadius(config.baseRadius, isCoarse);
    const effectiveLabelMax = effectiveLabelMaxLength(right - left, config.labelMaxLength);
    const effectiveConfig: PointsConfig = { ...config, labelMaxLength: effectiveLabelMax };

    // First pass — compute pixel positions and cluster candidates. Clustering
    // happens BEFORE rendering so we can decide singleton-vs-cluster per
    // group; this is what lets ≥5 overlapping points collapse to a single
    // glyph rather than rendering as a fused unreadable blob.
    const candidates: ClusterCandidate[] = points.map((p) => {
      const fill = p.color != null
        ? colorMap.get(p.color) ?? DEFAULT_PALETTE[0]
        : DEFAULT_PALETTE[0];
      return {
        datum: p,
        cx: xScale(p.x),
        cy: yScale(p.y),
        r: effectiveRadius * (p.sizeFactor ?? 1),
        color: fill,
      };
    });
    // Right-wins paint order: rightmost cluster appended last → paints on top.
    const clusters = sortClustersForPaint(clusterPoints(
      candidates,
      config.xMax - config.xMin,
      config.yMax - config.yMin,
      // Pixel-space tie-breaker: catches visual overlap on squeezed-axis
      // plots (landscape mobile) where data-far points still render on
      // top of each other. Data-space alone leaves them as a smudge of
      // overlapping singletons.
      effectiveRadius * CLUSTER_PROXIMITY_FACTOR,
    ));
    this.lastClusters = clusters;

    // Threshold beyond which we flip a singleton's label to the LEFT of its
    // dot so it doesn't run off the right edge of the plot.
    const flipThreshold = left + (right - left) * 0.75;

    let pointIndex = 0;
    for (const cluster of clusters) {
      if (cluster.members.length === 1) {
        this.renderSingleton(cluster.members[0], effectiveConfig, callbacks, animateEntrance, pointIndex, flipThreshold);
        pointIndex++;
      } else {
        // Clusters render as a single count-glyph; per-member elements
        // aren't created (tray handles per-member interaction via ghost
        // dots). renderCluster's `petals` is always empty now.
        renderCluster(
          this.layer,
          cluster,
          { baseRadius: effectiveRadius, labelMaxLength: effectiveLabelMax },
          callbacks,
        );
      }
    }

    // Label edge-flip pass against the current rendered SVG state.
    if (config.showLabels) {
      this.applyLayoutToRendered(left, right, top, bottom);
    }

    this.hasRendered = true;
  }

  /** Member-set of a cluster group, read from the data-members attribute
   *  written by renderCluster. Works for small and large clusters alike. */
  memberPathsOf(group: SVGGElement): Set<string> {
    const raw = group.getAttribute("data-members");
    if (!raw) return new Set();
    return new Set(raw.split(CSS.CLUSTER_MEMBERS_SEPARATOR).filter(Boolean));
  }

  /** Find the cluster group whose member set matches `target` and add the
   *  CLUSTER_GROUP_EXPANDED class to it (clearing the class from any other
   *  cluster first). Matrix-view calls this after each render with the
   *  tray's tracked member set so the cluster mark gets the visual
   *  "selected" treatment while its tray is open. */
  applyExpandedClass(target: Set<string> | null): void {
    const groups = this.layer.querySelectorAll<SVGGElement>(`.${CSS.CLUSTER_GROUP_LARGE}`);
    for (const g of Array.from(groups)) g.classList.remove(CSS.CLUSTER_GROUP_EXPANDED);
    if (!target) return;
    for (const g of Array.from(groups)) {
      if (setsEqual(this.memberPathsOf(g), target)) {
        g.classList.add(CSS.CLUSTER_GROUP_EXPANDED);
        return;
      }
    }
  }

  /**
   * Render a non-clustered single point (the common case). Same per-point
   * group + label + handlers as before clustering existed.
   */
  private renderSingleton(
    candidate: ClusterCandidate,
    config: PointsConfig,
    callbacks: {
      onHover: (datum: PointDatum, evt: PointerEvent) => void;
      onHoverEnd: () => void;
      onClick: (datum: PointDatum, evt: PointerEvent) => void;
      onPointerDown: (datum: PointDatum, evt: PointerEvent, origin: DragOrigin) => void;
    },
    animateEntrance: boolean,
    pointIndex: number,
    flipThreshold: number,
  ): void {
    const p = candidate.datum;
    const { cx, cy, r, color: fill } = candidate;

    const group = svgEl("g", { class: CSS.POINT_GROUP }) as SVGGElement;
    if (animateEntrance) {
      group.classList.add(CSS.POINT_GROUP_ENTERING);
      group.style.setProperty("--enter-delay", `${pointIndex * 12}ms`);
    }
    // The chip rect reads --dot-color via CSS color-mix to area-tint itself.
    // Setting it on the group means circle, label-bg, and any future child
    // inherit the same color without per-element wiring.
    group.style.setProperty("--dot-color", fill);
    this.layer.appendChild(group);

    const circle = svgEl("circle", {
      cx, cy, r,
      fill,
      class: CSS.POINT,
      "data-file-path": p.filePath,
    }) as SVGCircleElement;
    group.appendChild(circle);

    // Always-on label next to the point. Flip to the left for right-edge
    // points so the label doesn't run off the chart.
    let label: SVGTextElement | null = null;
    let labelBg: SVGRectElement | null = null;
    let labelFlipped = false;
    if (config.showLabels) {
      const flipLeft = cx > flipThreshold;
      labelFlipped = flipLeft;
      const lines = splitLabel(p.label, Math.max(8, Math.floor(config.labelMaxLength / 2)));
      const anchorX = flipLeft ? cx - r - 8 : cx + r + 8;
      const baselineOffset = lines.length === 1 ? 4 : -2;
      label = svgEl("text", {
        x: anchorX,
        y: cy + baselineOffset,
        "text-anchor": flipLeft ? "end" : "start",
        class: CSS.POINT_LABEL,
        "data-file-path": p.filePath,
      }) as SVGTextElement;
      for (const [i, line] of lines.entries()) {
        label.appendChild(svgEl("tspan", {
          x: anchorX,
          dy: i === 0 ? "0" : "1.2em",
        }, line));
      }
      group.appendChild(label);
      // Chip rect sized to the rendered text's bbox + padding, inserted
      // BEFORE the text so SVG paint order puts it underneath. Width stays
      // fixed for the life of this label; on subsequent flips/drags only the
      // x/y move (see syncLabelBg / updatePointPosition).
      labelBg = makeLabelBg(label);
      group.insertBefore(labelBg, label);
    }

    wirePointerInteraction(circle, p, { origin: circle, circle, label }, CSS.POINT_DRAGGING, callbacks);
    if (label) {
      wirePointerInteraction(label, p, { origin: label, circle, label }, CSS.POINT_LABEL_DRAGGING, callbacks);
    }

    this.currentPoints.set(p.filePath, { circle, label, labelBg, radius: r, labelFlipped, labelOffsetX: r + 8 });
  }


  /**
   * Build LayoutLabel input from the currently-rendered SVG state, run the
   * pure layout algorithm, then write the resulting placements back to the
   * SVG. This is the boundary between DOM and pure logic.
   */
  private applyLayoutToRendered(
    plotLeft: number, plotRight: number, plotTop: number, plotBottom: number,
  ): void {
    // currentPoints only holds singletons now — cluster members aren't
    // rendered as per-member SVG elements (the tray handles them). The
    // previous version also handled "small cluster" member labels, but
    // that path was retired.
    const singletons: SingletonInput[] = [];
    for (const [filePath, entry] of this.currentPoints.entries()) {
      if (!entry.label) continue;
      const box = entry.label.getBBox();
      const cx = Number(entry.circle.getAttribute("cx") ?? "0");
      const cy = Number(entry.circle.getAttribute("cy") ?? "0");
      const initialAnchorY = parseFloat(entry.label.getAttribute("y") ?? "0");
      singletons.push({
        filePath, cx, cy,
        radius: entry.radius,
        labelWidth: box.width,
        labelHeight: box.height,
        initialAnchorY,
      });
    }
    const result = runLayout({
      singletons,
      clusters: [],
      plotBounds: { left: plotLeft, right: plotRight, top: plotTop, bottom: plotBottom },
    });
    for (const [filePath, placement] of result) {
      const rendered = this.currentPoints.get(filePath);
      if (!rendered?.label) continue;
      rendered.label.setAttribute("x", String(placement.anchorX));
      rendered.label.setAttribute("y", String(placement.anchorY));
      rendered.label.setAttribute("text-anchor", placement.flipped ? "end" : "start");
      for (const tspan of Array.from(rendered.label.querySelectorAll("tspan"))) {
        tspan.setAttribute("x", String(placement.anchorX));
      }
      if (rendered.labelBg) syncLabelBg(rendered.labelBg, rendered.label);
      rendered.labelFlipped = placement.flipped;
    }
  }


  /**
   * Re-run label layout against the current rendered state. Called right
   * after a drag commits so labels resolve immediately to the dragged dot's
   * new position — without waiting for Bases' async onDataUpdated round trip.
   * Delegates to the pure label-layout module via applyLayoutToRendered.
   */
  resolveLabelsNow(plotLeft: number, plotRight: number, plotTop: number, plotBottom: number): void {
    this.applyLayoutToRendered(plotLeft, plotRight, plotTop, plotBottom);
  }

  /** Position a single point's circle (and its label) for live drag updates. */
  updatePointPosition(filePath: string, pixelX: number, pixelY: number): void {
    const rendered = this.currentPoints.get(filePath);
    if (!rendered) return;
    rendered.circle.setAttribute("cx", String(pixelX));
    rendered.circle.setAttribute("cy", String(pixelY));
    if (rendered.label) {
      // Preserve the original flip side during drag. Adjust baseline for line count.
      const flipped = rendered.labelFlipped ?? false;
      const anchorX = flipped ? pixelX - rendered.radius - 8 : pixelX + rendered.radius + 8;
      const tspans = rendered.label.querySelectorAll("tspan");
      const baselineOffset = tspans.length <= 1 ? 4 : -2;
      rendered.label.setAttribute("x", String(anchorX));
      rendered.label.setAttribute("y", String(pixelY + baselineOffset));
      rendered.label.setAttribute("text-anchor", flipped ? "end" : "start");
      for (const tspan of Array.from(tspans)) {
        tspan.setAttribute("x", String(anchorX));
      }
      if (rendered.labelBg) syncLabelBg(rendered.labelBg, rendered.label);
    }
  }

  /** Clusters from the most recent render. Includes singletons (1-member
   *  clusters) and small/large clusters. */
  getLastClusters(): Cluster[] {
    return this.lastClusters;
  }

  /** Get the circle element for a point (for class mutations like .dragging). */
  getCircle(filePath: string): SVGCircleElement | null {
    return this.currentPoints.get(filePath)?.circle ?? null;
  }

}

/**
 * Resolve a colorBy-value → color map per the active mode.
 *
 *   - `colorScale: "categorical"` (explicit) or `null` with non-numeric/non-date
 *     values: discrete colors via the categorical buildColorMap (linear-probe
 *     collision avoidance).
 *   - `colorScale` set to a gradient palette name, OR `null` and auto-detect
 *     finds numeric/date values: gradient mode, with each raw value mapped to
 *     an interpolated color along the palette.
 *
 * Letter grades parse only when the user explicitly named a gradient palette
 * — they're ambiguous enough that auto-detect ignores them.
 */
function buildPointColorMap(
  rawValues: readonly string[],
  config: PointsConfig,
): Map<string, string> {
  if (config.colorScale === "categorical") {
    return buildColorMap(rawValues);
  }

  const explicitPalette: GradientPaletteName | null =
    config.colorScale === "red-yellow-green"
      || config.colorScale === "viridis"
      || config.colorScale === "red-white-blue"
      ? config.colorScale
      : null;

  // Decide gradient vs categorical. Explicit palette → gradient, with letter
  // grades allowed. Otherwise auto-detect: numeric or date → gradient with
  // default palette; anything else → categorical.
  let paletteName: GradientPaletteName;
  let allowLetterGrades: boolean;
  if (explicitPalette) {
    paletteName = explicitPalette;
    allowLetterGrades = true;
  } else {
    const type = detectGradientType(rawValues);
    if (type === "categorical") {
      return buildColorMap(rawValues);
    }
    paletteName = "red-yellow-green"; // auto-mode default
    allowLetterGrades = false;
  }

  // Parse all values; drop any that don't parse. If nothing parses, fall
  // back to categorical so we never silently render every dot the same color.
  const parsed: Array<{ raw: string; value: number }> = [];
  for (const raw of rawValues) {
    const v = parseGradientValue(raw, allowLetterGrades);
    if (v !== null) parsed.push({ raw, value: v });
  }
  if (parsed.length === 0) return buildColorMap(rawValues);

  let min = Infinity;
  let max = -Infinity;
  for (const p of parsed) {
    if (p.value < min) min = p.value;
    if (p.value > max) max = p.value;
  }

  const map = new Map<string, string>();
  for (const p of parsed) {
    if (map.has(p.raw)) continue;
    map.set(p.raw, gradientColorFor(p.value, min, max, paletteName, config.colorDirection));
  }
  return map;
}
