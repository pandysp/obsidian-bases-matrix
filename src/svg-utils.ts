import { CSS, SVG_NS } from "./constants";

/** Padding around a label's text content for the chip background. */
const LABEL_BG_PAD_X = 4;
const LABEL_BG_PAD_Y = 1;

/** Build a chip-background rect sized to a rendered <text>'s bbox + padding.
 *  The caller must already have appended the text to the DOM (getBBox needs
 *  layout). Returns the rect; the caller is responsible for inserting it
 *  BEFORE the text so SVG paints it underneath. */
export function makeLabelBg(textEl: SVGTextElement): SVGRectElement {
  const bbox = textEl.getBBox();
  const rect = svgEl("rect", {
    x: bbox.x - LABEL_BG_PAD_X,
    y: bbox.y - LABEL_BG_PAD_Y,
    width: bbox.width + 2 * LABEL_BG_PAD_X,
    height: bbox.height + 2 * LABEL_BG_PAD_Y,
    rx: 3,
    ry: 3,
    class: CSS.POINT_LABEL_BG,
  }) as SVGRectElement;
  return rect;
}

/** Move a chip-background rect so it stays glued to its text after the text
 *  was repositioned (layout flip, drag). Width is read from the rect itself
 *  (set at construction); we only recompute x/y from the text's current
 *  position + text-anchor. */
export function syncLabelBg(bg: SVGRectElement, textEl: SVGTextElement): void {
  const bbox = textEl.getBBox();
  bg.setAttribute("x", String(bbox.x - LABEL_BG_PAD_X));
  bg.setAttribute("y", String(bbox.y - LABEL_BG_PAD_Y));
  bg.setAttribute("width", String(bbox.width + 2 * LABEL_BG_PAD_X));
  bg.setAttribute("height", String(bbox.height + 2 * LABEL_BG_PAD_Y));
}

/** Convert client (screen) coordinates to SVG user-space coordinates using
 *  the SVG's current screen CTM. Returns null if the SVG has no CTM yet
 *  (e.g., not in the layout tree). Pure with respect to the inputs — no
 *  side effects on `svg`. */
export function clientToSvgPoint(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const t = pt.matrixTransform(ctm.inverse());
  return { x: t.x, y: t.y };
}

/** Create an SVG element with attributes. `textContent` is a special key. */
export function svgEl(
  tag: string,
  attrs: Record<string, string | number | undefined | null> = {},
  textContent?: string,
): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    el.setAttribute(key, String(value));
  }
  if (textContent !== undefined) el.textContent = textContent;
  return el;
}

/** Remove all children from a node. */
export function clearChildren(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Format a numeric tick label (drops trailing zeros). */
export function formatTick(value: number): string {
  if (Number.isInteger(value)) return String(value);
  const rounded = Math.round(value * 100) / 100;
  return rounded.toString();
}

/**
 * Produce "nice" tick values across [min, max] aimed at roughly `target`
 * ticks. Snaps the step to a multiple of 1, 2, or 5 × 10^n so labels read
 * cleanly across any axis range (0–1, 0–10, 0–100, 3–47, etc.) — the same
 * idea as D3's `d3.ticks`, scaled down.
 */
export function niceTicks(min: number, max: number, target = 5): number[] {
  const range = max - min;
  if (range <= 0 || !Number.isFinite(range)) return [min, max];
  const rawStep = range / target;
  const exp = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / Math.pow(10, exp);
  // Snap to a "nice" multiplier: 1, 2, 5, 10.
  let niceFraction: number;
  if (fraction < 1.5) niceFraction = 1;
  else if (fraction < 3.5) niceFraction = 2;
  else if (fraction < 7.5) niceFraction = 5;
  else niceFraction = 10;
  const step = niceFraction * Math.pow(10, exp);

  // Trim FP drift to ~10 significant digits. Cleans up cases like
  // `1 - 0.35 = 0.6499999999999999` that arise from data-derived bounds
  // with non-clean padding. Keeps real precision the user might have asked
  // for (e.g., `0.123` survives) while killing the noise tail. Cheaper than
  // a per-step-decimals computation and equivalent in display.
  const clean = (v: number) => Math.round(v * 1e10) / 1e10;

  const ticks: number[] = [];
  // Start at the smallest multiple of step ≥ min (so 3 → ticks at 4, 6, ... if step=2).
  const start = Math.ceil(min / step) * step;
  // Allow tiny floating-point slop on the upper bound.
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // Trim float drift (e.g. 0.1 + 0.1 + 0.1 = 0.30000000000000004).
    ticks.push(clean(Math.round(v / step) * step));
  }
  // Ensure endpoints are represented for typical 0-N axes. clean() the raw
  // min/max before pushing — the loop's snap-to-step protects step-aligned
  // ticks, but boundary endpoints bypass it and were leaking FP tails like
  // `0.6499999999999999` directly into the rendered axis labels.
  if (ticks.length === 0 || ticks[0] > min + step * 0.5) ticks.unshift(clean(min));
  if (ticks[ticks.length - 1] < max - step * 0.5) ticks.push(clean(max));
  return ticks;
}

/** Linear scale from data domain to pixel range. */
export function makeScale(domainMin: number, domainMax: number, rangeMin: number, rangeMax: number) {
  const dSpan = domainMax - domainMin || 1;
  const rSpan = rangeMax - rangeMin;
  return (value: number) => rangeMin + ((value - domainMin) / dSpan) * rSpan;
}

/** Clamp a value to [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Split a label into 1 or 2 lines, breaking at a natural word boundary near the
 * midpoint. Returns a single-element array if the label is short enough to fit
 * on one line. Hard-splits mid-word as a last resort.
 *
 * maxLength is the *per-line* character budget, so a two-line label can show
 * up to roughly 2x that many characters.
 */
export function splitLabel(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  // Hard cap on total length so absurdly long titles don't blow out the chart.
  const totalMax = maxLength * 2;
  const trimmed = text.length > totalMax ? text.slice(0, totalMax - 1) + "…" : text;

  // Look for a space near the midpoint of the trimmed string.
  const mid = Math.floor(trimmed.length / 2);
  let splitIdx = -1;
  for (let offset = 0; offset < trimmed.length / 2; offset++) {
    if (trimmed[mid + offset] === " ") { splitIdx = mid + offset; break; }
    if (mid - offset > 0 && trimmed[mid - offset] === " ") { splitIdx = mid - offset; break; }
  }
  // Fall back to hard split if no space.
  if (splitIdx === -1) splitIdx = mid;

  return [trimmed.slice(0, splitIdx).trimEnd(), trimmed.slice(splitIdx).trimStart()];
}

export interface SimpleRect { x: number; y: number; width: number; height: number; }

/** Axis-aligned rectangle overlap test. */
export function rectsOverlap(a: SimpleRect, b: SimpleRect): boolean {
  return !(
    a.x + a.width < b.x ||
    a.x > b.x + b.width ||
    a.y + a.height < b.y ||
    a.y > b.y + b.height
  );
}
