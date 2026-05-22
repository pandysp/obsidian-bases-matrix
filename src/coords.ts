/**
 * Pure pixel ↔ data coordinate translation for the matrix.
 *
 * Two call sites in the drag manager (single-point commit, cluster commit)
 * used to inline this math separately and ended up subtly different — the
 * cluster path didn't go through `makeInverseScale`, didn't clamp, and
 * handled Y-inversion as a manual negation. Centralizing keeps them in
 * lockstep and makes the round-trip / linearity / Y-inversion properties
 * explicit.
 *
 * Y axis is screen-inverted: pixel Y grows downward, data Y grows upward.
 */

/** Plot interior bounding box in pixel space. */
export interface PlotBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Axis ranges in data space. */
export interface AxisRange {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface PixelToDataInput {
  pixelX: number;
  pixelY: number;
  plot: PlotBox;
  axes: AxisRange;
}

/**
 * Convert a pixel position inside the plot to a data point, clamped to the
 * axis range. Used at drag commit time: the dropped pixel position becomes
 * the persisted data coordinate.
 */
export function pixelToDataPoint(input: PixelToDataInput): { dataX: number; dataY: number } {
  const { pixelX, pixelY, plot, axes } = input;
  const xPerPx = (axes.xMax - axes.xMin) / (plot.right - plot.left);
  const yPerPx = (axes.yMax - axes.yMin) / (plot.bottom - plot.top);
  const rawX = axes.xMin + (pixelX - plot.left) * xPerPx;
  // Y inverted: pixel.top corresponds to axes.yMax, pixel.bottom to axes.yMin.
  const rawY = axes.yMax - (pixelY - plot.top) * yPerPx;
  return {
    dataX: clampInclusive(rawX, axes.xMin, axes.xMax),
    dataY: clampInclusive(rawY, axes.yMin, axes.yMax),
  };
}

export interface PixelToDataDeltaInput {
  pixelDx: number;
  pixelDy: number;
  plot: PlotBox;
  axes: AxisRange;
}

/**
 * Convert a pixel-space delta to a data-space delta. Linear and unclamped:
 * a delta of N pixels right is N * (data-units-per-pixel) regardless of
 * absolute position. Used at cluster-drag commit to translate the group's
 * SVG transform back into per-member data offsets.
 *
 * Y is inverted: a positive pixel dy (visually moving down) corresponds to
 * a negative data dy (lower value).
 */
export function pixelToDataDelta(
  input: PixelToDataDeltaInput,
): { dataDx: number; dataDy: number } {
  const { pixelDx, pixelDy, plot, axes } = input;
  const xPerUnit = (plot.right - plot.left) / (axes.xMax - axes.xMin);
  const yPerUnit = (plot.bottom - plot.top) / (axes.yMax - axes.yMin);
  return {
    dataDx: pixelDx / xPerUnit,
    dataDy: -pixelDy / yPerUnit,
  };
}

function clampInclusive(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
