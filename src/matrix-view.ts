import { BasesView, TFile, type BasesAllOptions, type QueryController } from "obsidian";
import { CONFIG_KEYS, CSS, DEFAULTS, VIEW_TYPE } from "./constants";
import { clamp, clientToSvgPoint, svgEl } from "./svg-utils";
import { CLUSTER_PROXIMITY_FACTOR, findSnapTarget as pureFindSnapTarget, touchDragFingerOffset } from "./geometry";
import { AxesRenderer, type PlotDims } from "./axes-renderer";
import { PointRenderer, type PointDatum } from "./point-renderer";
import { Tooltip } from "./tooltip";
import { DragManager } from "./drag-manager";
import { MatrixDetailModal } from "./matrix-detail-modal";
import { ClusterTray } from "./cluster-tray";
import { pixelToDataPoint } from "./coords";
import type { ClusterCandidate } from "./cluster-renderer";
import { isValueEmpty, propertyIdToKey } from "./value-extraction";
import { formatValueForChip } from "./value-format";
import { computeSizeFactor, entryToRawPoint, type EntryLike } from "./entry-to-datum";
import { detectValueType, formatValue, type ValueType } from "./value-type";
import { asBasesConfig, asBasesData, asBasesQuery } from "./bases-internals";
import { resolveFilenamePattern } from "./filename-pattern";

/**
 * Bases view that renders entries as points on a 2D matrix.
 *
 * Layered architecture:
 *   - AxesRenderer  : draws axes, ticks, axis labels, quadrant overlay (chrome)
 *   - PointRenderer : draws points (data)
 *   - Tooltip       : floating tooltip on hover
 *   - DragManager   : pointer-event drag with frontmatter writeback
 *
 * The MatrixView orchestrates these and reacts to Bases data updates.
 */

/** Cap on how many property chips appear in the per-point hover tooltip.
 *  The Properties panel can have many fields enabled; surfacing all of them
 *  produces an unreadable wall of chips. 8 matches base-board's card chip
 *  cap and keeps the tooltip a thumbnail, not a panel. */
const MAX_TOOLTIP_CHIPS = 8;

export class MatrixView extends BasesView {
  type = VIEW_TYPE;

  private root!: HTMLElement;
  private container!: HTMLElement;
  private svg!: SVGSVGElement;
  private axes!: AxesRenderer;
  private points!: PointRenderer;
  private tooltip!: Tooltip;
  private drag!: DragManager;
  private tray!: ClusterTray;
  private skippedNotice: HTMLDivElement | null = null;
  private emptyEl: HTMLDivElement | null = null;
  /** True while a label is being inline-edited; render() is suppressed so a
   *  re-render (from ResizeObserver, onDataUpdated, etc.) doesn't replace
   *  the SVG label out from under the input overlay. */
  private isEditing = false;

  // Drag context — keep a cached reference for the DragManager callbacks.
  private currentDims: PlotDims = this.defaultDims();
  private currentDatasetByPath: Map<string, PointDatum> = new Map();
  /** Latest dataset + inferred axis types from render() — drag-config closes
   *  over these so commits compute real bounds and write back the user's
   *  native value format ("5:30", "2025-06-15") instead of raw numbers. */
  private currentPoints: PointDatum[] = [];
  private currentXType: ValueType = "numeric";
  private currentYType: ValueType = "numeric";

  // Stash the resize observer so we can disconnect on unload.
  private resizeObserver: ResizeObserver | null = null;

  static getViewOptions(config?: { get?: (key: string) => unknown }): BasesAllOptions[] {
    // Per-option `shouldHide()` closures capture `config` so they can read
    // the current value of `colorScale` live. Bases re-invokes `shouldHide`
    // on every settings-panel render (per the BasesOption interface), which
    // lets the Color direction row appear/disappear as the user flips the
    // Color scale dropdown — no view reload required.
    return [
      { displayName: "X axis property", type: "property", key: CONFIG_KEYS.X_AXIS, placeholder: "e.g. urgency" },
      { displayName: "Y axis property", type: "property", key: CONFIG_KEYS.Y_AXIS, placeholder: "e.g. importance" },
      { displayName: "Color by (optional)", type: "property", key: CONFIG_KEYS.COLOR_BY, placeholder: "e.g. area" },
      { displayName: "Color scale", type: "dropdown", key: CONFIG_KEYS.COLOR_SCALE, options: {
        "": "Auto (gradient if numeric/date, else categorical)",
        "categorical": "Categorical (discrete colors)",
        "red-yellow-green": "Gradient: red → yellow → green",
        "viridis": "Gradient: viridis (purple → teal → yellow)",
        "red-white-blue": "Gradient: red → white → blue",
      } },
      { displayName: "Color direction", type: "dropdown", key: CONFIG_KEYS.COLOR_DIRECTION, options: {
        "": "—",
        "high-is-good": "High is good (scores, ratings, revenue)",
        "low-is-good": "Low is good (times, error counts, costs)",
      }, shouldHide: () => {
        const scale = config?.get?.(CONFIG_KEYS.COLOR_SCALE);
        return scale === "categorical" || scale === "viridis";
      } },
      { displayName: "Size by (optional)", type: "property", key: CONFIG_KEYS.SIZE_BY, placeholder: "Optional numeric" },
      { displayName: "X min", type: "text", key: CONFIG_KEYS.X_MIN, placeholder: `Default ${DEFAULTS.X_MIN}` },
      { displayName: "X max", type: "text", key: CONFIG_KEYS.X_MAX, placeholder: `Default ${DEFAULTS.X_MAX}` },
      { displayName: "Y min", type: "text", key: CONFIG_KEYS.Y_MIN, placeholder: `Default ${DEFAULTS.Y_MIN}` },
      { displayName: "Y max", type: "text", key: CONFIG_KEYS.Y_MAX, placeholder: `Default ${DEFAULTS.Y_MAX}` },
      { displayName: "X axis label", type: "text", key: CONFIG_KEYS.X_LABEL, placeholder: DEFAULTS.X_LABEL },
      { displayName: "Y axis label", type: "text", key: CONFIG_KEYS.Y_LABEL, placeholder: DEFAULTS.Y_LABEL },
      { displayName: "Show quadrants", type: "toggle", key: CONFIG_KEYS.SHOW_QUADRANTS, default: DEFAULTS.SHOW_QUADRANTS },
      { displayName: "Quadrant label — top right (Q1)", type: "text", key: CONFIG_KEYS.QUADRANT_LABEL_Q1, placeholder: DEFAULTS.QUADRANT_Q1 },
      { displayName: "Quadrant label — top left (Q2)", type: "text", key: CONFIG_KEYS.QUADRANT_LABEL_Q2, placeholder: DEFAULTS.QUADRANT_Q2 },
      { displayName: "Quadrant label — bottom left (Q3)", type: "text", key: CONFIG_KEYS.QUADRANT_LABEL_Q3, placeholder: DEFAULTS.QUADRANT_Q3 },
      { displayName: "Quadrant label — bottom right (Q4)", type: "text", key: CONFIG_KEYS.QUADRANT_LABEL_Q4, placeholder: DEFAULTS.QUADRANT_Q4 },
      { displayName: "Show rings (tech-radar style)", type: "toggle", key: CONFIG_KEYS.SHOW_RINGS, default: DEFAULTS.SHOW_RINGS },
      { displayName: "Ring 1 label (innermost)", type: "text", key: CONFIG_KEYS.RING_LABEL_1, placeholder: "e.g. Adopt" },
      { displayName: "Ring 2 label", type: "text", key: CONFIG_KEYS.RING_LABEL_2, placeholder: "e.g. Trial" },
      { displayName: "Ring 3 label", type: "text", key: CONFIG_KEYS.RING_LABEL_3, placeholder: "e.g. Assess" },
      { displayName: "Ring 4 label (outermost)", type: "text", key: CONFIG_KEYS.RING_LABEL_4, placeholder: "e.g. Hold" },
      { displayName: "Axes through center (math-plot style)", type: "toggle", key: CONFIG_KEYS.CENTER_AXES, default: DEFAULTS.CENTER_AXES },
      { displayName: "Show plot frame", type: "toggle", key: CONFIG_KEYS.SHOW_FRAME, default: DEFAULTS.SHOW_FRAME },
      { displayName: "Show axes (cross lines + tick numbers)", type: "toggle", key: CONFIG_KEYS.SHOW_AXES, default: DEFAULTS.SHOW_AXES },
      { displayName: "Square plot (1:1 aspect ratio)", type: "toggle", key: CONFIG_KEYS.SQUARE_PLOT, default: DEFAULTS.SQUARE_PLOT },
      { displayName: "Point size", type: "slider", key: CONFIG_KEYS.POINT_RADIUS, min: 3, max: 20, step: 1, default: DEFAULTS.POINT_RADIUS },
      { displayName: "Show point labels", type: "toggle", key: CONFIG_KEYS.SHOW_LABELS, default: DEFAULTS.SHOW_LABELS },
      { displayName: "Label max length", type: "slider", key: CONFIG_KEYS.LABEL_MAX_LENGTH, min: 8, max: 80, step: 1, default: DEFAULTS.LABEL_MAX_LENGTH },
    ] as BasesAllOptions[];
  }

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.root = containerEl.createDiv({ cls: CSS.ROOT });
  }

  onload(): void {
    this.container = this.root.createDiv({ cls: CSS.CONTAINER });
    this.svg = svgEl("svg", {
      class: CSS.SVG,
      role: "img",
      "aria-label": "2D scatter plot of notes",
    }) as SVGSVGElement;
    this.container.appendChild(this.svg);

    // Permanent SVG-level touch handlers that claim every touch from the
    // very first event. Obsidian Mobile's sidebar-swipe gesture is a
    // bubble-phase JS listener on a higher-up element — without this, any
    // touch that bubbles past the SVG can trigger sidebar navigation.
    // Bubble-phase stopPropagation on the SVG fires BEFORE Obsidian's
    // listener bubbles in, so Obsidian never sees the touch.
    const stopTouch = (e: Event) => e.stopPropagation();
    this.svg.addEventListener("touchstart", stopTouch, { passive: true });
    this.svg.addEventListener("touchmove", stopTouch, { passive: true });
    this.svg.addEventListener("touchend", stopTouch, { passive: true });
    this.svg.addEventListener("touchcancel", stopTouch, { passive: true });

    this.axes = new AxesRenderer(this.svg);
    this.points = new PointRenderer(this.svg);
    this.tooltip = new Tooltip(this.container);
    this.tray = new ClusterTray(this.container, {
      onRowTap: (filePath) => {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) new MatrixDetailModal(this.app, file).open();
      },
      onRowDragStart: (member, evt) => this.startTrayRowDrag(member, evt),
      onRowHover: (member, evt) => this.handleTrayRowHover(member, evt),
      onRowHoverEnd: () => this.tooltip.hide(),
      onClose: () => this.points.applyExpandedClass(null),
    });
    this.drag = new DragManager(this.app, {
      getDims: () => this.currentDims,
      getConfig: () => this.buildDragConfig(),
      onPositionChange: (filePath, px, py) => this.points.updatePointPosition(filePath, px, py),
      onCommit: (filePath, dx, dy) => this.commitDrag(filePath, dx, dy),
      onClusterCommit: (members, dx, dy) => this.commitClusterDrag(members, dx, dy),
      // The tooltip is still hovering when a drag starts (the pointer hasn't
      // left the dot yet, so pointerout hasn't fired). Hide it explicitly so
      // it doesn't ride along with the cursor through the drag.
      onDragStart: () => this.tooltip.hide(),
    });

    // Re-render on container resize. Throttled implicitly by ResizeObserver.
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.container);

    // Outside-click closes any expanded cluster spider. Click on a cluster
    // is handled by the cluster's own mark click handler — we skip in that
    // case so it can toggle naturally.
    document.addEventListener("click", this.handleDocumentClick, true);
  }

  onunload(): void {
    this.tooltip?.destroy();
    this.resizeObserver?.disconnect();
    document.removeEventListener("click", this.handleDocumentClick, true);
  }

  private handleDocumentClick = (e: MouseEvent): void => {
    const target = e.target as Element | null;
    // Clicks inside the cluster mark itself open/toggle the tray — let the
    // mark's own handler run. Clicks inside the tray (rows, header, close
    // button) stay inside the tray.
    if (target?.closest(`.${CSS.CLUSTER_GROUP}`)) return;
    if (target?.closest(`.${CSS.CLUSTER_TRAY}`)) return;
    // Don't treat clicks inside Obsidian's own modals as "outside" — when
    // the user taps a row to open the detail modal and later dismisses it,
    // those clicks bubble to the document. We cover all the modal shells
    // Obsidian uses (.modal-container wraps a positioned modal; .modal-bg
    // is the dimmed backdrop, sometimes a sibling of .modal-container
    // rather than a descendant; .modal is the inner panel itself).
    if (target?.closest(".modal-container, .modal-bg, .modal")) return;
    // Final safety net: if the click's original target has already been
    // detached from the DOM by the time this handler runs, it almost
    // certainly came from a modal that just closed. Treat as "modal
    // interaction, not outside-click."
    if (target && !target.isConnected) return;
    this.tray.close();
  };

  /** Called by Bases when data or config changes. */
  onDataUpdated(): void {
    this.render();
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private render(): void {
    // Skip re-renders during inline label editing so the SVG element the
    // input is anchored to stays alive and hidden — a re-render would
    // create a fresh label that bypasses our visibility:hidden.
    if (this.isEditing) return;
    // squarePlot adds a class to the container; CSS centers a 1:1 SVG inside
    // it. We square the dims ourselves (min of width/height) so the viewBox
    // matches the rendered SVG — otherwise preserveAspectRatio="xMidYMid meet"
    // (the SVG default) letterboxes a rectangular viewBox inside the square
    // visible area and the chart drifts off-center.
    //
    // We ALSO equalize the inner plot area: padding is asymmetric (left=72
    // for the rotated Y-label vs right=24), so a square SVG would still give
    // a non-square plot region and the ring ellipses would stretch ~5%
    // vertically. Bring the smaller padding-sum axis up to match the larger
    // so pxPerX === pxPerY and rings render as true circles.
    const squarePlot = this.readBool(CONFIG_KEYS.SQUARE_PLOT, DEFAULTS.SQUARE_PLOT);
    this.container.classList.toggle("matrix-container--square", squarePlot);
    const dims = this.computeDims();
    if (squarePlot) {
      const side = Math.min(dims.width, dims.height);
      dims.width = side;
      dims.height = side;
      const hPad = dims.padding.left + dims.padding.right;
      const vPad = dims.padding.top + dims.padding.bottom;
      if (hPad > vPad) {
        const extra = (hPad - vPad) / 2;
        dims.padding.top += extra;
        dims.padding.bottom += extra;
      } else if (vPad > hPad) {
        const extra = (vPad - hPad) / 2;
        dims.padding.left += extra;
        dims.padding.right += extra;
      }
    }
    this.currentDims = dims;
    this.svg.setAttribute("viewBox", `0 0 ${dims.width} ${dims.height}`);
    this.svg.setAttribute("width", String(dims.width));
    this.svg.setAttribute("height", String(dims.height));

    // Build the dataset FIRST so we know the inferred axis types (numeric /
    // time / date). The types drive both bound auto-computation for non-
    // numeric axes (a config xMin=0 makes no sense for a date axis) and
    // tick / tooltip formatting downstream.
    const { points, skipped, xType, yType } = this.buildDataset();
    this.updateSkippedNotice(skipped);
    this.updateEmptyState(points.length, skipped);
    this.currentDatasetByPath = new Map(points.map((p) => [p.filePath, p]));
    this.currentPoints = points;
    this.currentXType = xType;
    this.currentYType = yType;

    const axesConfig = this.buildAxesConfig(points, xType, yType);
    this.axes.render(dims, axesConfig, {
      onEditLabel: (el, key, current) => this.editLabelInPlace(el, key, current),
    });

    this.points.render(points, dims, {
      baseRadius: this.readNumber(CONFIG_KEYS.POINT_RADIUS) ?? DEFAULTS.POINT_RADIUS,
      xMin: axesConfig.xMin, xMax: axesConfig.xMax,
      yMin: axesConfig.yMin, yMax: axesConfig.yMax,
      xType, yType,
      showLabels: this.readBool(CONFIG_KEYS.SHOW_LABELS, DEFAULTS.SHOW_LABELS),
      labelMaxLength: this.readNumber(CONFIG_KEYS.LABEL_MAX_LENGTH) ?? DEFAULTS.LABEL_MAX_LENGTH,
      colorScale: this.readColorScale(),
      colorDirection: this.readColorDirection(),
    }, {
      onHover: (d, e) => this.handleHover(d, e),
      onHoverEnd: () => this.tooltip.hide(),
      onClick: (d, e) => this.handleClick(d, e),
      onPointerDown: (d, e, o) => this.drag.startDrag(d, e, o),
      onClusterMarkClick: (cluster) => {
        this.tray.open(cluster);
        // Apply --expanded class immediately so the cluster mark shows its
        // "selected" state without waiting for the next render.
        this.points.applyExpandedClass(this.tray.getMemberSet());
      },
      onClusterMarkPointerDown: (cluster, group, mark, e) => {
        // Cluster drag dismisses the tray — they're different intents
        // (open vs reposition); a half-open tray during a translate would
        // be confusing.
        this.tray.close();
        // Map cluster.members → starting data-space coords for commit.
        const members = cluster.members.map((m) => ({
          filePath: m.datum.filePath,
          startDataX: m.datum.x,
          startDataY: m.datum.y,
        }));
        this.drag.startClusterDrag(members, group, mark, e);
      },
    });

    // Tray follow-up: if the tracked cluster still exists post-render,
    // refresh its row list; otherwise close. Mark the cluster on the plot
    // with --expanded so users can see which cluster the tray belongs to.
    this.tray.refresh(this.points.getLastClusters());
    this.points.applyExpandedClass(this.tray.getMemberSet());
  }

  // Cluster-expand state is owned by PointRenderer so it can be restored
  // across re-renders (e.g., after a cluster drag, when the DOM is rebuilt).

  private computeDims(): PlotDims {
    // SVG fills the container's CONTENT box (CSS `height: 100%`), not the
    // padding box. The container has `padding-bottom: max(8px, env(...))`
    // to reserve room for the iOS home indicator / Obsidian Mobile nav.
    // Subtract that here so the viewBox matches the SVG's actual rendered
    // size; otherwise default `preserveAspectRatio="xMidYMid meet"`
    // letterboxes everything (the bug we already chased twice).
    const cs = window.getComputedStyle(this.container);
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const padLeft = parseFloat(cs.paddingLeft) || 0;
    const padRight = parseFloat(cs.paddingRight) || 0;
    const rect = this.container.getBoundingClientRect();
    const containerW = rect.width - padLeft - padRight;
    const containerH = rect.height - padTop - padBottom;

    // Inner-plot padding inside the SVG (separate from the container's CSS
    // padding above). Vertical padding is responsive: on short plots
    // (landscape mobile, ~190px tall) the fixed 24/48 was eating ~38% of
    // the height. Scale linearly, clamped so tick labels and axis title
    // still have room.
    //   top: 6% of height, clamped 8–24 (buffer only — no text below it)
    //   bottom: 12% of height, clamped 40–48 (tick text + axis title)
    const padding = {
      top: Math.max(8, Math.min(24, containerH * 0.06)),
      bottom: Math.max(40, Math.min(48, containerH * 0.12)),
      // Left: rotated y-axis title at x=16, tick labels right-anchored at
      // `left - 5`. With "10" (~18px wide) the tick text spans 25–43,
      // leaving a ~2px gap to the title's right edge (~23). Visual minimum.
      left: 48,
      // Right: just enough so the rightmost dot doesn't get clipped.
      right: 12,
    };

    const finalWidth = Math.max(containerW, padding.left + padding.right + 1);
    const finalHeight = Math.max(containerH, padding.top + padding.bottom + 1);
    return { width: finalWidth, height: finalHeight, padding };
  }

  private defaultDims(): PlotDims {
    return { width: 600, height: 400, padding: { top: 24, right: 24, bottom: 48, left: 72 } };
  }

  // ---------------------------------------------------------------------------
  // Config readers
  // ---------------------------------------------------------------------------

  private buildAxesConfig(
    points?: PointDatum[],
    xType: ValueType = "numeric",
    yType: ValueType = "numeric",
  ) {
    // Auto-bound axes whose type is non-numeric (time / date). The default
    // X_MIN / X_MAX of 0 / 10 are meaningless for a date axis (timestamps
    // run in the trillions) — fall back to the dataset extremes with a
    // small padding. For numeric axes we still honor the configured min/max
    // (current 2x2-matrix behavior).
    const { xMin, xMax } = this.resolveBounds(
      this.readNumber(CONFIG_KEYS.X_MIN), this.readNumber(CONFIG_KEYS.X_MAX),
      DEFAULTS.X_MIN, DEFAULTS.X_MAX,
      points ?? [], xType, (p) => p.x,
    );
    const { xMin: yMin, xMax: yMax } = this.resolveBounds(
      this.readNumber(CONFIG_KEYS.Y_MIN), this.readNumber(CONFIG_KEYS.Y_MAX),
      DEFAULTS.Y_MIN, DEFAULTS.Y_MAX,
      points ?? [], yType, (p) => p.y,
    );
    return {
      xMin, xMax, yMin, yMax,
      xType, yType,
      xLabel: this.readString(CONFIG_KEYS.X_LABEL) ?? this.deriveLabel(CONFIG_KEYS.X_AXIS) ?? DEFAULTS.X_LABEL,
      yLabel: this.readString(CONFIG_KEYS.Y_LABEL) ?? this.deriveLabel(CONFIG_KEYS.Y_AXIS) ?? DEFAULTS.Y_LABEL,
      showQuadrants: this.readBool(CONFIG_KEYS.SHOW_QUADRANTS, DEFAULTS.SHOW_QUADRANTS),
      quadrantLabels: [
        this.readString(CONFIG_KEYS.QUADRANT_LABEL_Q1) ?? DEFAULTS.QUADRANT_Q1,
        this.readString(CONFIG_KEYS.QUADRANT_LABEL_Q2) ?? DEFAULTS.QUADRANT_Q2,
        this.readString(CONFIG_KEYS.QUADRANT_LABEL_Q3) ?? DEFAULTS.QUADRANT_Q3,
        this.readString(CONFIG_KEYS.QUADRANT_LABEL_Q4) ?? DEFAULTS.QUADRANT_Q4,
      ] as [string, string, string, string],
      showRings: this.readBool(CONFIG_KEYS.SHOW_RINGS, DEFAULTS.SHOW_RINGS),
      ringLabels: [
        this.readString(CONFIG_KEYS.RING_LABEL_1) ?? DEFAULTS.RING_1,
        this.readString(CONFIG_KEYS.RING_LABEL_2) ?? DEFAULTS.RING_2,
        this.readString(CONFIG_KEYS.RING_LABEL_3) ?? DEFAULTS.RING_3,
        this.readString(CONFIG_KEYS.RING_LABEL_4) ?? DEFAULTS.RING_4,
      ] as [string, string, string, string],
      centerAxes: this.readBool(CONFIG_KEYS.CENTER_AXES, DEFAULTS.CENTER_AXES),
      showFrame: this.readBool(CONFIG_KEYS.SHOW_FRAME, DEFAULTS.SHOW_FRAME),
      showAxes: this.readBool(CONFIG_KEYS.SHOW_AXES, DEFAULTS.SHOW_AXES),
    };
  }

  /**
   * Decide effective axis bounds. Rule: for non-numeric axis types (time /
   * date), data-derived bounds beat config defaults — the configured 0/10
   * default makes no sense for those types. For numeric axes, honor the
   * configured min/max (current 2x2-matrix behavior is unchanged).
   *
   * Even within numeric, if the user hasn't overridden the default AND
   * the dataset's range falls outside it, this falls back to data-derived
   * bounds so a "weeks 1-52" or "pace 5-7" axis renders sensibly without
   * the user having to compute the right xMin/xMax themselves.
   */
  private resolveBounds(
    configMin: number | null,
    configMax: number | null,
    defaultMin: number,
    defaultMax: number,
    points: PointDatum[],
    type: ValueType,
    pick: (p: PointDatum) => number,
  ): { xMin: number; xMax: number } {
    const userOverrode = configMin !== null || configMax !== null;
    const min = configMin ?? defaultMin;
    const max = configMax ?? defaultMax;
    if (type === "numeric" && userOverrode) return { xMin: min, xMax: max };
    if (points.length === 0) return { xMin: min, xMax: max };
    let dataMin = Infinity;
    let dataMax = -Infinity;
    for (const p of points) {
      const v = pick(p);
      if (v < dataMin) dataMin = v;
      if (v > dataMax) dataMax = v;
    }
    if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
      return { xMin: min, xMax: max };
    }
    // 5% padding so dots near the extremes don't touch the frame.
    const span = dataMax - dataMin;
    const pad = span === 0 ? Math.max(1, Math.abs(dataMin) * 0.1) : span * 0.05;
    return { xMin: dataMin - pad, xMax: dataMax + pad };
  }

  private readColorScale(): "categorical" | "red-yellow-green" | "viridis" | "red-white-blue" | null {
    const v = this.readString(CONFIG_KEYS.COLOR_SCALE);
    if (v === "categorical" || v === "red-yellow-green" || v === "viridis" || v === "red-white-blue") {
      return v;
    }
    return null;
  }

  private readColorDirection(): "low-is-good" | "high-is-good" {
    const v = this.readString(CONFIG_KEYS.COLOR_DIRECTION);
    return v === "low-is-good" ? "low-is-good" : "high-is-good";
  }

  private buildDragConfig() {
    // Use the latest rendered dataset + types so bounds match what the user
    // sees on screen. The old `buildAxesConfig()` no-args call returned the
    // 0..10 numeric defaults regardless of axis type, which made drag-write
    // store values in completely wrong ranges for date / time axes.
    const axes = this.buildAxesConfig(this.currentPoints, this.currentXType, this.currentYType);
    const xAxisId = this.readString(CONFIG_KEYS.X_AXIS) ?? "";
    const yAxisId = this.readString(CONFIG_KEYS.Y_AXIS) ?? "";
    return {
      xMin: axes.xMin, xMax: axes.xMax, yMin: axes.yMin, yMax: axes.yMax,
      xPropertyKey: propertyIdToKey(xAxisId),
      yPropertyKey: propertyIdToKey(yAxisId),
      xType: this.currentXType,
      yType: this.currentYType,
    };
  }

  private readString(key: string): string | null {
    // Empty string is a legitimate value — it signals "user explicitly wants
    // no label / no quadrant text" (e.g., the tech-radar example suppresses
    // the X/Y axis labels via `xLabel: ""`). Only null/undefined/non-string
    // falls through to the next coalesce in the caller.
    const v = asBasesConfig(this.config).get?.(key);
    return typeof v === "string" ? v : null;
  }

  private readNumber(key: string): number | null {
    const v = asBasesConfig(this.config).get?.(key);
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private readBool(key: string, fallback: boolean): boolean {
    const v = asBasesConfig(this.config).get?.(key);
    if (v === undefined || v === null) return fallback;
    return Boolean(v);
  }

  private deriveLabel(axisKey: string): string | null {
    const propId = this.readString(axisKey);
    if (!propId) return null;
    const display = asBasesConfig(this.config).getDisplayName?.(propId);
    if (display) return display;
    return propertyIdToKey(propId);
  }

  // ---------------------------------------------------------------------------
  // Data extraction
  // ---------------------------------------------------------------------------

  private buildDataset(): { points: PointDatum[]; skipped: number; xType: ValueType; yType: ValueType } {
    const xAxis = this.readString(CONFIG_KEYS.X_AXIS);
    const yAxis = this.readString(CONFIG_KEYS.Y_AXIS);
    if (!xAxis || !yAxis) {
      return { points: [], skipped: 0, xType: "numeric", yType: "numeric" };
    }

    const cfg = {
      xProp: xAxis, yProp: yAxis,
      colorProp: this.readString(CONFIG_KEYS.COLOR_BY),
      sizeProp: this.readString(CONFIG_KEYS.SIZE_BY),
    };
    // Optional-chain `this.data` — ResizeObserver can fire a render before
    // Bases has populated it (the first observed resize lands between
    // onload and the first onDataUpdated). Treat that as "no data yet"
    // and let the next onDataUpdated cycle do the real render.
    const entries = (asBasesData(this.data)?.data ?? []) as EntryLike[];
    // Type detection pass — peek at raw axis values (BEFORE extractNumber
    // coerces them) to decide whether each axis is numeric / time / date.
    // The detected type drives axis tick formatting, tooltip formatting,
    // and (eventually) drag-write round-trip via formatValue. We default
    // to numeric on missing/empty values so an empty dataset doesn't get
    // surprise-formatted as time.
    // Filter empties BEFORE detectValueType. Bases returns NullValue
    // wrappers (object, not primitive null) for missing frontmatter — its
    // toString() is "" which detectValueType reads as a regular string and
    // would force the inferred type to "string" for an otherwise numeric
    // axis. That cascade kicks in the moment someone clicks "+ New": the
    // Untitled entry's empty x/y poisons detection → resolveBounds's
    // numeric-userOverrode shortcut fails → axes auto-bound from the data
    // → asymmetric pxPerX/pxPerY → squarePlot's equal-padding pass can't
    // recover and rings render as wide ellipses.
    const rawX: unknown[] = [];
    const rawY: unknown[] = [];
    for (const entry of entries) {
      try {
        const xv = entry.getValue?.(xAxis);
        const yv = entry.getValue?.(yAxis);
        if (!isValueEmpty(xv)) rawX.push(xv);
        if (!isValueEmpty(yv)) rawY.push(yv);
      } catch {
        // skip — entry will be filtered out by entryToRawPoint anyway
      }
    }
    const xType = detectValueType(rawX);
    const yType = detectValueType(rawY);

    let skipped = 0;
    let sizeMin = Infinity;
    let sizeMax = -Infinity;
    const raw = [];
    for (const entry of entries) {
      const r = entryToRawPoint(entry, cfg);
      if (r === null) { skipped++; continue; }
      if (r.sizeRaw !== null) {
        if (r.sizeRaw < sizeMin) sizeMin = r.sizeRaw;
        if (r.sizeRaw > sizeMax) sizeMax = r.sizeRaw;
      }
      raw.push(r);
    }
    const points: PointDatum[] = raw.map((r) => ({
      entry: r.entry, filePath: r.filePath, label: this.resolveH1Label(r.filePath),
      x: r.x, y: r.y, color: r.color,
      sizeFactor: computeSizeFactor(r.sizeRaw, sizeMin, sizeMax),
    }));
    return { points, skipped, xType, yType };
  }

  /**
   * Resolve a point's display label from the note's first H1 heading.
   * The H1 is the note's single human-readable title — there is no title
   * property. A note without an H1 gets a loud placeholder instead of a
   * silent basename fallback so the missing title is visible on the chart.
   */
  private resolveH1Label(filePath: string): string {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    const basename = file instanceof TFile ? file.basename : filePath;
    const firstH1 =
      file instanceof TFile
        ? this.app.metadataCache.getFileCache(file)?.headings?.find((h) => h.level === 1)
        : null;
    return firstH1?.heading ?? `Missing H1 — ${basename}`;
  }

  private updateSkippedNotice(skipped: number): void {
    if (skipped === 0) {
      this.skippedNotice?.remove();
      this.skippedNotice = null;
      return;
    }
    if (!this.skippedNotice) {
      this.skippedNotice = this.container.createDiv({ cls: CSS.SKIPPED });
    }
    // Short text so it can sit on the same line as the x-axis title even
    // on narrow viewports. Full explanation goes in the title attribute as
    // a hover tooltip.
    this.skippedNotice.setText(`${skipped} skipped`);
    this.skippedNotice.setAttribute(
      "title",
      `${skipped} note${skipped > 1 ? "s" : ""} skipped — missing numeric/date/time values for the configured x/y axes`,
    );
  }

  /** Show a first-run / blank-chart hint when there's nothing to plot.
   *  Three cases produce a blank chart and each gets its own message so the
   *  user knows whether the problem is config (no axes picked), data shape
   *  (axes set but no parseable values anywhere), or filtering (axes set,
   *  data present, but every note filtered out). Removed entirely when
   *  there's at least one point so the SVG sits unobstructed. */
  private updateEmptyState(pointCount: number, skipped: number): void {
    if (pointCount > 0) {
      this.emptyEl?.remove();
      this.emptyEl = null;
      return;
    }
    const xAxis = this.readString(CONFIG_KEYS.X_AXIS);
    const yAxis = this.readString(CONFIG_KEYS.Y_AXIS);
    let message: string;
    if (!xAxis || !yAxis) {
      message = "Pick X and Y axis properties in the view options on the right.";
    } else if (skipped > 0) {
      message = `No notes have parseable values for "${propertyIdToKey(xAxis)}" and "${propertyIdToKey(yAxis)}". ${skipped} note${skipped > 1 ? "s were" : " was"} skipped — check that the values are numeric, a date (YYYY-MM-DD), or a time (MM:SS or HH:MM:SS).`;
    } else {
      message = "No notes match the current filters.";
    }
    if (!this.emptyEl) {
      this.emptyEl = this.container.createDiv({ cls: "matrix-empty" });
    }
    this.emptyEl.setText(message);
  }

  // ---------------------------------------------------------------------------
  // Interaction handlers
  // ---------------------------------------------------------------------------

  /** Hover handler for tray rows. Mirrors handleHover but takes the
   *  ClusterCandidate directly so the tooltip dot color matches the
   *  member's actual cluster color — large-cluster members have no
   *  SVG circle to read fill from. */
  private handleTrayRowHover(member: ClusterCandidate, evt: PointerEvent): void {
    if (this.drag.isDragging()) return;
    const fileName = member.datum.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";
    this.tooltip.show({
      title: member.datum.label,
      fileName,
      axisValues: [],
      category: member.datum.color ? { label: member.datum.color, color: member.color } : null,
      extraChips: this.computeExtraChips(member.datum),
    }, evt.clientX, evt.clientY, this.container);
  }

  private handleHover(datum: PointDatum, evt: PointerEvent): void {
    // Suppress during active drag — pointerover can re-fire mid-drag on iOS
    // (despite setPointerCapture) and would otherwise re-show the tooltip
    // after onDragStart's explicit hide. Bug surfaced in iPhone smoke test.
    if (this.drag.isDragging()) return;
    // Pull the actual rendered color from the SVG circle so the tooltip dot
    // matches what the user sees on the chart.
    const circle = this.points.getCircle(datum.filePath);
    const color = circle?.getAttribute("fill") ?? "currentColor";

    // Compute the file basename (e.g. "TODO-105") and surface it via the
    // tooltip's data-file-name attribute so user CSS can render it as a
    // subtitle. Plugin stays domain-neutral; presentation lives in snippets.
    const fileName = datum.filePath.split("/").pop()?.replace(/\.md$/, "") ?? "";
    this.tooltip.show({
      title: datum.label,
      fileName,
      // Axis values aren't auto-injected anymore — they appear as chips only
      // when the user adds the xAxis/yAxis property to the Properties panel
      // (= the view's `order` list). Same rule as every other property chip.
      axisValues: [],
      category: datum.color ? { label: datum.color, color } : null,
      extraChips: this.computeExtraChips(datum),
    }, evt.clientX, evt.clientY, this.container);
  }

  /**
   * Build the list of "extra property" chips for the tooltip — the user-
   * selected properties from `config.getOrder()` minus the ones already
   * represented elsewhere on the point (axis values, category, title).
   * Mirrors the base-board kanban card's chip-from-order behavior.
   */
  private computeExtraChips(datum: PointDatum): Array<{ propId: string; label: string; value: string }> {
    const config = asBasesConfig(this.config);
    const order = config.getOrder?.() ?? [];
    if (order.length === 0) return [];

    // Properties already represented in other ways — don't duplicate them
    // as chips. xAxis/yAxis used to be here but were promoted to opt-in
    // chips so they only show when the user picks them in the Properties
    // panel (same rule as any other property).
    const skip = new Set<string>();
    const xAxis = this.readString(CONFIG_KEYS.X_AXIS);
    const yAxis = this.readString(CONFIG_KEYS.Y_AXIS);
    const colorBy = this.readString(CONFIG_KEYS.COLOR_BY);
    const sizeBy = this.readString(CONFIG_KEYS.SIZE_BY);
    // Color shows as the category dot; size has no chip-friendly
    // representation. Axis stays IN.
    for (const p of [colorBy, sizeBy]) {
      if (p) skip.add(p);
    }
    // For chip labels on axis properties specifically, prefer the configured
    // xLabel/yLabel ("Urgency" / "Importance") over the bare property name,
    // so the chip reads the same way the axis label does on the chart.
    const xLabel = this.readString(CONFIG_KEYS.X_LABEL);
    const yLabel = this.readString(CONFIG_KEYS.Y_LABEL);
    const axisLabelOverride = new Map<string, string>();
    if (xAxis && xLabel) axisLabelOverride.set(xAxis, xLabel);
    if (yAxis && yLabel) axisLabelOverride.set(yAxis, yLabel);
    // file.* properties that don't render usefully as a chip (same set as
    // base-board uses to filter out file metadata noise).
    const FILE_PROPS_TO_SKIP = new Set([
      "name", "basename", "fullname", "ext", "extension", "path",
      "links", "backlinks", "embeds", "tags", "file",
    ]);

    const entry = datum.entry as { getValue?: (id: string) => unknown };
    const chips: Array<{ propId: string; label: string; value: string }> = [];
    for (const propId of order) {
      if (chips.length >= MAX_TOOLTIP_CHIPS) break;
      if (skip.has(propId)) continue;
      if (propId.startsWith("formula.")) continue;
      if (propId.startsWith("file.") && FILE_PROPS_TO_SKIP.has(propId.slice(5))) continue;

      let raw: unknown;
      try {
        raw = entry.getValue?.(propId);
      } catch {
        continue;
      }
      // Use the shared formatter so DateValue / LinkValue / ListValue render
      // the same way they do in base-board's chips (relative dates, etc.).
      const value = formatValueForChip(raw).trim();
      if (!value || value === "null" || value === "undefined") continue;

      // Label priority:
      //   1. xLabel/yLabel override for axis-property chips (matches the
      //      axis label on the chart)
      //   2. user-configured displayName
      //   3. bare property name with prefix stripped
      const label = axisLabelOverride.get(propId)
        ?? config.getDisplayName?.(propId)
        ?? propId.replace(/^(note|file|formula)\./, "");
      chips.push({ propId, label, value });
    }
    return chips;
  }

  private handleClick(datum: PointDatum, evt: PointerEvent): void {
    const file = this.app.vault.getAbstractFileByPath(datum.filePath);
    if (!(file instanceof TFile)) return;
    // Cmd/Ctrl-click is the escape hatch: jump straight to a new tab in the
    // normal workspace. Plain click opens the inline detail modal so the user
    // can edit frontmatter (including the matrix's x/y values) and body in
    // place without losing their position on the chart.
    if (evt.metaKey || evt.ctrlKey) {
      void this.app.workspace.getLeaf("tab").openFile(file);
      return;
    }
    new MatrixDetailModal(this.app, file).open();
  }

  /**
   * Drag-out from a cluster tray row. Mirrors the singleton drag pipeline
   * but starts from an HTML row (no SVG circle to capture on) and creates
   * a temporary "ghost" SVG dot that follows the pointer.
   *
   * The tray fades to translucent (CSS) and lets pointer events pass through
   * to the SVG underneath, so the user can drop onto plot regions the tray
   * visually covers — important on phones in portrait, where the bottom
   * drawer overlays half the plot area.
   *
   * Cancel path: drop outside the SVG bounds. Any drop inside the SVG (even
   * a position visually behind the tray) commits via writeFrontmatter with
   * the new urgency/importance. After commit, Bases re-renders → tray.refresh
   * removes the row; if the cluster shrank below LARGE_CLUSTER_MIN, the tray
   * closes automatically.
   */
  private startTrayRowDrag(member: ClusterCandidate, evt: PointerEvent): void {
    this.tray.setDragging(true);
    const config = this.buildDragConfig();
    const dims = this.currentDims;
    if (!config.xPropertyKey || !config.yPropertyKey) {
      this.tray.setDragging(false);
      return;
    }

    // Ghost dot starts at the cluster's current pixel position (the row
    // dragged "out of" that mark). Pointer-events: none so it doesn't
    // intercept its own pointermove.
    const ghost = svgEl("circle", {
      cx: member.cx,
      cy: member.cy,
      r: 10,
      fill: member.color,
      class: "matrix-tray-drag-ghost",
    }) as SVGCircleElement;
    this.svg.appendChild(ghost);

    const filePath = member.datum.filePath;

    const insideSvg = (clientX: number, clientY: number): boolean => {
      const r = this.svg.getBoundingClientRect();
      return clientX >= r.left && clientX <= r.right
          && clientY >= r.top  && clientY <= r.bottom;
    };

    // Match the singleton circle-origin behavior in drag-manager: on touch,
    // lift the dot above the finger so it stays visible. Commit uses the
    // dot's rendered position (cursor minus offset), not the cursor — the
    // offset is the truth, the finger is just the ghost cursor.
    const plotHeight = dims.height - dims.padding.top - dims.padding.bottom;
    const pointerToDotPosition = (e: PointerEvent): { x: number; y: number } | null => {
      const pt = clientToSvgPoint(this.svg, e.clientX, e.clientY);
      if (!pt) return null;
      let cy = pt.y;
      if (e.pointerType === "touch") {
        cy -= touchDragFingerOffset(plotHeight);
      }
      return { x: pt.x, y: cy };
    };

    const onMove = (e: PointerEvent) => {
      const pos = pointerToDotPosition(e);
      if (!pos) return;
      ghost.setAttribute("cx", String(pos.x));
      ghost.setAttribute("cy", String(pos.y));
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
      this.tray.setDragging(false);
      ghost.remove();
    };

    const onUp = (e: PointerEvent) => {
      const inSvg = insideSvg(e.clientX, e.clientY);
      cleanup();
      if (!inSvg) return; // cancel — release outside the plot area

      const pos = pointerToDotPosition(e);
      if (!pos) return;
      const plot = {
        left: dims.padding.left,
        right: dims.width - dims.padding.right,
        top: dims.padding.top,
        bottom: dims.height - dims.padding.bottom,
      };
      const data = pixelToDataPoint({
        pixelX: pos.x, pixelY: pos.y, plot,
        axes: { xMin: config.xMin, xMax: config.xMax, yMin: config.yMin, yMax: config.yMax },
      });
      void this.commitDrag(filePath, data.dataX, data.dataY);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);

    // Apply initial position from the starting event so the ghost is in the
    // right place if the user releases immediately.
    onMove(evt);
  }

  private async commitDrag(filePath: string, dataX: number, dataY: number): Promise<void> {
    const config = this.buildDragConfig();
    if (!config.xPropertyKey || !config.yPropertyKey) return;
    const xRange = config.xMax - config.xMin;
    const yRange = config.yMax - config.yMin;
    // Snap to a nearby existing point's coords if within clustering range —
    // makes clusters viewport-independent (same data = same cluster, every
    // device). When snapping, write EXACT target coords (no rounding) so the
    // two points have bit-identical values, not "close enough to cluster".
    const snap = this.findSnapTarget(new Set([filePath]), dataX, dataY);
    const finalX = snap?.x ?? dataX;
    const finalY = snap?.y ?? dataY;
    await this.drag.writeFrontmatter(
      filePath, config.xPropertyKey, config.yPropertyKey,
      finalX, finalY, xRange, yRange, config.xType, config.yType,
      /* exact */ snap !== null,
    );
    // Immediately re-resolve label positions against the dragged dot's new
    // location. Bases will also fire onDataUpdated → render() momentarily,
    // but that round-trip can be slow enough for the user to see the
    // unresolved state. Resolving labels-only is cheap and synchronous.
    const dims = this.currentDims;
    this.points.resolveLabelsNow(dims.padding.left, dims.width - dims.padding.right, dims.padding.top, dims.height - dims.padding.bottom);
  }

  /**
   * Commit a cluster drag. Same snap-and-exact-values strategy as single-
   * point, applied at the cluster level: if the cluster's destination is
   * near another existing point (non-member), ALL members converge on its
   * exact coords (so they cluster tightly with it). Parallel writes via
   * Promise.all to avoid the multi-render intermediate-broken-cluster state
   * that sequential writes produce.
   */
  private async commitClusterDrag(
    members: Array<{ filePath: string; startDataX: number; startDataY: number }>,
    dataDx: number,
    dataDy: number,
  ): Promise<void> {
    const config = this.buildDragConfig();
    if (!config.xPropertyKey || !config.yPropertyKey) return;
    const xRange = config.xMax - config.xMin;
    const yRange = config.yMax - config.yMin;
    const memberPaths = new Set(members.map((m) => m.filePath));
    // Use the first member's destination as the cluster's anchor for snap
    // detection. Members typically share the same coords (that's why they
    // cluster) so any member is fine.
    const anchorX = members[0].startDataX + dataDx;
    const anchorY = members[0].startDataY + dataDy;
    const snap = this.findSnapTarget(memberPaths, anchorX, anchorY);

    await Promise.all(members.map((m) => {
      const newX = snap
        ? snap.x
        : clamp(m.startDataX + dataDx, config.xMin, config.xMax);
      const newY = snap
        ? snap.y
        : clamp(m.startDataY + dataDy, config.yMin, config.yMax);
      return this.drag.writeFrontmatter(
        m.filePath, config.xPropertyKey, config.yPropertyKey,
        newX, newY, xRange, yRange, config.xType, config.yType,
        /* exact */ snap !== null,
      );
    }));
    const dims = this.currentDims;
    this.points.resolveLabelsNow(dims.padding.left, dims.width - dims.padding.right, dims.padding.top, dims.height - dims.padding.bottom);
  }

  /**
   * Find the closest existing point (excluding the given file paths) within
   * cluster-proximity of the given data-space position. Returns its coords
   * for snapping so the dragged point lands at the exact same value as the
   * target — guaranteed identical data values means the cluster decision
   * (now data-space; see CLUSTER_DATA_PROXIMITY) is also guaranteed. Snap
   * itself uses pixel-space distance because it's a UX trigger ("the user's
   * finger is visually near another point"), independent of how the
   * post-drag cluster check works.
   */
  private findSnapTarget(
    exclude: Set<string>,
    dataX: number,
    dataY: number,
  ): { x: number; y: number } | null {
    const dims = this.currentDims;
    const axes = this.buildAxesConfig();
    const plotWidth = dims.width - dims.padding.left - dims.padding.right;
    const plotHeight = dims.height - dims.padding.top - dims.padding.bottom;
    const xRange = axes.xMax - axes.xMin;
    const yRange = axes.yMax - axes.yMin;
    if (xRange <= 0 || yRange <= 0) return null;
    const baseRadius = this.readNumber(CONFIG_KEYS.POINT_RADIUS) ?? DEFAULTS.POINT_RADIUS;
    const candidates = Array.from(this.currentDatasetByPath.entries()).map(([filePath, p]) =>
      ({ filePath, x: p.x, y: p.y }));
    return pureFindSnapTarget({
      x: dataX, y: dataY,
      candidates,
      excludePaths: exclude,
      pixelsPerX: plotWidth / xRange,
      pixelsPerY: plotHeight / yRange,
      pixelThreshold: baseRadius * CLUSTER_PROXIMITY_FACTOR,
    });
  }

  // ---------------------------------------------------------------------------
  // +New override — preset the new note's frontmatter so it lands on the chart
  // ---------------------------------------------------------------------------

  /**
   * Bases' toolbar +New invokes `createFileForView` on the active view.
   * Overriding it here lets us inject default values for the matrix-specific
   * properties so a freshly created note appears at a sensible spot on the
   * chart (x and y at the midpoint of their configured ranges) instead of
   * being skipped for missing numerics.
   *
   * Also resolves the optional `newItemFilenamePattern` view config (e.g.
   * "TODO-{N}") so vaults that use stable identifier conventions don't fall
   * back to `Untitled.md`. Unset → Obsidian native default.
   *
   * Any frontmatterProcessor passed in by Bases is composed AFTER ours so
   * existing behavior (e.g. the base file's filter conditions) still applies.
   */
  async createFileForView(
    baseFileName?: string,
    frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    const xAxis = this.readString(CONFIG_KEYS.X_AXIS);
    const yAxis = this.readString(CONFIG_KEYS.Y_AXIS);
    const xMin = this.readNumber(CONFIG_KEYS.X_MIN) ?? DEFAULTS.X_MIN;
    const xMax = this.readNumber(CONFIG_KEYS.X_MAX) ?? DEFAULTS.X_MAX;
    const yMin = this.readNumber(CONFIG_KEYS.Y_MIN) ?? DEFAULTS.Y_MIN;
    const yMax = this.readNumber(CONFIG_KEYS.Y_MAX) ?? DEFAULTS.Y_MAX;
    const xMid = Math.round(((xMin + xMax) / 2) * 10) / 10;
    const yMid = Math.round(((yMin + yMax) / 2) * 10) / 10;

    const resolvedFileName = this.resolveNewItemFilename() ?? baseFileName;

    const matrixProcessor = (fm: Record<string, unknown>) => {
      if (xAxis) {
        const key = propertyIdToKey(xAxis);
        if (key && fm[key] === undefined) fm[key] = xMid;
      }
      if (yAxis) {
        const key = propertyIdToKey(yAxis);
        if (key && fm[key] === undefined) fm[key] = yMid;
      }
      // Compose with any processor Bases passed through so we don't clobber
      // upstream defaults (filter-derived values, etc.).
      frontmatterProcessor?.(fm);
    };

    return super.createFileForView(resolvedFileName, matrixProcessor);
  }

  /**
   * Resolve `newItemFilenamePattern` (if configured) against the contents
   * of the `.base` file's `newItemFolder`. Returns the resolved basename
   * or null when no pattern is set / pattern is invalid / no folder is
   * resolvable — caller should fall through to Bases' default.
   */
  private resolveNewItemFilename(): string | null {
    const pattern = this.readString(CONFIG_KEYS.NEW_ITEM_FILENAME_PATTERN);
    if (!pattern) return null;
    // `queryController` is a BasesView runtime property not exposed in the
    // public obsidian types — same situation as `this.config`. See
    // bases-internals for the rationale.
    const ctrl = (this as unknown as { queryController?: { query?: unknown } }).queryController;
    const folderPath = asBasesQuery(ctrl?.query).newItemFolder;
    if (!folderPath) return null;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    // Duck-type for TFolder via the `children` array. Avoids importing
    // TFolder solely for an instanceof check at a single call site.
    const children = (folder as { children?: Array<{ name: string }> } | null)?.children;
    if (!Array.isArray(children)) return null;
    const basenames = children
      .map((c) => c.name)
      .filter((n) => n.endsWith(".md"))
      .map((n) => n.slice(0, -3));
    return resolveFilenamePattern(pattern, basenames);
  }

  // ---------------------------------------------------------------------------
  // Inline label editing
  // ---------------------------------------------------------------------------

  /**
   * Mount an HTML <input> overlay on top of an SVG <text> label, allowing
   * the user to inline-edit it. On Enter or blur, the new value is persisted
   * to the view config via setConfigValue() and a re-render replaces the SVG
   * label with the updated text. Escape cancels without saving.
   */
  private editLabelInPlace(svgEl: SVGTextElement, configKey: string, currentValue: string): void {
    this.isEditing = true;
    const rect = svgEl.getBoundingClientRect();
    const containerRect = this.container.getBoundingClientRect();
    const anchor = svgEl.getAttribute("text-anchor") || "start";

    const input = this.container.createEl("input", {
      type: "text",
      cls: "matrix-inline-edit",
      value: currentValue,
    });
    // Match the label's alignment so the input visually replaces it: if the
    // label is right-anchored (e.g. the top-right quadrant), align the input's
    // right edge with the label's right edge — otherwise the input shoots off
    // to the right of where the visible text actually ended and overshoots
    // the chart's bounds.
    const inputWidth = Math.max(rect.width + 32, 100);
    const inputHeight = 28;
    let inputLeft: number;
    if (anchor === "end") {
      inputLeft = (rect.right - containerRect.left) - inputWidth + 4;
      input.style.textAlign = "right";
    } else if (anchor === "middle") {
      const labelMid = (rect.left + rect.right) / 2 - containerRect.left;
      inputLeft = labelMid - inputWidth / 2;
      input.style.textAlign = "center";
    } else {
      inputLeft = rect.left - containerRect.left - 4;
    }
    let inputTop = rect.top - containerRect.top - 4;
    // Safety clamp on both axes — keep the input fully inside the container
    // even when a label sits hard against a chart edge (bottom axis, right
    // quadrants, etc.) so it can't push the chart around.
    const maxLeft = containerRect.width - inputWidth - 4;
    const maxTop = containerRect.height - inputHeight - 4;
    inputLeft = Math.max(4, Math.min(inputLeft, maxLeft));
    inputTop = Math.max(4, Math.min(inputTop, maxTop));

    input.style.position = "absolute";
    input.style.left = `${inputLeft}px`;
    input.style.top = `${inputTop}px`;
    input.style.width = `${inputWidth}px`;

    // Hide the SVG label while editing so the input visually replaces it.
    const originalVisibility = svgEl.style.visibility;
    svgEl.style.visibility = "hidden";

    let resolved = false;
    const cleanup = (newValue: string | null) => {
      if (resolved) return;
      resolved = true;
      input.remove();
      svgEl.style.visibility = originalVisibility;
      this.isEditing = false;
      if (newValue !== null) {
        const trimmed = newValue.trim();
        if (trimmed && trimmed !== currentValue) {
          this.setConfigValue(configKey, trimmed);
        }
      }
    };

    input.addEventListener("blur", () => cleanup(input.value));
    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      }
    });

    input.focus();
    input.select();
  }

  /**
   * Write a value back to the view's config so it persists to the .base file.
   * Uses BasesConfigRuntime.set when available — Obsidian's Bases types
   * don't formally expose it, but the runtime config object supports it.
   * Triggers an immediate re-render so the new label is visible right away.
   */
  private setConfigValue(key: string, value: string): void {
    const config = asBasesConfig(this.config);
    if (typeof config.set === "function") {
      try {
        config.set(key, value);
      } catch (err) {
        console.error("[bases-matrix] config.set failed:", err);
      }
    } else {
      console.warn("[bases-matrix] config.set not available; label edit cannot persist");
    }
    // Re-render to reflect the change. If config.set already triggered an
    // onDataUpdated cycle, this is a no-op for the data path but ensures
    // the axis chrome rerenders with the new text.
    this.render();
  }
}
