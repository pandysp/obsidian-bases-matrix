/**
 * Pure entry → raw-point conversion + size-factor normalization.
 *
 * Extracted from matrix-view.buildDataset where the per-entry extraction
 * loop and the second-pass size normalization were inlined as one function.
 * Splitting them isolates the two distinct decisions:
 *
 *   - entryToRawPoint:    "is this entry plottable, and what are its fields?"
 *   - computeSizeFactor:  "given the dataset's size range, how do we scale?"
 *
 * The matrix-view orchestration becomes: map → filter → sizeRange → re-map.
 */
import { extractNumber, extractString } from "./value-extraction";

/** Minimal Bases-entry shape this module needs. */
export interface EntryLike {
  file?: { path?: string };
  getValue: (id: string) => unknown;
}

export interface AxisExtractionConfig {
  xProp: string;
  yProp: string;
  colorProp: string | null;
  sizeProp: string | null;
}

export interface RawPoint {
  entry: unknown;
  filePath: string;
  x: number;
  y: number;
  color: string | null;
  sizeRaw: number | null;
}

/**
 * Convert one entry to a raw point. Returns null if the entry can't be
 * plotted: missing x, missing y, or missing file path. The caller's
 * "skipped" counter increments on each null. The display label is not
 * resolved here — the view derives it from the note's first H1.
 */
export function entryToRawPoint(
  entry: EntryLike,
  cfg: AxisExtractionConfig,
): RawPoint | null {
  const x = extractNumber(entry, cfg.xProp);
  const y = extractNumber(entry, cfg.yProp);
  if (x === null || y === null) return null;
  const filePath = entry.file?.path;
  if (!filePath) return null;
  return {
    entry,
    filePath,
    x,
    y,
    color: cfg.colorProp ? extractString(entry, cfg.colorProp) : null,
    sizeRaw: cfg.sizeProp ? extractNumber(entry, cfg.sizeProp) : null,
  };
}

/**
 * Map a raw size value to a per-point size multiplier in [0.6, 1.6].
 *
 *   - null raw → 1 (baseline; happens when no size-by property is set)
 *   - zero range (all values equal) → 1 (no spread to normalize against)
 *   - otherwise → 0.6 + (raw - min) / (max - min) * 1.0
 */
export function computeSizeFactor(
  rawSize: number | null,
  sizeMin: number,
  sizeMax: number,
): number {
  if (rawSize === null) return 1;
  const range = sizeMax - sizeMin;
  if (range <= 0) return 1;
  return 0.6 + ((rawSize - sizeMin) / range) * 1.0;
}
