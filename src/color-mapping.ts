/**
 * Color-assignment helpers — category → palette-slot mapping.
 *
 * Two layers with deliberately different semantics:
 *
 *   - `colorForCategory(name)` is a pure hash-of-name lookup. Stable per
 *     name. Collisions possible. Used for one-off lookups where there is
 *     no notion of "other categories" (e.g., cluster representative).
 *
 *   - `buildColorMap(categories)` is SET-AWARE: deterministic per input
 *     set, with collision avoidance via linear probing over the hash. As
 *     long as N ≤ palette.length, every category gets a distinct color.
 *     For N > palette.length the palette wraps and duplicates resume.
 *
 * Trade-off from pre-collision-fix behavior: the original BUG-18 fix relied
 * on color being a pure function of name (so filtering preserved every
 * slot). Collision-aware assignment depends on the input set, so dropping
 * a category that previously caused a probe-forward CAN shift the probed-to
 * category back. Accepted as the price of guaranteed N ≤ P distinctness —
 * the visible-pink-collision at N=4 was the worse UX in practice.
 *
 * Cluster representative color (mode of members) is a different concern —
 * lives in cluster-renderer because it needs the actual member objects.
 */

/**
 * Default palette: 8 Obsidian-theme tokens followed by 8 lightened static
 * variants. Slots 0-7 are theme-aware (track Minimal / default / user CSS).
 * Slots 8-15 are static lightened versions of the same hues — used only when
 * a colorBy axis has > 8 distinct categories, so the everyday case stays
 * fully themed.
 */
export const DEFAULT_PALETTE: readonly string[] = [
  // Themed base: track Obsidian's --color-* variables.
  "var(--color-blue, #4f9eff)",
  "var(--color-green, #4caf50)",
  "var(--color-yellow, #f5c518)",
  "var(--color-orange, #ff9800)",
  "var(--color-red, #ef5350)",
  "var(--color-purple, #9c27b0)",
  "var(--color-pink, #ec407a)",
  "var(--color-cyan, #00bcd4)",
  // Lightened static variants (HSL lightness +~18% from the fallback hex).
  // Theme-insensitive but visually distinct from the base. Only used when
  // colorBy has > 8 categories.
  "#a4cbff", // light blue
  "#9ed8a1", // light green
  "#fbe389", // light yellow
  "#ffcb80", // light orange
  "#f8a3a1", // light red
  "#cb8cd6", // light purple
  "#f5a3c1", // light pink
  "#7fdfeb", // light cyan
];

/**
 * djb2-style string hash. Deterministic, fast, good distribution.
 * Always returns a non-negative integer (the abs is what makes the modulo
 * usable as a palette index).
 */
export function hashCategory(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Map a single category to a palette color via pure hash. Stable per name,
 * but does NOT consider any other categories — collisions possible. Prefer
 * `buildColorMap` when you have a known set of categories to color.
 */
export function colorForCategory(
  category: string,
  palette: readonly string[] = DEFAULT_PALETTE,
): string {
  const idx = hashCategory(category) % palette.length;
  return palette[idx];
}

/**
 * Build a Map<category, color> covering every unique category in the input.
 *
 * Assignment strategy: iterate in sorted order (so the result is independent
 * of insertion order), compute the hash-derived preferred slot, and linear-
 * probe forward when that slot is taken. For N ≤ palette.length this
 * guarantees every category gets a unique color. For N > palette.length the
 * probing wraps and reuses slots (palette duplication is unavoidable).
 *
 * The sorted iteration order is the deterministic tiebreaker — without it,
 * two inputs with the same set but different order could produce different
 * collision-resolution paths.
 */
export function buildColorMap(
  categories: Iterable<string>,
  palette: readonly string[] = DEFAULT_PALETTE,
): Map<string, string> {
  const unique = [...new Set(categories)].sort();
  const map = new Map<string, string>();
  const used = new Set<number>();
  const P = palette.length;
  for (const c of unique) {
    let idx = hashCategory(c) % P;
    // Linear probe until we find a free slot. When the palette is full
    // (used.size === P), every slot is taken and we just take the hash
    // slot as-is — duplicates are unavoidable beyond N=P.
    if (used.size < P) {
      while (used.has(idx)) idx = (idx + 1) % P;
    }
    used.add(idx);
    map.set(c, palette[idx]);
  }
  return map;
}
