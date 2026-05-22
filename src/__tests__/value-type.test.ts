/**
 * Tests for value-type — the unified detect/parse/format layer for axis and
 * color values. Replaces ad-hoc Number() coercion with a typed pipeline that
 * handles plain numbers, time durations (MM:SS, HH:MM:SS), and ISO dates as
 * first-class types.
 *
 * Internal canonical unit: SECONDS. A 5:45 pace stores as 345; a marathon
 * 3:42:15 stores as 13335. Lossless round-trips for any HMS string with
 * seconds in [0, 59].
 *
 * Why seconds and not minutes: HH:MM:SS would lose precision at the second
 * boundary under minute-as-fraction. Seconds-as-integer makes round-trip
 * exact for the formats users write.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  detectValueType,
  parseValue,
  formatValue,
  type ValueType,
} from "../value-type";
import { isValueEmpty } from "../value-extraction";

describe("detectValueType", () => {
  test("all numeric → numeric", () => {
    expect(detectValueType([1, 2, "3", "4.5"])).toBe("numeric");
  });

  test("all MM:SS time strings → time", () => {
    expect(detectValueType(["5:45", "6:00", "5:30"])).toBe("time");
  });

  test("all HH:MM:SS time strings → time", () => {
    expect(detectValueType(["1:30:45", "3:42:15", "2:05:00"])).toBe("time");
  });

  test("mixed MM:SS and HH:MM:SS → time (both are HMS)", () => {
    expect(detectValueType(["5:45", "1:30:45", "6:00"])).toBe("time");
  });

  test("all ISO date strings → date", () => {
    expect(detectValueType(["2024-01-15", "2024-06-30", "2024-12-31"])).toBe("date");
  });

  test("mixed numeric and time → string (no single first-class type covers all)", () => {
    expect(detectValueType([5, "5:45", 6])).toBe("string");
  });

  test("anything-else strings → string", () => {
    expect(detectValueType(["Tools", "Techniques"])).toBe("string");
  });

  test("empty input → string (no axis context to commit to)", () => {
    expect(detectValueType([])).toBe("string");
  });

  test("null/undefined values are skipped during detection", () => {
    expect(detectValueType([null, undefined, "5:45", "6:00"])).toBe("time");
  });

  // Regression: when the user clicks Bases' "+ New" button, the freshly-
  // created entry has no frontmatter and entry.getValue(prop) returns a
  // NullValue WRAPPER — an object, not primitive null. Its toString() is
  // "" which detectValueType reads as a regular string. If callers don't
  // pre-filter empty wrappers via isValueEmpty, a single empty entry can
  // demote a numeric axis to "string", which cascades through
  // resolveBounds → auto-bounding → asymmetric pxPerX/pxPerY → squarePlot
  // can no longer produce circular rings.
  //
  // The fix lives in the CALLER (matrix-view.ts buildDataset filters via
  // isValueEmpty before pushing to the rawX/rawY arrays). This test pins
  // down the failure mode so the contract is clear: empty wrappers must
  // be filtered upstream.
  test("regression: an unfiltered NullValue-like wrapper poisons numeric detection", () => {
    const nullValueWrapper = { isTruthy: () => false, toString: () => "" };
    // Without filtering, the empty-string toString() makes detection
    // fall back to "string" — even though every real value is numeric.
    expect(detectValueType([1, 2, 3, nullValueWrapper])).toBe("string");
    // With the wrapper removed (as buildDataset now does via isValueEmpty),
    // the remaining values detect cleanly.
    expect(detectValueType([1, 2, 3])).toBe("numeric");
  });

  // Property captures the buildDataset CONTRACT: when callers filter empties
  // via isValueEmpty before handing the array to detectValueType, the inferred
  // type matches what the non-empty values alone would produce. Any drift
  // would indicate either (a) isValueEmpty missed a Bases sentinel shape, or
  // (b) detectValueType treats an "empty-but-non-null" value as a real one.
  // Either failure mode is the exact regression that broke + New.
  test("property: isValueEmpty + detectValueType compose without type drift", () =>
    hegel.test((tc) => {
      // Real values, drawn from one canonical-type pool so the expected
      // detection is well-defined. Pick the pool first, generate values.
      const pool = tc.draw(gs.sampledFrom(["numeric", "time", "date"] as const));
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 6 }));
      const reals: unknown[] = [];
      for (let i = 0; i < n; i++) {
        if (pool === "numeric") {
          reals.push(tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 })));
        } else if (pool === "time") {
          const mm = tc.draw(gs.integers({ minValue: 0, maxValue: 99 }));
          const ss = tc.draw(gs.integers({ minValue: 0, maxValue: 59 }));
          reals.push(`${mm}:${String(ss).padStart(2, "0")}`);
        } else {
          const y = tc.draw(gs.integers({ minValue: 2000, maxValue: 2050 }));
          const m = String(tc.draw(gs.integers({ minValue: 1, maxValue: 12 }))).padStart(2, "0");
          const d = String(tc.draw(gs.integers({ minValue: 1, maxValue: 28 }))).padStart(2, "0");
          reals.push(`${y}-${m}-${d}`);
        }
      }
      // Empty markers — every shape Bases or YAML can hand us for a missing
      // field. The NullValue-like wrapper is the one that bit + New.
      const emptyKinds = [
        () => null,
        () => undefined,
        () => "",
        () => ({ isTruthy: () => false, toString: () => "" }),
        () => ({ isTruthy: () => false, toString: () => "", constructor: { name: "NullValue" } }),
      ];
      const m = tc.draw(gs.integers({ minValue: 0, maxValue: 5 }));
      const empties: unknown[] = [];
      for (let i = 0; i < m; i++) {
        const make = tc.draw(gs.sampledFrom(emptyKinds));
        empties.push(make());
      }
      const mixed = [...reals, ...empties];
      const filtered = mixed.filter((v) => !isValueEmpty(v));
      const expected = detectValueType(reals);
      const actual = detectValueType(filtered);
      if (expected !== actual) {
        throw new Error(`type drift after filtering ${m} empties: expected ${expected}, got ${actual} (pool=${pool})`);
      }
    }));
});

describe("parseValue — numeric", () => {
  test("numbers and numeric strings pass through", () => {
    expect(parseValue(31.7, "numeric")).toBe(31.7);
    expect(parseValue("31.7", "numeric")).toBe(31.7);
    expect(parseValue("0", "numeric")).toBe(0);
  });

  test("non-numeric strings return null", () => {
    expect(parseValue("5:45", "numeric")).toBeNull();
    expect(parseValue("Tools", "numeric")).toBeNull();
  });

  test("null/undefined return null", () => {
    expect(parseValue(null, "numeric")).toBeNull();
    expect(parseValue(undefined, "numeric")).toBeNull();
  });
});

describe("parseValue — time (canonical: seconds)", () => {
  test("MM:SS parses as minutes*60 + seconds", () => {
    expect(parseValue("5:45", "time")).toBe(5 * 60 + 45);
    expect(parseValue("0:30", "time")).toBe(30);
    expect(parseValue("31:42", "time")).toBe(31 * 60 + 42);
  });

  test("HH:MM:SS parses as hours*3600 + minutes*60 + seconds", () => {
    expect(parseValue("1:30:45", "time")).toBe(3600 + 30 * 60 + 45);
    expect(parseValue("3:42:15", "time")).toBe(3 * 3600 + 42 * 60 + 15);
  });

  test("M:SS with single-digit minutes is accepted", () => {
    expect(parseValue("5:30", "time")).toBe(330);
    expect(parseValue("0:05", "time")).toBe(5);
  });

  test("rejects seconds ≥ 60 (malformed)", () => {
    expect(parseValue("5:60", "time")).toBeNull();
    expect(parseValue("5:99", "time")).toBeNull();
  });

  test("rejects minutes ≥ 60 in HH:MM:SS (malformed; would be ambiguous)", () => {
    expect(parseValue("1:60:00", "time")).toBeNull();
  });

  test("rejects negatives", () => {
    expect(parseValue("-5:45", "time")).toBeNull();
  });

  test("rejects non-time strings", () => {
    expect(parseValue("hello", "time")).toBeNull();
    expect(parseValue("5", "time")).toBeNull();   // bare number, not time
    expect(parseValue("5:", "time")).toBeNull();  // incomplete
    expect(parseValue(":45", "time")).toBeNull();
    expect(parseValue("5:45:", "time")).toBeNull();
  });
});

describe("parseValue — date", () => {
  test("ISO date string parses to a timestamp", () => {
    const ts = parseValue("2024-06-15", "date");
    expect(ts).toBeTypeOf("number");
    expect(ts).toBeGreaterThan(0);
  });

  test("earlier date < later date", () => {
    const a = parseValue("2024-01-01", "date") as number;
    const b = parseValue("2024-12-31", "date") as number;
    expect(a).toBeLessThan(b);
  });

  test("non-ISO date strings return null", () => {
    expect(parseValue("yesterday", "date")).toBeNull();
    expect(parseValue("5:45", "date")).toBeNull();
  });
});

describe("formatValue — numeric round-trip", () => {
  test("integer formats as integer", () => {
    expect(formatValue(5, "numeric")).toBe("5");
  });

  test("floats keep their precision (to 2 places typically)", () => {
    expect(formatValue(5.5, "numeric")).toMatch(/^5\.5/);
  });
});

describe("formatValue — time round-trip", () => {
  test("345 seconds → '5:45'", () => {
    expect(formatValue(345, "time")).toBe("5:45");
  });

  test("60 seconds → '1:00' (always two-digit seconds)", () => {
    expect(formatValue(60, "time")).toBe("1:00");
  });

  test("5 seconds → '0:05'", () => {
    expect(formatValue(5, "time")).toBe("0:05");
  });

  test("3600+ seconds formats with hours: 13335 → '3:42:15'", () => {
    expect(formatValue(13335, "time")).toBe("3:42:15");
  });

  test("3600 exactly → '1:00:00'", () => {
    expect(formatValue(3600, "time")).toBe("1:00:00");
  });

  test("rounds to nearest second (for gradient interpolation outputs)", () => {
    expect(formatValue(345.4, "time")).toBe("5:45");
    expect(formatValue(345.6, "time")).toBe("5:46");
  });

  test("property: parse(format(s)) === s for any non-negative whole-second input", () =>
    hegel.test((tc) => {
      const s = tc.draw(gs.integers({ minValue: 0, maxValue: 359999 })); // up to 99:59:59
      const formatted = formatValue(s, "time");
      const reparsed = parseValue(formatted, "time");
      if (reparsed !== s) {
        throw new Error(`round-trip failed: ${s} → "${formatted}" → ${reparsed}`);
      }
    }));
});

describe("formatValue — date round-trip", () => {
  test("timestamp formats as ISO YYYY-MM-DD", () => {
    const ts = parseValue("2024-06-15", "date") as number;
    expect(formatValue(ts, "date")).toBe("2024-06-15");
  });

  test("property: parse(format(t)) === t for date timestamps", () =>
    hegel.test((tc) => {
      // Pick a date in a reasonable range
      const year = tc.draw(gs.integers({ minValue: 2000, maxValue: 2050 }));
      const month = tc.draw(gs.integers({ minValue: 1, maxValue: 12 }));
      const day = tc.draw(gs.integers({ minValue: 1, maxValue: 28 })); // safe for any month
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const ts = parseValue(iso, "date") as number;
      const reformatted = formatValue(ts, "date");
      if (reformatted !== iso) {
        throw new Error(`round-trip failed: "${iso}" → ${ts} → "${reformatted}"`);
      }
    }));
});

describe("Bases-style wrapper objects (toString-coercion path)", () => {
  // Bases hands the plugin wrapped value objects (TextValue, DateValue,
  // etc.) for most frontmatter values. Their typeof is "object" but their
  // String() coercion gives the underlying display string. The detectors
  // and parsers must accept them — otherwise every wrapped value reads as
  // "string" type, every detection misses, and points silently drop.

  const wrap = (s: string) => ({ toString: () => s });

  test("detectValueType: wrapped time strings detect as time", () => {
    expect(detectValueType([wrap("5:45"), wrap("6:00"), wrap("5:30")])).toBe("time");
  });

  test("detectValueType: wrapped ISO dates detect as date", () => {
    expect(detectValueType([wrap("2024-01-15"), wrap("2024-12-31")])).toBe("date");
  });

  test("detectValueType: wrapped numeric strings detect as numeric", () => {
    expect(detectValueType([wrap("31.7"), wrap("28.5"), wrap("30")])).toBe("numeric");
  });

  test("parseValue: wrapped time parses correctly", () => {
    expect(parseValue(wrap("5:45"), "time")).toBe(345);
  });

  test("parseValue: wrapped date parses correctly", () => {
    expect(parseValue(wrap("2024-06-15"), "date")).toBe(Date.parse("2024-06-15"));
  });

  test("parseValue: wrapped numeric parses correctly", () => {
    expect(parseValue(wrap("31.7"), "numeric")).toBe(31.7);
  });

  test("JS Date instance detects + parses as date (YAML auto-unboxing path)", () => {
    // YAML 1.1 parses unquoted `2025-06-15` as a Date object. Both paths
    // (typeof object via Date instance, and our generic wrapper) must
    // produce the timestamp.
    const d = new Date("2025-06-15");
    expect(detectValueType([d])).toBe("date");
    expect(parseValue(d, "date")).toBe(d.getTime());
  });
});

describe("cross-type integration", () => {
  test("auto-pipeline: detect → parse → format on time data", () => {
    const raw = ["5:45", "6:00", "5:30"];
    const type = detectValueType(raw);
    expect(type).toBe("time");
    const parsed = raw.map((s) => parseValue(s, type));
    expect(parsed).toEqual([345, 360, 330]);
    const reformatted = parsed.map((n) => (n === null ? null : formatValue(n, type)));
    expect(reformatted).toEqual(raw);
  });

  test("auto-pipeline: detect → parse → format on numeric data preserves identity", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: -1000, maxValue: 1000 }));
      const type: ValueType = "numeric";
      const parsed = parseValue(n, type);
      if (parsed !== n) throw new Error(`numeric parse changed value: ${n} → ${parsed}`);
    }));
});
