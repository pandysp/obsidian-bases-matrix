/**
 * Tests for the text-on-color contrast helpers.
 *
 * The locked contract these tests defend:
 *   1. Every palette slot the renderer can pass into `pickContrastingTextColor`
 *      resolves to a defined `#000` or `#fff` (no NaN, no "" — both would
 *      blank the cluster count badge).
 *   2. The light slots that triggered B5 (yellow, lightened variants) pick
 *      BLACK text. This is the visible regression target.
 *   3. The dark slots stay WHITE so we don't accidentally invert the well-
 *      working cases.
 *   4. Unparseable inputs fall back to white (matches the historical
 *      `fill: #fff` default in `.matrix-cluster-count` CSS).
 */
import { describe, expect, test } from "vitest";
import { DEFAULT_PALETTE } from "../color-mapping";
import {
  extractHexFromCssColor,
  pickContrastingTextColor,
  relativeLuminance,
} from "../contrast";

describe("extractHexFromCssColor", () => {
  test("extracts hex fallback from var() wrapper", () => {
    expect(extractHexFromCssColor("var(--color-blue, #4f9eff)")).toBe("#4f9eff");
    expect(extractHexFromCssColor("var(--color-yellow, #f5c518)")).toBe("#f5c518");
  });

  test("accepts a bare 6-digit hex", () => {
    expect(extractHexFromCssColor("#a4cbff")).toBe("#a4cbff");
    expect(extractHexFromCssColor("#FFFFFF")).toBe("#FFFFFF");
  });

  test("accepts a bare 3-digit hex", () => {
    expect(extractHexFromCssColor("#fff")).toBe("#fff");
    expect(extractHexFromCssColor("#000")).toBe("#000");
  });

  test("returns null for unrecognized shapes", () => {
    expect(extractHexFromCssColor("rgb(255, 0, 0)")).toBeNull();
    expect(extractHexFromCssColor("hsl(0, 100%, 50%)")).toBeNull();
    expect(extractHexFromCssColor("red")).toBeNull();
    expect(extractHexFromCssColor("")).toBeNull();
    expect(extractHexFromCssColor("not a color")).toBeNull();
  });

  test("tolerates whitespace inside var()", () => {
    expect(extractHexFromCssColor("var(--color-pink, #ec407a)")).toBe("#ec407a");
    expect(extractHexFromCssColor("  #abcdef  ")).toBe("#abcdef");
  });
});

describe("relativeLuminance", () => {
  test("pure white → 1, pure black → 0", () => {
    expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 6);
    expect(relativeLuminance(0, 0, 0)).toBeCloseTo(0, 6);
  });

  test("monotonic on the grey scale", () => {
    // L is strictly increasing as a grey value (r=g=b) rises from 0 to 255.
    const greys = [0, 32, 64, 96, 128, 160, 192, 224, 255];
    let prev = -Infinity;
    for (const g of greys) {
      const L = relativeLuminance(g, g, g);
      expect(L).toBeGreaterThan(prev);
      prev = L;
    }
  });
});

describe("pickContrastingTextColor — palette regression", () => {
  test("every DEFAULT_PALETTE slot resolves to a valid color", () => {
    for (const slot of DEFAULT_PALETTE) {
      const color = pickContrastingTextColor(slot);
      expect(color === "#000" || color === "#fff").toBe(true);
    }
  });

  // The B5 regression target — the clearly-light slots must take BLACK
  // text to be readable. Hardcoded so a future palette change can't
  // silently flip them back to white and re-introduce the unreadable
  // badge.
  test.each([
    ["yellow (theme token)", "var(--color-yellow, #f5c518)"],
    ["light blue (slot 8)", "#a4cbff"],
    ["light green (slot 9)", "#9ed8a1"],
    ["light yellow (slot 10)", "#fbe389"],
    ["light orange (slot 11)", "#ffcb80"],
    ["light cyan (slot 15)", "#7fdfeb"],
  ])("%s → black text", (_label, color) => {
    expect(pickContrastingTextColor(color)).toBe("#000");
  });

  // Saturated / mid-luminance slots stay white — matches Obsidian's
  // tag-chip / pill conventions of "white on accent" and avoids
  // inverting every cluster's badge from the historical behavior.
  test.each([
    ["blue (theme token)", "var(--color-blue, #4f9eff)"],
    ["red (theme token)", "var(--color-red, #ef5350)"],
    ["orange (theme token)", "var(--color-orange, #ff9800)"],
    ["purple (theme token)", "var(--color-purple, #9c27b0)"],
    ["pink (theme token)", "var(--color-pink, #ec407a)"],
    ["cyan (theme token)", "var(--color-cyan, #00bcd4)"],
    ["green (theme token)", "var(--color-green, #4caf50)"],
    ["light red (slot 12)", "#f8a3a1"],
    ["light purple (slot 13)", "#cb8cd6"],
    ["light pink (slot 14)", "#f5a3c1"],
  ])("%s → white text", (_label, color) => {
    expect(pickContrastingTextColor(color)).toBe("#fff");
  });

  test("falls back to #fff when input is unparseable", () => {
    expect(pickContrastingTextColor("rgb(0, 0, 0)")).toBe("#fff");
    expect(pickContrastingTextColor("")).toBe("#fff");
    expect(pickContrastingTextColor("garbage")).toBe("#fff");
  });
});
