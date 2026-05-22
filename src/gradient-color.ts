/**
 * Gradient color assignment — continuous color along a palette interpolated
 * from a numeric value. Complement to `color-mapping.ts` which handles the
 * categorical case (discrete colors per category name).
 *
 * Auto-detect: numeric, time (MM:SS / HH:MM:SS), and ISO date values parse
 * into numbers automatically via the shared value-type layer. Letter grades
 * require explicit opt-in via the `colorScale` config — they're ambiguous
 * (single letters could be team names or codes) and could mis-fire as a
 * gradient when the user wanted discrete colors.
 *
 * Direction: diverging palettes (red-yellow-green, red-white-blue) read in
 * the natural "low → high" direction. The `colorDirection` config flips the
 * mapping for cases where low values are GOOD (faster time = better).
 */
import { detectValueType, parseValue } from "./value-type";

export type GradientPaletteName = "red-yellow-green" | "viridis" | "red-white-blue";
export type GradientType = "numeric" | "time" | "date" | "letter-grade" | "categorical";
export type ColorDirection = "low-is-good" | "high-is-good";

/** Three named gradient palettes, expressed as 3-stop color triples. The
 *  midpoint stop is the diverging palette's "neutral" middle. */
export const GRADIENT_PALETTES: Record<GradientPaletteName, readonly string[]> = {
  // Bad → ok → good. Classic for performance / times / scores.
  "red-yellow-green": ["#ef5350", "#f5c518", "#4caf50"],
  // Sequential, perceptually uniform. Use when there's no notion of bad/good.
  // Three stops approximate the full viridis curve for our linear-interp.
  "viridis": ["#440154", "#21918c", "#fde725"],
  // Diverging, neutral-center. Hot/cold or above/below a midpoint.
  "red-white-blue": ["#ef5350", "#f5f5f5", "#4f9eff"],
};

const LETTER_GRADE_ORDINALS: Record<string, number> = {
  "A+": 12, "A": 11, "A-": 10,
  "B+": 9, "B": 8, "B-": 7,
  "C+": 6, "C": 5, "C-": 4,
  "D+": 3, "D": 2, "D-": 1,
  "F": 0,
};

/**
 * Parse a value to a number for gradient interpolation. Returns null for
 * un-orderable values.
 *
 * Delegates to the shared value-type layer for numeric / time / date paths;
 * adds a letter-grade fallback when explicitly enabled (opt-in via the
 * explicit `colorScale` palette names — see point-renderer for the wiring).
 */
export function parseGradientValue(v: unknown, allowLetterGrades: boolean): number | null {
  if (v === null || v === undefined) return null;
  // Try the three first-class types in precedence order. Each rejects
  // values outside its grammar so we never silently mis-interpret "1" as
  // a date or "5:45" as a number.
  const numeric = parseValue(v, "numeric");
  if (numeric !== null) return numeric;
  const time = parseValue(v, "time");
  if (time !== null) return time;
  const date = parseValue(v, "date");
  if (date !== null) return date;
  // Letter grade — opt-in only.
  if (allowLetterGrades && typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed in LETTER_GRADE_ORDINALS) return LETTER_GRADE_ORDINALS[trimmed];
  }
  return null;
}

/**
 * Decide what gradient type a colorBy axis falls into based on the FULL
 * set of values. Used for auto-detect when the user hasn't set `colorScale`.
 * Letter grades intentionally don't auto-detect — they require explicit
 * opt-in.
 *
 * Returns "categorical" when the values are a mix or aren't numeric/time/date.
 * The "time" and "date" cases (detected via value-type) both render as a
 * gradient using the default palette, since both have a natural ordering.
 */
export function detectGradientType(values: readonly unknown[]): GradientType {
  const t = detectValueType(values);
  if (t === "numeric") return "numeric";
  if (t === "date") return "date";
  if (t === "time") return "time";
  return "categorical";
}

/**
 * Linear-interpolate a position `t ∈ [0, 1]` along an ordered list of color
 * stops. Returns the interpolated color as an `rgb(r, g, b)` string.
 *
 * `t` is clamped to [0, 1]. For a 3-stop palette, t=0 picks stop 0, t=0.5
 * picks stop 1 exactly, t=1 picks stop 2. In between, the channels are
 * mixed linearly in sRGB. Linear sRGB mixing is good-enough at low stop
 * counts; for perceptual mixing we'd convert to OKLab, but that's overkill
 * for 3-stop palettes like these.
 */
export function interpolatePalette(t: number, stops: readonly string[]): string {
  if (stops.length === 0) return "#000000";
  if (stops.length === 1) return stops[0];
  const clamped = Math.max(0, Math.min(1, t));
  // Segments between stops: 0..(stops.length - 1). At clamped=1, segment =
  // stops.length - 1 which is out of bounds — special-case to last stop.
  if (clamped === 1) return stops[stops.length - 1];
  const scaled = clamped * (stops.length - 1);
  const lo = Math.floor(scaled);
  const frac = scaled - lo;
  if (frac === 0) return stops[lo]; // exact stop hit — return as-is, no mix
  const c1 = hexToRgb(stops[lo]);
  const c2 = hexToRgb(stops[lo + 1]);
  if (!c1 || !c2) return stops[lo];
  const r = Math.round(c1.r + (c2.r - c1.r) * frac);
  const g = Math.round(c1.g + (c2.g - c1.g) * frac);
  const b = Math.round(c1.b + (c2.b - c1.b) * frac);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Compute the gradient color for a single value against the dataset's
 *  [min, max] range. Returns midpoint color when range is degenerate. */
export function gradientColorFor(
  value: number,
  min: number,
  max: number,
  paletteName: GradientPaletteName,
  direction: ColorDirection,
): string {
  const stops = GRADIENT_PALETTES[paletteName];
  if (!stops) return "#888888";
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return interpolatePalette(0.5, stops);
  }
  let t = (value - min) / (max - min);
  // low-is-good flips the gradient so low → "good" end (right side of palette).
  // For red-yellow-green: low → green (palette end), high → red (palette start).
  if (direction === "low-is-good") t = 1 - t;
  return interpolatePalette(t, stops);
}

interface Rgb { r: number; g: number; b: number; }

function hexToRgb(hex: string): Rgb | null {
  // Accept "#rgb" / "#rrggbb". For now we don't accept named CSS colors or
  // var(--...) here — gradient stops are concrete hex codes.
  const m = hex.match(/^#([0-9a-f]{6})$/i) || hex.match(/^#([0-9a-f]{3})$/i);
  if (!m) return null;
  const raw = m[1];
  if (raw.length === 3) {
    return {
      r: parseInt(raw[0] + raw[0], 16),
      g: parseInt(raw[1] + raw[1], 16),
      b: parseInt(raw[2] + raw[2], 16),
    };
  }
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}
