/**
 * Tests for the geometry helpers — pure math/numeric utilities used across
 * the plugin. Written TDD-style: each section's test goes RED first, then
 * minimal implementation in src/geometry.ts makes it green.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  clusterLabelOffsetBase,
  clusterMarkRadius,
  effectiveBaseRadius,
  effectiveLabelMaxLength,
  ellipsePath,
  findSnapTarget,
  ringLabelOffsetY,
  ringRadii,
  roundForRange,
  spiderRadiusForCluster,
  touchDragFingerOffset,
} from "../geometry";

describe("roundForRange", () => {
  test("range 10 → 1 decimal", () => {
    expect(roundForRange(7.3456, 10)).toBe(7.3);
  });

  test("range 100 → 0 decimals", () => {
    expect(roundForRange(7.34, 100)).toBe(7);
  });

  test("range 1 → 2 decimals", () => {
    expect(roundForRange(0.567, 1)).toBeCloseTo(0.57, 5);
  });

  test("range 0 / non-finite → pass through unchanged", () => {
    expect(roundForRange(7.34, 0)).toBe(7.34);
    expect(roundForRange(7.34, -1)).toBe(7.34);
    expect(roundForRange(7.34, Infinity)).toBe(7.34);
    expect(roundForRange(7.34, NaN)).toBe(7.34);
  });

  test("integer value already at correct precision is unchanged", () => {
    expect(roundForRange(8, 10)).toBe(8);
  });

  // PBT: roundForRange is idempotent — once rounded, rounding again at the
  // same range is a no-op. Catches off-by-one precision bugs in the math.
  test("property: round(round(x, r), r) === round(x, r)", () =>
    hegel.test((tc) => {
      const x = tc.draw(gs.floats({ minValue: -1e6, maxValue: 1e6 }));
      const r = tc.draw(gs.floats({ minValue: 0.001, maxValue: 1e6 }));
      const once = roundForRange(x, r);
      const twice = roundForRange(once, r);
      if (once !== twice) {
        throw new Error(`roundForRange not idempotent: x=${x}, r=${r}, once=${once}, twice=${twice}`);
      }
    }));
});

describe("effectiveBaseRadius", () => {
  test("desktop (fine pointer) returns config radius unchanged", () => {
    expect(effectiveBaseRadius(8, false)).toBe(8);
    expect(effectiveBaseRadius(12, false)).toBe(12);
    expect(effectiveBaseRadius(20, false)).toBe(20);
  });

  test("coarse pointer bumps below-floor radii up to the floor", () => {
    expect(effectiveBaseRadius(8, true)).toBe(10);  // default 8 → 10
    expect(effectiveBaseRadius(3, true)).toBe(10);  // very small → 10
  });

  test("coarse pointer leaves already-tap-friendly radii unchanged", () => {
    expect(effectiveBaseRadius(10, true)).toBe(10);
    expect(effectiveBaseRadius(12, true)).toBe(12);
    expect(effectiveBaseRadius(20, true)).toBe(20);
  });
});

describe("effectiveLabelMaxLength", () => {
  test("wide viewport returns config max unchanged", () => {
    expect(effectiveLabelMaxLength(800, 32)).toBe(32);
    expect(effectiveLabelMaxLength(500, 32)).toBe(32);
    expect(effectiveLabelMaxLength(400, 32)).toBe(32); // not below 400
  });

  test("narrow viewport (< 400px) scales label max to 70%", () => {
    expect(effectiveLabelMaxLength(399, 32)).toBe(22); // floor(32 * 0.7) = 22
    expect(effectiveLabelMaxLength(300, 40)).toBe(28); // floor(40 * 0.7) = 28
  });

  test("narrow viewport doesn't go below the absolute floor of 8 chars", () => {
    expect(effectiveLabelMaxLength(300, 8)).toBe(8);
    expect(effectiveLabelMaxLength(300, 10)).toBe(8); // 10 * 0.7 = 7 → floored to 8
  });
});

describe("spiderRadiusForCluster", () => {
  test("desktop scales 11px per member, floored at 70px", () => {
    expect(spiderRadiusForCluster(5, false)).toBe(70);  // 55 → floor 70
    expect(spiderRadiusForCluster(6, false)).toBe(70);  // 66 → floor 70
    expect(spiderRadiusForCluster(7, false)).toBe(77);
    expect(spiderRadiusForCluster(10, false)).toBe(110);
    expect(spiderRadiusForCluster(15, false)).toBe(165);
  });

  test("coarse pointer (phone) scales 6px per member, floored at 40px", () => {
    expect(spiderRadiusForCluster(5, true)).toBe(40);  // 30 → floor 40
    expect(spiderRadiusForCluster(7, true)).toBe(42);
    expect(spiderRadiusForCluster(10, true)).toBe(60);
    expect(spiderRadiusForCluster(15, true)).toBe(90);
  });

  test("property: monotonic non-decreasing in member count", () =>
    hegel.test((tc) => {
      const isCoarse = tc.draw(gs.booleans());
      const a = tc.draw(gs.integers({ minValue: 5, maxValue: 30 }));
      const b = tc.draw(gs.integers({ minValue: 5, maxValue: 30 }));
      const [smaller, larger] = a < b ? [a, b] : [b, a];
      if (spiderRadiusForCluster(larger, isCoarse) < spiderRadiusForCluster(smaller, isCoarse)) {
        throw new Error(`radius decreased: N=${smaller}→${spiderRadiusForCluster(smaller, isCoarse)}, N=${larger}→${spiderRadiusForCluster(larger, isCoarse)}`);
      }
    }));

  test("property: coarse-pointer (mobile) spider is strictly tighter than desktop at every N", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 5, maxValue: 30 }));
      const desktop = spiderRadiusForCluster(n, false);
      const mobile = spiderRadiusForCluster(n, true);
      if (mobile >= desktop) {
        throw new Error(`mobile radius (${mobile}) not less than desktop (${desktop}) at N=${n}`);
      }
    }));
});

describe("clusterLabelOffsetBase", () => {
  test("desktop uses wider outward offset", () => {
    expect(clusterLabelOffsetBase(false)).toBe(24);
  });

  test("coarse pointer uses tighter offset to fit narrow viewports", () => {
    expect(clusterLabelOffsetBase(true)).toBe(15);
  });
});

describe("touchDragFingerOffset", () => {
  // Lift = 40% of plot height capped at 50px. Default to the full lift on
  // any plot ≥125px tall (covers normal landscape mobile at ~190px). Scale
  // down only for extreme cases (split-pane mobile + keyboard up).
  test("normal plot gets the full 50px lift", () => {
    expect(touchDragFingerOffset(400)).toBe(50); // 0.4 * 400 = 160 → cap at 50
    expect(touchDragFingerOffset(200)).toBe(50); // 0.4 * 200 = 80 → cap at 50
    expect(touchDragFingerOffset(125)).toBe(50); // 0.4 * 125 = 50 → at cap
  });

  test("extremely short plot scales offset down", () => {
    expect(touchDragFingerOffset(100)).toBe(40); // 0.4 * 100 = 40
    expect(touchDragFingerOffset(50)).toBe(20); // 0.4 * 50 = 20
  });

  test("zero/negative plot height returns 0", () => {
    expect(touchDragFingerOffset(0)).toBe(0);
    expect(touchDragFingerOffset(-50)).toBe(0);
  });
});

describe("findSnapTarget", () => {
  // Standard params: pixelsPerX/Y scale data units to pixels; threshold is
  // CLUSTER_PROXIMITY_FACTOR × baseRadius (3 × 8 = 24px on a default plot).
  const PIXELS_PER_X = 70;  // ~plot width / 10 data units
  const PIXELS_PER_Y = 35;
  const THRESHOLD = 24;

  test("returns null when no candidate is in range", () => {
    const result = findSnapTarget({
      x: 5, y: 5,
      candidates: [
        { filePath: "A", x: 0, y: 0 },
        { filePath: "B", x: 9, y: 9 },
      ],
      excludePaths: new Set(["dragged"]),
      pixelsPerX: PIXELS_PER_X, pixelsPerY: PIXELS_PER_Y,
      pixelThreshold: THRESHOLD,
    });
    expect(result).toBeNull();
  });

  test("returns the candidate when one is in range", () => {
    const result = findSnapTarget({
      x: 5, y: 5,
      candidates: [
        { filePath: "A", x: 5.1, y: 5.1 }, // very close
      ],
      excludePaths: new Set(["dragged"]),
      pixelsPerX: PIXELS_PER_X, pixelsPerY: PIXELS_PER_Y,
      pixelThreshold: THRESHOLD,
    });
    expect(result).toEqual({ x: 5.1, y: 5.1 });
  });

  test("returns the CLOSEST candidate when multiple are in range", () => {
    const result = findSnapTarget({
      x: 5, y: 5,
      candidates: [
        { filePath: "A", x: 5.2, y: 5 },  // 14px away
        { filePath: "B", x: 5.1, y: 5 },  // 7px away — closest
        { filePath: "C", x: 5.3, y: 5 },  // 21px away
      ],
      excludePaths: new Set(["dragged"]),
      pixelsPerX: PIXELS_PER_X, pixelsPerY: PIXELS_PER_Y,
      pixelThreshold: THRESHOLD,
    });
    expect(result).toEqual({ x: 5.1, y: 5 });
  });

  test("excludes paths in excludePaths even if close", () => {
    const result = findSnapTarget({
      x: 5, y: 5,
      candidates: [
        { filePath: "self", x: 5, y: 5 },     // identical position but excluded
        { filePath: "B", x: 5.2, y: 5 },
      ],
      excludePaths: new Set(["self"]),
      pixelsPerX: PIXELS_PER_X, pixelsPerY: PIXELS_PER_Y,
      pixelThreshold: THRESHOLD,
    });
    expect(result).toEqual({ x: 5.2, y: 5 });
  });

  test("threshold respected in pixel space (not data space)", () => {
    // Point at data (5, 5), candidate at (5.5, 5). Data delta x = 0.5,
    // pixel delta = 0.5 * 70 = 35px > threshold 24 → no snap.
    const result = findSnapTarget({
      x: 5, y: 5,
      candidates: [{ filePath: "A", x: 5.5, y: 5 }],
      excludePaths: new Set(),
      pixelsPerX: PIXELS_PER_X, pixelsPerY: PIXELS_PER_Y,
      pixelThreshold: THRESHOLD,
    });
    expect(result).toBeNull();
  });

  // PBT: a result is returned iff some non-excluded candidate is within
  // pixelThreshold. And whichever IS returned is the closest such candidate.
  // Independent oracle implementation cross-checks the impl.
  test("property: result === null iff no candidate is in range (independent oracle)", () =>
    hegel.test((tc) => {
      const x = tc.draw(gs.floats({ minValue: 0, maxValue: 10 }));
      const y = tc.draw(gs.floats({ minValue: 0, maxValue: 10 }));
      const pixelsPerX = tc.draw(gs.floats({ minValue: 10, maxValue: 200 }));
      const pixelsPerY = tc.draw(gs.floats({ minValue: 10, maxValue: 200 }));
      const pixelThreshold = tc.draw(gs.floats({ minValue: 1, maxValue: 100 }));
      const candidateCount = tc.draw(gs.integers({ minValue: 0, maxValue: 12 }));
      const candidates = [];
      for (let i = 0; i < candidateCount; i++) {
        candidates.push({
          filePath: `c${i}`,
          x: tc.draw(gs.floats({ minValue: 0, maxValue: 10 })),
          y: tc.draw(gs.floats({ minValue: 0, maxValue: 10 })),
        });
      }
      const excludeCount = tc.draw(gs.integers({ minValue: 0, maxValue: candidateCount }));
      const excludePaths = new Set<string>();
      for (let i = 0; i < excludeCount; i++) excludePaths.add(`c${i}`);

      const result = findSnapTarget({
        x, y, candidates, excludePaths, pixelsPerX, pixelsPerY, pixelThreshold,
      });

      // Independent oracle: find the closest non-excluded candidate within threshold.
      let oracleBest: { x: number; y: number } | null = null;
      let oracleDist = Infinity;
      for (const c of candidates) {
        if (excludePaths.has(c.filePath)) continue;
        const d = Math.hypot((c.x - x) * pixelsPerX, (c.y - y) * pixelsPerY);
        if (d < pixelThreshold && d < oracleDist) {
          oracleBest = { x: c.x, y: c.y };
          oracleDist = d;
        }
      }
      // null iff oracle null
      if ((result === null) !== (oracleBest === null)) {
        throw new Error(`null mismatch: impl=${JSON.stringify(result)}, oracle=${JSON.stringify(oracleBest)}`);
      }
      // when both non-null, distance to result equals distance to oracle
      if (result !== null && oracleBest !== null) {
        const dResult = Math.hypot((result.x - x) * pixelsPerX, (result.y - y) * pixelsPerY);
        if (Math.abs(dResult - oracleDist) > 1e-9) {
          throw new Error(`distance mismatch: impl=${dResult}, oracle=${oracleDist}`);
        }
      }
    }));
});

describe("clusterMarkRadius", () => {
  // Pure formula extracted from cluster-renderer's renderCluster: the cluster
  // glyph grows slightly with member count so very large clusters read as
  // "more stuff here" without ballooning. Bounded above so the glyph never
  // dominates the chart at extreme N.
  test("small clusters (n ≤ 4) return baseRadius + 5", () => {
    expect(clusterMarkRadius(8, 2)).toBe(13);
    expect(clusterMarkRadius(8, 4)).toBe(13);
    expect(clusterMarkRadius(10, 1)).toBe(15);
  });

  test("clusters above 4 grow by 1 per member up to 6 extra", () => {
    expect(clusterMarkRadius(8, 5)).toBe(14);
    expect(clusterMarkRadius(8, 6)).toBe(15);
    expect(clusterMarkRadius(8, 10)).toBe(19); // capped: 8 + 5 + min(6, 6) = 19
  });

  test("growth caps at baseRadius + 11 (no unbounded growth)", () => {
    expect(clusterMarkRadius(8, 100)).toBe(19);
    expect(clusterMarkRadius(8, 1000)).toBe(19);
  });

  test("property: monotonic non-decreasing in member count", () =>
    hegel.test((tc) => {
      const baseR = tc.draw(gs.integers({ minValue: 3, maxValue: 30 }));
      const a = tc.draw(gs.integers({ minValue: 1, maxValue: 50 }));
      const b = tc.draw(gs.integers({ minValue: a, maxValue: 100 }));
      const ra = clusterMarkRadius(baseR, a);
      const rb = clusterMarkRadius(baseR, b);
      if (rb < ra) throw new Error(`radius shrank: n=${a}→${ra}, n=${b}→${rb}`);
    }));

  test("property: result bounded by [baseRadius + 5, baseRadius + 11]", () =>
    hegel.test((tc) => {
      const baseR = tc.draw(gs.integers({ minValue: 3, maxValue: 30 }));
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const r = clusterMarkRadius(baseR, n);
      if (r < baseR + 5) throw new Error(`under-floor: baseR=${baseR}, n=${n}, r=${r}`);
      if (r > baseR + 11) throw new Error(`over-ceiling: baseR=${baseR}, n=${n}, r=${r}`);
    }));
});

describe("ringRadii (data-space radii for concentric-ring overlay)", () => {
  test("4 rings → [1, 2, 3, 4] data units", () => {
    expect(ringRadii(4)).toEqual([1, 2, 3, 4]);
  });

  test("integer multiples — aligns with integer tick marks", () => {
    // The reason these are integers: a chart with -5..+5 axes has ticks at
    // 1, 2, 3, 4, 5. Rings at radii 1..4 visually align with those ticks,
    // so the user sees ring boundaries land exactly on the data grid.
    expect(ringRadii(3)).toEqual([1, 2, 3]);
    expect(ringRadii(1)).toEqual([1]);
  });

  test("count of 0 or negative returns []", () => {
    expect(ringRadii(0)).toEqual([]);
    expect(ringRadii(-1)).toEqual([]);
  });

  test("property: strictly increasing from inner to outer", () =>
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 1, maxValue: 20 }));
      const r = ringRadii(count);
      if (r.length !== count) throw new Error(`length mismatch: ${r.length} vs ${count}`);
      for (let i = 1; i < r.length; i++) {
        if (r[i] <= r[i - 1]) {
          throw new Error(`not strictly increasing at ${i}: ${r[i - 1]} → ${r[i]}`);
        }
      }
    }));

  test("property: outermost radius equals the ring count (rings 1..N convention)", () =>
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 1, maxValue: 20 }));
      const r = ringRadii(count);
      if (r[r.length - 1] !== count) {
        throw new Error(`outer ring is ${r[r.length - 1]}, expected ${count}`);
      }
    }));
});

describe("ringLabelOffsetY (data-space Y offset for ring labels)", () => {
  test("label sits at the midpoint of its annular band (data units, up=positive)", () => {
    const radii = [1, 2, 3, 4];
    // Ring 0 (innermost): between center (0) and r=1 → midpoint at +0.5
    expect(ringLabelOffsetY(0, radii)).toBe(0.5);
    // Ring 1: between r=1 and r=2 → midpoint at +1.5
    expect(ringLabelOffsetY(1, radii)).toBe(1.5);
    expect(ringLabelOffsetY(2, radii)).toBe(2.5);
    expect(ringLabelOffsetY(3, radii)).toBe(3.5);
  });

  test("out-of-range index returns 0 (graceful degrade)", () => {
    expect(ringLabelOffsetY(-1, [1, 2])).toBe(0);
    expect(ringLabelOffsetY(2, [1, 2])).toBe(0);
  });

  test("property: label offset always positive, within outermost ring", () =>
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 2, maxValue: 10 }));
      const radii = ringRadii(count);
      for (let i = 0; i < count; i++) {
        const y = ringLabelOffsetY(i, radii);
        if (y <= 0) throw new Error(`label Y not positive for ring ${i}: ${y}`);
        if (y > radii[count - 1]) {
          throw new Error(`label Y ${y} exceeds outermost radius ${radii[count - 1]}`);
        }
      }
    }));
});

describe("ellipsePath (cubic-Bézier ellipse approximation)", () => {
  // Extract just the SVG command letters (M, C, Z, ...) from a path string,
  // ignoring numeric arguments. M(start), N×C(segments), Z(close).
  const commands = (d: string): string[] => Array.from(d.match(/[A-Z]/g) ?? []);
  // Number regex including scientific notation — segment endpoints at angles
  // near 2π evaluate to tiny floats like -2.45e-16 that the plain digit
  // pattern would truncate to -2.45.
  const NUM = "(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)";

  test("default emits 8 cubic segments with M start and Z close", () => {
    const cmds = commands(ellipsePath(0, 0, 100, 100));
    expect(cmds[0]).toBe("M");
    expect(cmds[cmds.length - 1]).toBe("Z");
    expect(cmds.filter((c) => c === "C")).toHaveLength(8);
  });

  test("custom segment count respected", () => {
    expect(commands(ellipsePath(0, 0, 50, 50, 4)).filter((c) => c === "C")).toHaveLength(4);
    expect(commands(ellipsePath(0, 0, 50, 50, 16)).filter((c) => c === "C")).toHaveLength(16);
  });

  test("M starts at the angle-0 anchor (cx + rx, cy)", () => {
    // angle 0: cos=1, sin=0 → (cx + rx·1, cy + ry·0)
    const d = ellipsePath(100, 200, 50, 30);
    const match = d.match(new RegExp(`^M${NUM}\\s+${NUM}`));
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeCloseTo(150, 6); // 100 + 50
    expect(Number(match![2])).toBeCloseTo(200, 6); // 200 + 0
  });

  test("path closes (last C endpoint coincides with M anchor — Z closes the loop)", () => {
    // For N segments around 2π, the final segment ends back at angle 2π = 0,
    // i.e., the same anchor M started at. Z then re-asserts the close.
    const d = ellipsePath(0, 0, 100, 100, 8);
    const m = d.match(new RegExp(`^M${NUM}\\s+${NUM}`))!;
    const mx = Number(m[1]), my = Number(m[2]);
    const cRe = new RegExp(`C\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}`, "g");
    const matches = [...d.matchAll(cRe)];
    const last = matches[matches.length - 1];
    expect(Number(last[5])).toBeCloseTo(mx, 6);
    expect(Number(last[6])).toBeCloseTo(my, 6);
  });

  test("rx !== ry produces an ellipse (M anchor reflects rx, not ry)", () => {
    const d = ellipsePath(0, 0, 100, 30);
    const m = d.match(new RegExp(`^M${NUM}\\s+${NUM}`))!;
    expect(Number(m[1])).toBeCloseTo(100, 6);
    expect(Number(m[2])).toBeCloseTo(0, 6);
  });

  test("property: every C segment endpoint lies on the parametric ellipse to FP precision", () =>
    // For N segments spanning 2π, the i-th C's endpoint (the 3rd control
    // point) is the anchor at angle (i+1)·(2π/N). Verifies our control-point
    // math matches the standard parametrization — if anchors drift, the
    // visible rings would start mis-meeting at segment joins.
    hegel.test((tc) => {
      const rx = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const ry = tc.draw(gs.integers({ minValue: 1, maxValue: 1000 }));
      const segments = tc.draw(gs.integers({ minValue: 3, maxValue: 32 }));
      const cx = 0, cy = 0;
      const d = ellipsePath(cx, cy, rx, ry, segments);
      const cRe = new RegExp(`C\\s*${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}\\s+${NUM}`, "g");
      const cMatches = [...d.matchAll(cRe)];
      if (cMatches.length !== segments) {
        throw new Error(`expected ${segments} segments, got ${cMatches.length}`);
      }
      const alpha = (2 * Math.PI) / segments;
      for (let i = 0; i < segments; i++) {
        const endX = Number(cMatches[i][5]);
        const endY = Number(cMatches[i][6]);
        const t = (i + 1) * alpha;
        const expectedX = cx + rx * Math.cos(t);
        const expectedY = cy + ry * Math.sin(t);
        if (Math.abs(endX - expectedX) > 1e-6 || Math.abs(endY - expectedY) > 1e-6) {
          throw new Error(`segment ${i} endpoint off: got (${endX}, ${endY}), expected (${expectedX}, ${expectedY})`);
        }
      }
    }));
});
