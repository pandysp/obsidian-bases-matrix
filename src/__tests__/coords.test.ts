/**
 * Tests for pixel ↔ data coordinate translation. Two call sites in
 * drag-manager (single-point commit, cluster commit) used to inline the math
 * differently — single-point used makeInverseScale + clamp, cluster used
 * inlined pixel-per-unit + manual Y-inversion. Centralizing in ./coords
 * forces consistency and makes the round-trip property explicit.
 *
 * Y axis is screen-inverted: pixel Y increases downward, data Y increases
 * upward. This is the source of every "wait, why is the value going down?"
 * bug in chart code; the property tests below pin it down.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { pixelToDataPoint, pixelToDataDelta, type PlotBox, type AxisRange } from "../coords";

const STD_PLOT: PlotBox = { left: 72, right: 800, top: 24, bottom: 400 };
const STD_AXES: AxisRange = { xMin: 0, xMax: 10, yMin: 0, yMax: 10 };

describe("pixelToDataPoint — concrete cases", () => {
  test("plot top-left pixel maps to (xMin, yMax)", () => {
    // Pixel (left, top) is the top-left visual corner. With Y inverted,
    // top corresponds to the largest data Y.
    const r = pixelToDataPoint({ pixelX: 72, pixelY: 24, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataX).toBeCloseTo(0, 5);
    expect(r.dataY).toBeCloseTo(10, 5);
  });

  test("plot bottom-right pixel maps to (xMax, yMin)", () => {
    const r = pixelToDataPoint({ pixelX: 800, pixelY: 400, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataX).toBeCloseTo(10, 5);
    expect(r.dataY).toBeCloseTo(0, 5);
  });

  test("plot center pixel maps to axis midpoint", () => {
    const cx = (72 + 800) / 2;
    const cy = (24 + 400) / 2;
    const r = pixelToDataPoint({ pixelX: cx, pixelY: cy, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataX).toBeCloseTo(5, 5);
    expect(r.dataY).toBeCloseTo(5, 5);
  });

  test("pixel left of plot left clamps to xMin", () => {
    const r = pixelToDataPoint({ pixelX: 0, pixelY: 200, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataX).toBe(0);
  });

  test("pixel right of plot right clamps to xMax", () => {
    const r = pixelToDataPoint({ pixelX: 9999, pixelY: 200, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataX).toBe(10);
  });

  test("pixel above plot top clamps to yMax", () => {
    const r = pixelToDataPoint({ pixelX: 400, pixelY: -100, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataY).toBe(10);
  });

  test("pixel below plot bottom clamps to yMin", () => {
    const r = pixelToDataPoint({ pixelX: 400, pixelY: 9999, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataY).toBe(0);
  });
});

describe("pixelToDataPoint — properties", () => {
  test("property: result always lies within axis bounds", () =>
    hegel.test((tc) => {
      const px = tc.draw(gs.integers({ minValue: -10000, maxValue: 10000 }));
      const py = tc.draw(gs.integers({ minValue: -10000, maxValue: 10000 }));
      const r = pixelToDataPoint({ pixelX: px, pixelY: py, plot: STD_PLOT, axes: STD_AXES });
      if (r.dataX < STD_AXES.xMin || r.dataX > STD_AXES.xMax) {
        throw new Error(`dataX=${r.dataX} outside [${STD_AXES.xMin}, ${STD_AXES.xMax}]`);
      }
      if (r.dataY < STD_AXES.yMin || r.dataY > STD_AXES.yMax) {
        throw new Error(`dataY=${r.dataY} outside [${STD_AXES.yMin}, ${STD_AXES.yMax}]`);
      }
    }));

  test("property: Y-inversion — increasing pixel Y means decreasing data Y", () =>
    hegel.test((tc) => {
      const px = tc.draw(gs.integers({ minValue: 100, maxValue: 700 }));
      const pyA = tc.draw(gs.integers({ minValue: 50, maxValue: 200 }));
      const pyB = tc.draw(gs.integers({ minValue: pyA + 10, maxValue: 350 }));
      const a = pixelToDataPoint({ pixelX: px, pixelY: pyA, plot: STD_PLOT, axes: STD_AXES });
      const b = pixelToDataPoint({ pixelX: px, pixelY: pyB, plot: STD_PLOT, axes: STD_AXES });
      if (b.dataY > a.dataY) {
        throw new Error(`Y not inverted: pixel ${pyA}→${a.dataY}, pixel ${pyB}→${b.dataY}`);
      }
    }));

  test("property: monotonic in X — increasing pixel X means non-decreasing data X", () =>
    hegel.test((tc) => {
      const py = tc.draw(gs.integers({ minValue: 50, maxValue: 350 }));
      const pxA = tc.draw(gs.integers({ minValue: 100, maxValue: 400 }));
      const pxB = tc.draw(gs.integers({ minValue: pxA + 10, maxValue: 700 }));
      const a = pixelToDataPoint({ pixelX: pxA, pixelY: py, plot: STD_PLOT, axes: STD_AXES });
      const b = pixelToDataPoint({ pixelX: pxB, pixelY: py, plot: STD_PLOT, axes: STD_AXES });
      if (b.dataX < a.dataX) {
        throw new Error(`X not monotonic: pixel ${pxA}→${a.dataX}, pixel ${pxB}→${b.dataX}`);
      }
    }));

  test("property: round-trip from plot interior — pixel that's inside the plot maps back near itself", () =>
    hegel.test((tc) => {
      // For pixels strictly inside the plot, no clamping fires, so the
      // inverse should be exact (within float epsilon).
      const px = tc.draw(gs.integers({ minValue: 73, maxValue: 799 }));
      const py = tc.draw(gs.integers({ minValue: 25, maxValue: 399 }));
      const data = pixelToDataPoint({ pixelX: px, pixelY: py, plot: STD_PLOT, axes: STD_AXES });
      // Forward project back to pixel space using the same shape.
      const xPerUnit = (STD_PLOT.right - STD_PLOT.left) / (STD_AXES.xMax - STD_AXES.xMin);
      const yPerUnit = (STD_PLOT.bottom - STD_PLOT.top) / (STD_AXES.yMax - STD_AXES.yMin);
      const backX = STD_PLOT.left + (data.dataX - STD_AXES.xMin) * xPerUnit;
      const backY = STD_PLOT.bottom - (data.dataY - STD_AXES.yMin) * yPerUnit;
      if (Math.abs(backX - px) > 1e-6) throw new Error(`X round-trip drift: ${px}→${data.dataX}→${backX}`);
      if (Math.abs(backY - py) > 1e-6) throw new Error(`Y round-trip drift: ${py}→${data.dataY}→${backY}`);
    }));
});

describe("pixelToDataDelta — concrete cases", () => {
  test("zero pixel delta = zero data delta", () => {
    const r = pixelToDataDelta({ pixelDx: 0, pixelDy: 0, plot: STD_PLOT, axes: STD_AXES });
    // Use == 0 (not toBe) — IEEE -0 is mathematically zero; the sign is a
    // quirk of the negation in Y-inversion and not user-visible.
    expect(r.dataDx === 0).toBe(true);
    expect(r.dataDy === 0).toBe(true);
  });

  test("positive pixel dy → negative data dy (Y inversion)", () => {
    // Pixel down = data down (lower value).
    const r = pixelToDataDelta({ pixelDx: 0, pixelDy: 100, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataDy).toBeLessThan(0);
  });

  test("positive pixel dx → positive data dx (no inversion on X)", () => {
    const r = pixelToDataDelta({ pixelDx: 100, pixelDy: 0, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataDx).toBeGreaterThan(0);
  });

  test("delta is NOT clamped to axis bounds (delta can exceed range)", () => {
    // A delta of 10000 pixels right is silly but mathematically valid;
    // the function returns the raw conversion, caller decides what to do.
    const r = pixelToDataDelta({ pixelDx: 10000, pixelDy: 0, plot: STD_PLOT, axes: STD_AXES });
    expect(r.dataDx).toBeGreaterThan(STD_AXES.xMax);
  });
});

describe("pixelToDataDelta — properties", () => {
  test("property: linearity — pixelToDataDelta(k*d) = k * pixelToDataDelta(d)", () =>
    hegel.test((tc) => {
      const dx = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const dy = tc.draw(gs.integers({ minValue: -200, maxValue: 200 }));
      const k = tc.draw(gs.integers({ minValue: -5, maxValue: 5 }));
      const single = pixelToDataDelta({ pixelDx: dx, pixelDy: dy, plot: STD_PLOT, axes: STD_AXES });
      const scaled = pixelToDataDelta({ pixelDx: k * dx, pixelDy: k * dy, plot: STD_PLOT, axes: STD_AXES });
      if (Math.abs(scaled.dataDx - k * single.dataDx) > 1e-9) {
        throw new Error(`X non-linear at k=${k}: scaled=${scaled.dataDx}, expected=${k * single.dataDx}`);
      }
      if (Math.abs(scaled.dataDy - k * single.dataDy) > 1e-9) {
        throw new Error(`Y non-linear at k=${k}: scaled=${scaled.dataDy}, expected=${k * single.dataDy}`);
      }
    }));

  test("property: Y inversion sign holds for all non-zero pixel dy", () =>
    hegel.test((tc) => {
      const dy = tc.draw(gs.integers({ minValue: 1, maxValue: 500 }));
      const r = pixelToDataDelta({ pixelDx: 0, pixelDy: dy, plot: STD_PLOT, axes: STD_AXES });
      if (r.dataDy >= 0) throw new Error(`positive pixel dy=${dy} should give negative data dy, got ${r.dataDy}`);
      const r2 = pixelToDataDelta({ pixelDx: 0, pixelDy: -dy, plot: STD_PLOT, axes: STD_AXES });
      if (r2.dataDy <= 0) throw new Error(`negative pixel dy=${-dy} should give positive data dy, got ${r2.dataDy}`);
    }));

  test("property: round-trip with the inverse direction", () =>
    hegel.test((tc) => {
      const dx = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const dy = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const data = pixelToDataDelta({ pixelDx: dx, pixelDy: dy, plot: STD_PLOT, axes: STD_AXES });
      // Reverse via the same formulas:
      const xPerUnit = (STD_PLOT.right - STD_PLOT.left) / (STD_AXES.xMax - STD_AXES.xMin);
      const yPerUnit = (STD_PLOT.bottom - STD_PLOT.top) / (STD_AXES.yMax - STD_AXES.yMin);
      const backDx = data.dataDx * xPerUnit;
      const backDy = -data.dataDy * yPerUnit;
      if (Math.abs(backDx - dx) > 1e-6) throw new Error(`X round-trip drift: ${dx}→${data.dataDx}→${backDx}`);
      if (Math.abs(backDy - dy) > 1e-6) throw new Error(`Y round-trip drift: ${dy}→${data.dataDy}→${backDy}`);
    }));
});
