/**
 * Tests for gradient-color — continuous color assignment from numeric values.
 *
 * Three input parsers, three palettes, one direction flag. PBTs cover the
 * core invariants:
 *   - Parser monotonicity (earlier dates / better grades produce smaller
 *     numbers, so they map to the "low" end of the gradient).
 *   - Interpolation endpoints exact, midpoint reasonable, monotonic in t.
 *   - colorAt(value) consistent under direction flip.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  parseGradientValue,
  interpolatePalette,
  gradientColorFor,
  GRADIENT_PALETTES,
  detectGradientType,
  type GradientPaletteName,
} from "../gradient-color";

describe("parseGradientValue", () => {
  test("numbers pass through unchanged", () => {
    expect(parseGradientValue(0, true)).toBe(0);
    expect(parseGradientValue(31.7, true)).toBe(31.7);
    expect(parseGradientValue(-5, true)).toBe(-5);
  });

  test("numeric strings parse as numbers", () => {
    expect(parseGradientValue("31.7", true)).toBe(31.7);
    expect(parseGradientValue("0", true)).toBe(0);
  });

  test("ISO date strings parse as timestamps", () => {
    const jan1 = parseGradientValue("2024-01-01", true)!;
    const dec31 = parseGradientValue("2024-12-31", true)!;
    expect(jan1).toBeLessThan(dec31);
  });

  test("ISO date with time still parses", () => {
    expect(parseGradientValue("2024-06-15T12:30:00", true)).toBeTypeOf("number");
  });

  test("letter grades parse to ordinals (A high, F low) when allowed", () => {
    const A = parseGradientValue("A", true)!;
    const B = parseGradientValue("B", true)!;
    const F = parseGradientValue("F", true)!;
    expect(A).toBeGreaterThan(B);
    expect(B).toBeGreaterThan(F);
  });

  test("letter grade modifiers (A+, A, A-) ordered", () => {
    const aPlus = parseGradientValue("A+", true)!;
    const a = parseGradientValue("A", true)!;
    const aMinus = parseGradientValue("A-", true)!;
    const bPlus = parseGradientValue("B+", true)!;
    expect(aPlus).toBeGreaterThan(a);
    expect(a).toBeGreaterThan(aMinus);
    expect(aMinus).toBeGreaterThan(bPlus);
  });

  test("letter grades return null when not allowed", () => {
    expect(parseGradientValue("A", false)).toBeNull();
    expect(parseGradientValue("F", false)).toBeNull();
  });

  test("non-numeric, non-date, non-grade strings return null", () => {
    expect(parseGradientValue("hello", true)).toBeNull();
    expect(parseGradientValue("Tools", true)).toBeNull();
    expect(parseGradientValue("Z", true)).toBeNull();   // not a letter grade
  });

  test("null/undefined return null", () => {
    expect(parseGradientValue(null, true)).toBeNull();
    expect(parseGradientValue(undefined, true)).toBeNull();
  });

  test("single-digit string '1' parses as number, NOT as a year", () => {
    // Date.parse("1") returns a timestamp in some interpretations — the
    // numeric path must win so ratings 1-5 aren't accidentally dates.
    expect(parseGradientValue("1", true)).toBe(1);
    expect(parseGradientValue("5", true)).toBe(5);
  });

  test("property: ISO date strings are monotonic", () =>
    hegel.test((tc) => {
      const m = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
      const m2 = tc.draw(gs.integers({ minValue: m, maxValue: 12 }));
      const d1 = `2024-${String(m).padStart(2, "0")}-15`;
      const d2 = `2024-${String(m2).padStart(2, "0")}-15`;
      const v1 = parseGradientValue(d1, true)!;
      const v2 = parseGradientValue(d2, true)!;
      if (v2 < v1) throw new Error(`${d1} → ${v1} should be ≤ ${d2} → ${v2}`);
    }));
});

describe("detectGradientType", () => {
  test("all numeric → numeric", () => {
    expect(detectGradientType([1, 2, 3, "4", "5.5"])).toBe("numeric");
  });

  test("all ISO dates → date", () => {
    expect(detectGradientType(["2024-01-01", "2024-06-15", "2024-12-31"])).toBe("date");
  });

  test("mixed numeric and string → categorical (fallback)", () => {
    expect(detectGradientType([1, "hello", 3])).toBe("categorical");
  });

  test("letter grades alone → categorical in auto mode", () => {
    // Letter grades require explicit opt-in via colorScale; not auto.
    expect(detectGradientType(["A", "B", "C"])).toBe("categorical");
  });

  test("empty input → categorical", () => {
    expect(detectGradientType([])).toBe("categorical");
  });

  test("all MM:SS time strings → time (auto)", () => {
    expect(detectGradientType(["5:45", "6:00", "5:30"])).toBe("time");
  });

  test("all HH:MM:SS time strings → time (auto)", () => {
    expect(detectGradientType(["1:30:45", "3:42:15"])).toBe("time");
  });

  test("mixed time and numeric → categorical (no first-class type covers all)", () => {
    expect(detectGradientType(["5:45", 6])).toBe("categorical");
  });
});

describe("parseGradientValue — time strings", () => {
  // Added when value-type subsumed gradient-color's parser. The gradient
  // module's auto-detect now picks up "time" alongside "numeric" / "date",
  // so colorBy=pace yields a continuous gradient with no extra config.

  test("MM:SS string parses to seconds", () => {
    expect(parseGradientValue("5:45", false)).toBe(5 * 60 + 45);
  });

  test("HH:MM:SS string parses to seconds", () => {
    expect(parseGradientValue("3:42:15", false)).toBe(3 * 3600 + 42 * 60 + 15);
  });

  test("time strings parse even when letter-grade opt-in is false (time isn't ambiguous)", () => {
    expect(parseGradientValue("6:00", false)).toBe(360);
  });
});

describe("gradientColorFor — time domain (end-to-end)", () => {
  // The training-log scenario: colorBy=note.pace with values like
  // "5:45" / "6:20". The pipeline is parseGradientValue → gradientColorFor.
  // Locks the smaller value getting "good" end with low-is-good direction.

  test("low-is-good: lowest pace gets the green end", () => {
    const fastSec = parseGradientValue("4:55", false)!;  // best
    const slowSec = parseGradientValue("6:30", false)!;  // worst
    const fastColor = gradientColorFor(fastSec, fastSec, slowSec, "red-yellow-green", "low-is-good");
    const slowColor = gradientColorFor(slowSec, fastSec, slowSec, "red-yellow-green", "low-is-good");
    expect(fastColor).not.toBe(slowColor); // distinct
    // fastColor should be the "green" end (palette[2]); slowColor the
    // "red" end (palette[0]). Format may be hex (exact stop) or rgb().
    expect(fastColor.toLowerCase()).toMatch(/^#4c|^rgb\(76/i);
    expect(slowColor.toLowerCase()).toMatch(/^#ef|^rgb\(239/i);
  });
});

/** Extract the R channel from either `rgb(r, g, b)` or `#rrggbb`. */
function redChannelOf(color: string): number {
  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (rgbMatch) return parseInt(rgbMatch[1], 10);
  const hexMatch = color.match(/^#([0-9a-f]{2})[0-9a-f]{4}$/i);
  if (hexMatch) return parseInt(hexMatch[1], 16);
  return -1;
}

describe("interpolatePalette", () => {
  test("t=0 returns the first stop, t=1 returns the last stop", () => {
    const stops = ["#ff0000", "#ffff00", "#00ff00"];
    expect(interpolatePalette(0, stops)).toBe("#ff0000");
    expect(interpolatePalette(1, stops)).toBe("#00ff00");
  });

  test("t=0.5 of a 3-stop palette returns the middle stop", () => {
    const stops = ["#ff0000", "#ffff00", "#00ff00"];
    expect(interpolatePalette(0.5, stops)).toBe("#ffff00");
  });

  test("t clamps to [0, 1]", () => {
    const stops = ["#ff0000", "#00ff00"];
    expect(interpolatePalette(-0.5, stops)).toBe("#ff0000");
    expect(interpolatePalette(2, stops)).toBe("#00ff00");
  });

  test("returns a valid CSS color string", () => {
    const stops = ["#ff0000", "#00ff00"];
    const c = interpolatePalette(0.25, stops);
    expect(c).toMatch(/^rgb\(\d+, \d+, \d+\)$|^#[0-9a-f]{6}$/i);
  });

  test("property: monotonic component progression in 2-stop palette", () =>
    hegel.test((tc) => {
      // From pure red (#ff0000) to pure green (#00ff00): as t grows, the R
      // channel must monotonically decrease and the G channel must
      // monotonically increase.
      const t1 = tc.draw(gs.integers({ minValue: 0, maxValue: 50 })) / 100;
      const t2Raw = tc.draw(gs.integers({ minValue: 0, maxValue: 50 })) / 100;
      const t2 = t1 + t2Raw;
      if (t2 > 1) return;
      const stops = ["#ff0000", "#00ff00"];
      const a = interpolatePalette(t1, stops);
      const b = interpolatePalette(t2, stops);
      const rA = redChannelOf(a);
      const rB = redChannelOf(b);
      if (rB > rA) throw new Error(`R should decrease: t=${t1}→${rA}, t=${t2}→${rB}`);
    }));
});

describe("gradientColorFor", () => {
  const palette: GradientPaletteName = "red-yellow-green";

  test("min value → red end (low is good = false)", () => {
    const c = gradientColorFor(0, 0, 100, palette, "high-is-good");
    expect(c.toLowerCase()).toMatch(/^#ef|^rgb\(239/i);
  });

  test("max value → green end (low is good = false)", () => {
    const c = gradientColorFor(100, 0, 100, palette, "high-is-good");
    expect(c.toLowerCase()).toMatch(/^#4c|^rgb\(76/i);
  });

  test("low-is-good flips the direction: min → green, max → red", () => {
    const lo = gradientColorFor(0, 0, 100, palette, "low-is-good");
    const hi = gradientColorFor(100, 0, 100, palette, "low-is-good");
    // Low value should now be GREEN (good), high should be RED (bad).
    expect(lo.toLowerCase()).toMatch(/^#4c|^rgb\(76/i);
    expect(hi.toLowerCase()).toMatch(/^#ef|^rgb\(239/i);
  });

  test("min === max → midpoint color (no spread, no panic)", () => {
    const c = gradientColorFor(5, 5, 5, palette, "low-is-good");
    expect(c).toBeDefined();
  });

  test("property: endpoints are color-distinct from the middle (non-degenerate range)", () =>
    hegel.test((tc) => {
      // Diverging palettes aren't channel-monotonic (R can rise red→yellow
      // then fall to green). Test a weaker but real property: across any
      // non-degenerate value range, the min, midpoint, and max values
      // produce three distinct gradient colors.
      const min = tc.draw(gs.integers({ minValue: 0, maxValue: 50 }));
      const max = tc.draw(gs.integers({ minValue: min + 10, maxValue: 100 }));
      const mid = (min + max) / 2;
      const cLo = gradientColorFor(min, min, max, palette, "low-is-good");
      const cMid = gradientColorFor(mid, min, max, palette, "low-is-good");
      const cHi = gradientColorFor(max, min, max, palette, "low-is-good");
      if (cLo === cMid || cMid === cHi || cLo === cHi) {
        throw new Error(`expected 3 distinct colors, got ${cLo} / ${cMid} / ${cHi}`);
      }
    }));

  test("property: direction flip swaps min and max colors", () =>
    hegel.test((tc) => {
      const min = tc.draw(gs.integers({ minValue: 0, maxValue: 50 }));
      const max = tc.draw(gs.integers({ minValue: min + 10, maxValue: 100 }));
      const lowGood = gradientColorFor(min, min, max, palette, "low-is-good");
      const highGood = gradientColorFor(min, min, max, palette, "high-is-good");
      if (lowGood === highGood) {
        throw new Error(`direction flip should change color for min value, both = ${lowGood}`);
      }
      // And it must agree with the flipped query at max:
      const highGoodMax = gradientColorFor(max, min, max, palette, "high-is-good");
      if (lowGood !== highGoodMax) {
        throw new Error(`min@low-is-good (${lowGood}) should equal max@high-is-good (${highGoodMax})`);
      }
    }));
});

describe("GRADIENT_PALETTES", () => {
  test("each named palette has at least 2 color stops", () => {
    for (const [name, stops] of Object.entries(GRADIENT_PALETTES)) {
      expect(stops.length, `palette ${name} too short`).toBeGreaterThanOrEqual(2);
    }
  });

  test("includes all three documented palette names", () => {
    expect(GRADIENT_PALETTES).toHaveProperty("red-yellow-green");
    expect(GRADIENT_PALETTES).toHaveProperty("viridis");
    expect(GRADIENT_PALETTES).toHaveProperty("red-white-blue");
  });
});
