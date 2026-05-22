/**
 * Text-on-color contrast helpers.
 *
 * Single use site today: the cluster-count badge painted over a palette-
 * colored disc. White text fails WCAG AA on the light slots (yellow,
 * lightened variants used past N=8 categories), and a soft text-shadow
 * isn't strong enough to rescue it. Picking black or white per cluster
 * from the cluster fill's luminance keeps the count legible on every
 * palette slot in both light and dark themes.
 *
 * We parse the input string rather than reading `getComputedStyle()` on
 * an element because the text node may be styled before insertion into
 * the DOM. The palette uses two shapes:
 *
 *   1. `var(--color-NAME, #fallback)` — theme tokens. We extract the
 *      `#fallback` hex (Obsidian's default), accepting that a heavily-
 *      customized theme could push a hue light/dark enough to flip the
 *      ideal text color. In practice the defaults track the named hue
 *      well across community themes.
 *
 *   2. Direct `#hex` — the lightened static variants (slots 8-15).
 *
 * Both 3-digit (`#abc`) and 6-digit (`#aabbcc`) hex forms are accepted.
 * Anything we can't parse falls back to white — matches the historical
 * default and the CSS fallback in `.matrix-cluster-count`.
 */

/** Pull the `#hex` value out of `var(--name, #hex)` wrappers, or accept
 *  a bare hex as-is. Returns null for unrecognized shapes (rgb(), hsl(),
 *  named colors, etc.) — callers should treat null as "unknown" and pick
 *  a safe default. */
export function extractHexFromCssColor(color: string): string | null {
  const trimmed = color.trim();
  const varMatch = trimmed.match(/var\([^,)]+,\s*(#[0-9a-fA-F]{3,8})\s*\)/);
  if (varMatch) return varMatch[1];
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) return trimmed;
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed;
  return null;
}

/** WCAG-style relative luminance for sRGB, 0..1. Standard formula:
 *  linearize each channel via the 0.03928 piecewise transform, then
 *  weighted sum 0.2126 R + 0.7152 G + 0.0722 B. */
export function relativeLuminance(r: number, g: number, b: number): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Pick `#000` or `#fff` to overlay on a background described by a CSS
 *  color string (supports the `var(--name, #hex)` and direct `#hex`
 *  shapes used by the cluster palette).
 *
 *  Threshold 0.5 is the Material Design / common-UI heuristic — flips
 *  to black ONLY for the clearly-light slots (yellow, lightened
 *  variants) where the historical white text fails. Saturated mid-
 *  luminance slots (blue, red, pink) keep their white text matching
 *  Obsidian's own chip / tag conventions. The strict-WCAG threshold
 *  (~0.179, where contrast against black equals contrast against white)
 *  would invert nearly every saturated color and conflict with the
 *  surrounding UI's "white on accent" idiom. */
export function pickContrastingTextColor(bgColor: string): string {
  const hex = extractHexFromCssColor(bgColor);
  if (!hex) return "#fff";
  let r: number, g: number, b: number;
  if (hex.length === 4) {
    r = parseInt(hex[1] + hex[1], 16);
    g = parseInt(hex[2] + hex[2], 16);
    b = parseInt(hex[3] + hex[3], 16);
  } else {
    r = parseInt(hex.slice(1, 3), 16);
    g = parseInt(hex.slice(3, 5), 16);
    b = parseInt(hex.slice(5, 7), 16);
  }
  return relativeLuminance(r, g, b) > 0.5 ? "#000" : "#fff";
}
