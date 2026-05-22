import { CONFIG_KEYS, CSS } from "./constants";
import { ellipsePath, ringLabelOffsetY, ringRadii } from "./geometry";
import { clearChildren, formatTick, niceTicks, svgEl } from "./svg-utils";
import { formatValue, type ValueType } from "./value-type";

export interface PlotDims {
  width: number;
  height: number;
  /** Plot area insets — space for tick labels, axis labels. */
  padding: { top: number; right: number; bottom: number; left: number };
}

export interface AxesConfig {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  xLabel: string;
  yLabel: string;
  showQuadrants: boolean;
  /** [Q1, Q2, Q3, Q4] clockwise from top-right. */
  quadrantLabels: [string, string, string, string];
  /** Concentric-ring overlay (tech-radar style). When true, draws four
   *  rings centered at the plot midpoint with optional labels per ring. */
  showRings: boolean;
  /** [innermost → outermost]. Empty string suppresses that ring's label
   *  but the ring is still drawn. */
  ringLabels: [string, string, string, string];
  /** Render ticks + tick labels along the plot's center cross (math-plot
   *  style) instead of along the bottom/left edges. Pairs naturally with
   *  rings and/or quadrants — both of those already draw the cross. */
  centerAxes: boolean;
  /** Rectangular frame around the plot area. Off for math-plot / radar
   *  styles where the cross or rings carry the bounding visually. */
  showFrame: boolean;
  /** Master toggle for the axis chrome: cross / quadrant divider lines,
   *  tick marks, tick number labels. Off → pure-radar look (rings + corner
   *  labels carry the structure, no numerical scale shown). Quadrant
   *  corner labels are NOT affected — they live on `showQuadrants`. */
  showAxes: boolean;
  /** Inferred value types for each axis. Drives tick label formatting:
   *  numeric uses formatTick (1.5 / 30 / etc); time uses MM:SS / HH:MM:SS;
   *  date uses YYYY-MM-DD. Both default to "numeric" for the legacy 2x2
   *  matrix case. */
  xType: ValueType;
  yType: ValueType;
}

export interface AxesCallbacks {
  /** Fired when the user clicks an axis or quadrant label to inline-edit it.
   *  The renderer hands back the SVG element so the caller can overlay an
   *  input on top of it, plus the config key to write to and the current
   *  text so the input can be pre-populated. */
  onEditLabel?: (el: SVGTextElement, configKey: string, currentValue: string) => void;
}

/**
 * Renders the chart chrome: axes, ticks, axis labels, optional quadrant overlay.
 * Idempotent — calling render() again replaces the previous output.
 */
export class AxesRenderer {
  private layer: SVGGElement;

  constructor(parent: SVGElement) {
    this.layer = svgEl("g", { class: CSS.AXES }) as SVGGElement;
    parent.appendChild(this.layer);
  }

  render(dims: PlotDims, config: AxesConfig, callbacks?: AxesCallbacks): void {
    clearChildren(this.layer);

    const left = dims.padding.left;
    const right = dims.width - dims.padding.right;
    const top = dims.padding.top;
    const bottom = dims.height - dims.padding.bottom;
    const midX = left + (right - left) / 2;
    const midY = top + (bottom - top) / 2;
    const xRange = config.xMax - config.xMin;
    const yRange = config.yMax - config.yMin;
    const pxPerX = xRange > 0 ? (right - left) / xRange : 0;
    const pxPerY = yRange > 0 ? (bottom - top) / yRange : 0;

    // Frame: full 4-sided border + filled plot surface. Drawn FIRST so the
    // dividers and any other overlays paint on top of the fill. Optional —
    // off for math-plot / radar styles where the cross or rings carry it.
    if (config.showFrame) {
      this.layer.appendChild(svgEl("rect", {
        x: left, y: top, width: right - left, height: bottom - top,
        class: CSS.AXIS_LINE,
      }));
    }

    // Center cross — drawn whenever (a) quadrants need their dividers, or
    // (b) we're in math-plot mode with showQuadrants off but centerAxes on.
    // Suppressed entirely when `showAxes` is off (pure-radar look). Same
    // stroke style as the frame so they read as one piece.
    const drawCross = config.showAxes && (config.showQuadrants || config.centerAxes);
    if (drawCross) {
      this.layer.appendChild(svgEl("line", {
        x1: midX, y1: top, x2: midX, y2: bottom, class: CSS.QUADRANT_DIVIDER,
      }));
      this.layer.appendChild(svgEl("line", {
        x1: left, y1: midY, x2: right, y2: midY, class: CSS.QUADRANT_DIVIDER,
      }));
    }

    // Quadrant CORNER labels — independent of the cross lines. Live on
    // `showQuadrants` so the structure (4 sectors) reads even when the
    // dividers themselves are hidden.
    if (config.showQuadrants) {
      this.renderQuadrantLabels(left, right, top, bottom, config.quadrantLabels, callbacks);
    }

    // Ring overlay (tech-radar style) layers on top of quadrants if both are
    // enabled — the two are orthogonal: quadrants = sector, rings = adoption.
    if (config.showRings) {
      this.renderRings(midX, midY, pxPerX, pxPerY, config.ringLabels, callbacks);
    }

    // Ticks + tick labels — values come from niceTicks() which snaps the
    // step to a nice multiple of 1/2/5 × 10^n. Works across any axis range
    // (0-1, 0-10, 3-47, 0-100, ...) without ugly fractional intervals.
    // Suppressed entirely when `showAxes` is off.
    if (config.showAxes) {
      const xTicks = niceTicks(config.xMin, config.xMax);
      const yTicks = niceTicks(config.yMin, config.yMax);
      if (config.centerAxes) {
        this.renderCenterTicks(xTicks, yTicks, config, left, right, top, bottom, midX, midY);
      } else {
        this.renderEdgeTicks(xTicks, yTicks, config, left, right, top, bottom);
      }
    }

    // Axis labels — bottom + left gutter regardless of mode. Tech-radar
    // suppresses them by setting xLabel/yLabel = "".
    // y = dims.height - 4 puts the text baseline 4px above the SVG's bottom
    // edge; the descender (~3px) leaves ~1px of clearance. Tight on purpose
    // so the gap below the title stays small. The container's CSS
    // padding-bottom still reserves room for the iOS home indicator.
    const xLabelEl = svgEl("text", {
      x: midX, y: dims.height - 4, "text-anchor": "middle", class: CSS.AXIS_LABEL,
    }, config.xLabel) as SVGTextElement;
    this.layer.appendChild(xLabelEl);

    // y-axis label sits inside the left padding gutter, rotated 90° CCW.
    // x=16 puts the rotated text bounding box at roughly [9, 23]; with
    // tick labels right-anchored at `left - 5` and `left = 48`, ticks span
    // 25–43, leaving only ~2px of gap to the title — the visual minimum
    // before they touch.
    const yLabelX = 16;
    const yLabelEl = svgEl("text", {
      x: yLabelX, y: midY,
      "text-anchor": "middle", class: CSS.AXIS_LABEL,
      transform: `rotate(-90 ${yLabelX} ${midY})`,
    }, config.yLabel) as SVGTextElement;
    this.layer.appendChild(yLabelEl);

    if (callbacks?.onEditLabel) {
      const onEdit = callbacks.onEditLabel;
      xLabelEl.addEventListener("click", () => onEdit(xLabelEl, CONFIG_KEYS.X_LABEL, config.xLabel));
      yLabelEl.addEventListener("click", () => onEdit(yLabelEl, CONFIG_KEYS.Y_LABEL, config.yLabel));
    }
  }

  private renderEdgeTicks(
    xTicks: number[], yTicks: number[], config: AxesConfig,
    left: number, right: number, top: number, bottom: number,
  ): void {
    const xRange = config.xMax - config.xMin;
    const yRange = config.yMax - config.yMin;
    for (const xVal of xTicks) {
      const xPix = left + ((xVal - config.xMin) / xRange) * (right - left);
      this.layer.appendChild(svgEl("line", {
        x1: xPix, y1: bottom, x2: xPix, y2: bottom + 5, class: CSS.TICK,
      }));
      this.layer.appendChild(svgEl("text", {
        x: xPix, y: bottom + 18, "text-anchor": "middle", class: CSS.TICK_LABEL,
      }, formatTickValue(xVal, config.xType)));
    }
    for (const yVal of yTicks) {
      const yPix = bottom - ((yVal - config.yMin) / yRange) * (bottom - top);
      this.layer.appendChild(svgEl("line", {
        x1: left - 5, y1: yPix, x2: left, y2: yPix, class: CSS.TICK,
      }));
      this.layer.appendChild(svgEl("text", {
        x: left - 5, y: yPix + 4, "text-anchor": "end", class: CSS.TICK_LABEL,
      }, formatTickValue(yVal, config.yType)));
    }
  }

  private renderCenterTicks(
    xTicks: number[], yTicks: number[], config: AxesConfig,
    left: number, right: number, top: number, bottom: number,
    midX: number, midY: number,
  ): void {
    const xRange = config.xMax - config.xMin;
    const yRange = config.yMax - config.yMin;
    // Skip the origin tick labels when (0,0) is inside the plot — the X and Y
    // "0" labels would otherwise stack right at the cross.
    const skipXZero = config.xMin < 0 && config.xMax > 0;
    const skipYZero = config.yMin < 0 && config.yMax > 0;
    for (const xVal of xTicks) {
      if (skipXZero && xVal === 0) continue;
      const xPix = left + ((xVal - config.xMin) / xRange) * (right - left);
      this.layer.appendChild(svgEl("line", {
        x1: xPix, y1: midY - 4, x2: xPix, y2: midY + 4, class: CSS.TICK,
      }));
      this.layer.appendChild(svgEl("text", {
        x: xPix, y: midY + 18, "text-anchor": "middle", class: CSS.TICK_LABEL,
      }, formatTickValue(xVal, config.xType)));
    }
    for (const yVal of yTicks) {
      if (skipYZero && yVal === 0) continue;
      const yPix = bottom - ((yVal - config.yMin) / yRange) * (bottom - top);
      this.layer.appendChild(svgEl("line", {
        x1: midX - 4, y1: yPix, x2: midX + 4, y2: yPix, class: CSS.TICK,
      }));
      this.layer.appendChild(svgEl("text", {
        x: midX - 9, y: yPix + 4, "text-anchor": "end", class: CSS.TICK_LABEL,
      }, formatTickValue(yVal, config.yType)));
    }
  }

  private renderQuadrantLabels(
    left: number, right: number, top: number, bottom: number,
    labels: [string, string, string, string],
    callbacks?: AxesCallbacks,
  ): void {
    // Corner labels. Order: Q1 top-right (high X, high Y), then clockwise.
    // Cross-line drawing lives in render() itself so it can be gated by
    // showAxes independently of the corner labels.
    const INSET = 10;
    const positions: Array<{ x: number; y: number; anchor: "start" | "end" }> = [
      { x: right - INSET, y: top + 16, anchor: "end" },    // Q1 top-right
      { x: left + INSET, y: top + 16, anchor: "start" },   // Q2 top-left
      { x: left + INSET, y: bottom - 8, anchor: "start" }, // Q3 bottom-left
      { x: right - INSET, y: bottom - 8, anchor: "end" },  // Q4 bottom-right
    ];
    const configKeys = [
      CONFIG_KEYS.QUADRANT_LABEL_Q1,
      CONFIG_KEYS.QUADRANT_LABEL_Q2,
      CONFIG_KEYS.QUADRANT_LABEL_Q3,
      CONFIG_KEYS.QUADRANT_LABEL_Q4,
    ];

    labels.forEach((text, i) => {
      if (!text) return;
      const pos = positions[i];
      const labelEl = svgEl("text", {
        x: pos.x, y: pos.y,
        "text-anchor": pos.anchor,
        class: CSS.QUADRANT_LABEL,
      }, text) as SVGTextElement;
      this.layer.appendChild(labelEl);

      if (callbacks?.onEditLabel) {
        const onEdit = callbacks.onEditLabel;
        const key = configKeys[i];
        labelEl.addEventListener("click", () => onEdit(labelEl, key, text));
      }
    });
  }

  /**
   * Concentric rings centered at (midX, midY). Ring count is fixed at 4
   * (tech-radar canon: Adopt → Trial → Assess → Hold). Radii live in data
   * space (1..4) so they line up with the integer tick marks; conversion to
   * pixels is per-axis (`pxPerX`/`pxPerY`), so rings render as ellipses on
   * non-square plots and true circles when `squarePlot: true` forces the
   * SVG to a 1:1 aspect ratio.
   *
   * Labels sit in the annular gap of each ring, above midY (positive data Y),
   * centered horizontally so they read regardless of which quadrants are on.
   */
  private renderRings(
    midX: number, midY: number,
    pxPerX: number, pxPerY: number,
    labels: [string, string, string, string],
    callbacks?: AxesCallbacks,
  ): void {
    const radii = ringRadii(4);
    if (radii.length === 0 || pxPerX <= 0 || pxPerY <= 0) return;

    for (const r of radii) {
      this.layer.appendChild(svgEl("path", {
        d: ellipsePath(midX, midY, r * pxPerX, r * pxPerY),
        class: CSS.RING,
      }));
    }

    const configKeys = [
      CONFIG_KEYS.RING_LABEL_1,
      CONFIG_KEYS.RING_LABEL_2,
      CONFIG_KEYS.RING_LABEL_3,
      CONFIG_KEYS.RING_LABEL_4,
    ];

    labels.forEach((text, i) => {
      if (!text) return;
      const offsetData = ringLabelOffsetY(i, radii);
      // Data Y is up-positive; pixel Y is down-positive — subtract to go up.
      // +4 baseline correction for vertically-centered appearance.
      const yPix = midY - offsetData * pxPerY + 4;
      const labelEl = svgEl("text", {
        x: midX, y: yPix,
        "text-anchor": "middle",
        class: CSS.RING_LABEL,
      }, text) as SVGTextElement;
      this.layer.appendChild(labelEl);

      if (callbacks?.onEditLabel) {
        const onEdit = callbacks.onEditLabel;
        const key = configKeys[i];
        labelEl.addEventListener("click", () => onEdit(labelEl, key, text));
      }
    });
  }
}

/**
 * Format a numeric tick value for display, routing through value-type
 * formatting when the axis carries a non-numeric type. niceTicks produces
 * "round" values (1, 2.5, etc) for numeric; for time/date those round
 * values are still in canonical units (seconds / ms timestamps) and need
 * the type-specific formatter so the user sees "5:45" not "345".
 */
function formatTickValue(value: number, type: ValueType): string {
  if (type === "numeric") return formatTick(value);
  return formatValue(value, type);
}
