/**
 * Tests for entry-to-datum — the pure entry → PointDatum conversion that
 * was inlined in matrix-view.buildDataset. Two units extracted:
 *
 *   - entryToRawPoint:    one entry → raw fields (or null on missing required)
 *   - computeSizeFactor:  raw size + dataset range → normalized factor
 *
 * BUG-22 anchor: the original commit used `extractNumber`/`extractString`
 * which still apply, but the orchestration above them was inlined and
 * untested. Now the "skip if x or y missing" logic is locked.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { entryToRawPoint, computeSizeFactor, type EntryLike } from "../entry-to-datum";

/** Minimal Bases-entry mock: getValue lookup + optional file. */
function fakeEntry(values: Record<string, unknown>, filePath = "notes/Test.md"): EntryLike {
  return {
    file: filePath ? { path: filePath } : undefined,
    getValue: (id: string) => values[id],
  };
}

class NullValue {
  isTruthy(): boolean { return false; }
  toString(): string { return ""; }
}

describe("entryToRawPoint — concrete cases", () => {
  test("happy path: returns full raw point", () => {
    const e = fakeEntry({ "note.x": 5, "note.y": 7 }, "notes/Foo.md");
    const r = entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: null });
    expect(r).toEqual({
      entry: e, filePath: "notes/Foo.md",
      x: 5, y: 7, color: null, sizeRaw: null,
    });
  });

  test("missing x → null", () => {
    const e = fakeEntry({ "note.y": 7 });
    expect(entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: null })).toBeNull();
  });

  test("missing y → null", () => {
    const e = fakeEntry({ "note.x": 5 });
    expect(entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: null })).toBeNull();
  });

  test("NullValue x → null (uses isValueEmpty contract)", () => {
    const e = fakeEntry({ "note.x": new NullValue(), "note.y": 7 });
    expect(entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: null })).toBeNull();
  });

  test("missing file path → null", () => {
    const e = fakeEntry({ "note.x": 5, "note.y": 7 }, "");
    expect(entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: null })).toBeNull();
  });

  test("colorProp set → color extracted; missing color leaves it null", () => {
    const e = fakeEntry({ "note.x": 5, "note.y": 7, "note.area": "personal" });
    const r = entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: "note.area", sizeProp: null });
    expect(r?.color).toBe("personal");

    const e2 = fakeEntry({ "note.x": 5, "note.y": 7 });
    const r2 = entryToRawPoint(e2, { xProp: "note.x", yProp: "note.y", colorProp: "note.area", sizeProp: null });
    expect(r2?.color).toBeNull();
  });

  test("sizeProp set → sizeRaw extracted as a number", () => {
    const e = fakeEntry({ "note.x": 5, "note.y": 7, "note.priority": 3 });
    const r = entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: "note.priority" });
    expect(r?.sizeRaw).toBe(3);
  });
});

describe("entryToRawPoint — properties", () => {
  test("property: any (x, y) numeric pair with a path produces a non-null result", () =>
    hegel.test((tc) => {
      const x = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const y = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const e = fakeEntry({ "note.x": x, "note.y": y }, "notes/x.md");
      const r = entryToRawPoint(e, { xProp: "note.x", yProp: "note.y", colorProp: null, sizeProp: null });
      if (r === null) throw new Error(`null for valid input (${x}, ${y})`);
      if (r.x !== x || r.y !== y) throw new Error(`wrong coords: (${r.x},${r.y}) vs (${x},${y})`);
    }));
});

describe("computeSizeFactor — concrete cases", () => {
  // Formula: 0.6 + ((raw - min) / (max - min)) * 1.0  → range [0.6, 1.6]

  test("rawSize null → 1 (baseline)", () => {
    expect(computeSizeFactor(null, 0, 10)).toBe(1);
  });

  test("zero range → 1 (every value gets baseline)", () => {
    expect(computeSizeFactor(5, 5, 5)).toBe(1);
  });

  test("min value → 0.6", () => {
    expect(computeSizeFactor(0, 0, 10)).toBeCloseTo(0.6, 5);
  });

  test("max value → 1.6", () => {
    expect(computeSizeFactor(10, 0, 10)).toBeCloseTo(1.6, 5);
  });

  test("midpoint → 1.1", () => {
    expect(computeSizeFactor(5, 0, 10)).toBeCloseTo(1.1, 5);
  });
});

describe("computeSizeFactor — properties", () => {
  test("property: result always in [0.6, 1.6] when raw is in [min, max]", () =>
    hegel.test((tc) => {
      const min = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const max = tc.draw(gs.integers({ minValue: min + 1, maxValue: min + 200 }));
      const raw = tc.draw(gs.integers({ minValue: min, maxValue: max }));
      const r = computeSizeFactor(raw, min, max);
      if (r < 0.6 - 1e-9 || r > 1.6 + 1e-9) {
        throw new Error(`out of bounds: ${r} for raw=${raw}, min=${min}, max=${max}`);
      }
    }));

  test("property: monotonic non-decreasing in raw value", () =>
    hegel.test((tc) => {
      const min = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const max = tc.draw(gs.integers({ minValue: min + 1, maxValue: min + 200 }));
      const a = tc.draw(gs.integers({ minValue: min, maxValue: max }));
      const b = tc.draw(gs.integers({ minValue: a, maxValue: max }));
      const ra = computeSizeFactor(a, min, max);
      const rb = computeSizeFactor(b, min, max);
      if (rb < ra - 1e-9) {
        throw new Error(`not monotonic: a=${a}→${ra}, b=${b}→${rb}`);
      }
    }));

  test("property: zero range collapses everything to 1", () =>
    hegel.test((tc) => {
      const v = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const r = computeSizeFactor(v, v, v); // range zero
      if (r !== 1) throw new Error(`zero-range gave ${r} not 1`);
    }));

  test("property: null raw is always 1 regardless of range", () =>
    hegel.test((tc) => {
      const min = tc.draw(gs.integers({ minValue: -100, maxValue: 100 }));
      const max = tc.draw(gs.integers({ minValue: min, maxValue: min + 200 }));
      const r = computeSizeFactor(null, min, max);
      if (r !== 1) throw new Error(`null raw gave ${r} not 1`);
    }));
});
