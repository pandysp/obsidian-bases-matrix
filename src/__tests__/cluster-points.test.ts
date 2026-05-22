/**
 * Tests for cluster-renderer's pure union-find grouping and the spider
 * geometry that lays out members of a large cluster. Mocks the
 * ClusterCandidate shape to avoid pulling in PointDatum's full surface.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { clusterPoints, type ClusterCandidate } from "../cluster-renderer";
import { spiderRadiusForCluster } from "../geometry";

/** Synthesize a candidate at (cx, cy) with a given filePath. */
function pt(filePath: string, cx: number, cy: number, r = 8, color = "blue"): ClusterCandidate {
  return {
    datum: { filePath, label: filePath, x: cx, y: cy, entry: {} } as ClusterCandidate["datum"],
    cx, cy, r, color,
  };
}

const BASE_RADIUS = 8;
// Clustering threshold is CLUSTER_DATA_PROXIMITY = 0.06 in normalized
// data space. With xRange = yRange = 100 (the convention these tests use),
// 0.06 × 100 = 6 data units. Points within 6 units in data space cluster.
const RANGE = 100;

describe("clusterPoints", () => {
  test("empty input → empty output", () => {
    expect(clusterPoints([], RANGE, RANGE)).toEqual([]);
  });

  test("single point → one singleton cluster", () => {
    const result = clusterPoints([pt("A", 100, 100)], RANGE, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(1);
    expect(result[0].cx).toBe(100);
    expect(result[0].cy).toBe(100);
  });

  test("two coincident points cluster into one group of 2", () => {
    const result = clusterPoints([
      pt("A", 100, 100),
      pt("B", 100, 100),
    ], RANGE, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(2);
  });

  test("two points far apart in data space do NOT cluster", () => {
    const result = clusterPoints([
      pt("A", 0, 0),
      pt("B", 100, 0),  // 100 / 100 = 1.0 in normalized — far above 0.06
    ], RANGE, RANGE);
    expect(result).toHaveLength(2);
  });

  test("two points within data-proximity cluster together", () => {
    const result = clusterPoints([
      pt("A", 0, 0),
      pt("B", 5, 0),  // 5/100 = 0.05 normalized < 0.06
    ], RANGE, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(2);
  });

  test("transitive clustering: A near B, B near C, but A far from C — still one cluster", () => {
    // A at x=0, B at x=5, C at x=10. A-B and B-C are 0.05 normalized; A-C
    // is 0.10 (> 0.06), but union-find merges them all because A and B share
    // a root and B and C share a root.
    const result = clusterPoints([
      pt("A", 0, 0),
      pt("B", 5, 0),
      pt("C", 10, 0),
    ], RANGE, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(3);
  });

  test("centroid is the mean of member PIXEL positions (not data)", () => {
    // Pixel positions cx/cy and data positions datum.x/datum.y are identical
    // in the test fixture, but the centroid is defined in pixel space.
    const result = clusterPoints([
      pt("A", 0, 0),
      pt("B", 4, 4),  // 0.04 normalized < 0.06
    ], RANGE, RANGE);
    expect(result).toHaveLength(1);
    expect(result[0].cx).toBeCloseTo(2, 5);
    expect(result[0].cy).toBeCloseTo(2, 5);
  });

  test("anisotropic axis ranges → clustering uses per-axis normalization", () => {
    // xRange = 10, yRange = 1000. Two points 5 apart in X (50% of xRange)
    // are far in X-normalized terms. Two points 5 apart in Y (0.5% of
    // yRange) are close. So the Y-only pair clusters; the X-only pair
    // doesn't.
    const xOnlyResult = clusterPoints([
      pt("A", 0, 0),
      pt("B", 5, 0),
    ], 10, 1000);
    expect(xOnlyResult).toHaveLength(2); // 5/10 = 0.5 ≫ 0.06

    const yOnlyResult = clusterPoints([
      pt("A", 0, 0),
      pt("B", 0, 5),
    ], 10, 1000);
    expect(yOnlyResult).toHaveLength(1); // 5/1000 = 0.005 < 0.06
  });

  test("epsilon parameter overrides the default", () => {
    // With epsilon=0.5, two points 5 units apart in 100-range are well
    // within range (5/100 = 0.05 < 0.5).
    const loose = clusterPoints([
      pt("A", 0, 0),
      pt("B", 5, 0),
    ], RANGE, RANGE, 0, 0.5);
    expect(loose).toHaveLength(1);

    // With epsilon=0.01, the same points are too far (0.05 > 0.01).
    const tight = clusterPoints([
      pt("A", 0, 0),
      pt("B", 5, 0),
    ], RANGE, RANGE, 0, 0.01);
    expect(tight).toHaveLength(2);
  });

  test("pixel threshold catches visual overlap when data-space alone wouldn't", () => {
    // Data delta = 50 / 100 range = 0.5 normalized — well above 0.06 data
    // epsilon, so data-space alone wouldn't cluster. But pixel delta of
    // 10px < pixel threshold 30 → cluster via the visual-overlap test.
    // This is the landscape-mobile case where a squeezed axis maps
    // data-far points to visually overlapping pixels.
    const result = clusterPoints([
      { datum: { x: 0, y: 0, filePath: "A", label: "A", entry: {} } as ClusterCandidate["datum"],
        cx: 0, cy: 0, r: 8, color: "blue" },
      { datum: { x: 50, y: 0, filePath: "B", label: "B", entry: {} } as ClusterCandidate["datum"],
        cx: 10, cy: 0, r: 8, color: "blue" },
    ], RANGE, RANGE, 30);
    expect(result).toHaveLength(1);
    expect(result[0].members).toHaveLength(2);
  });

  test("pixel threshold of 0 disables visual-overlap clustering", () => {
    // Same as above but pixelThreshold=0 → only data-space test fires →
    // dxData = 0.5 > 0.06 → no clustering.
    const result = clusterPoints([
      { datum: { x: 0, y: 0, filePath: "A", label: "A", entry: {} } as ClusterCandidate["datum"],
        cx: 0, cy: 0, r: 8, color: "blue" },
      { datum: { x: 50, y: 0, filePath: "B", label: "B", entry: {} } as ClusterCandidate["datum"],
        cx: 10, cy: 0, r: 8, color: "blue" },
    ], RANGE, RANGE, 0);
    expect(result).toHaveLength(2);
  });
});

describe("cluster centroid invariants", () => {
  test("centroid lies inside the bounding box of member positions", () => {
    // 0..20 data points with RANGE=100: deltas of 10–20 (10–20% normalized)
    // exceed 0.06 → these points DON'T cluster. Use a tight grouping in
    // small data range so they cluster into one and centroid invariants apply.
    const result = clusterPoints([
      pt("A", 0, 0), pt("B", 2, 0), pt("C", 1, 2),
    ], RANGE, RANGE);
    expect(result).toHaveLength(1);
    const c = result[0];
    expect(c.cx).toBeGreaterThanOrEqual(0);
    expect(c.cx).toBeLessThanOrEqual(2);
    expect(c.cy).toBeGreaterThanOrEqual(0);
    expect(c.cy).toBeLessThanOrEqual(2);
  });

  test("property: every cluster centroid is bounded by member coordinate ranges", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 1, maxValue: 8 }));
      const candidates: ClusterCandidate[] = [];
      const baseX = tc.draw(gs.integers({ minValue: 100, maxValue: 700 }));
      const baseY = tc.draw(gs.integers({ minValue: 100, maxValue: 400 }));
      for (let i = 0; i < n; i++) {
        const dx = tc.draw(gs.integers({ minValue: -10, maxValue: 10 }));
        const dy = tc.draw(gs.integers({ minValue: -10, maxValue: 10 }));
        candidates.push(pt(`P${i}`, baseX + dx, baseY + dy));
      }
      const clusters = clusterPoints(candidates, RANGE, RANGE);
      for (const c of clusters) {
        const xs = c.members.map((m) => m.cx);
        const ys = c.members.map((m) => m.cy);
        if (c.cx < Math.min(...xs) || c.cx > Math.max(...xs)) {
          throw new Error(`centroid cx=${c.cx} outside member x-range [${Math.min(...xs)}, ${Math.max(...xs)}]`);
        }
        if (c.cy < Math.min(...ys) || c.cy > Math.max(...ys)) {
          throw new Error(`centroid cy=${c.cy} outside member y-range [${Math.min(...ys)}, ${Math.max(...ys)}]`);
        }
      }
    }));

  test("property: every input candidate ends up in exactly one cluster (no loss, no dup)", { timeout: 30_000 }, () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 0, maxValue: 30 }));
      const candidates: ClusterCandidate[] = [];
      for (let i = 0; i < n; i++) {
        candidates.push(pt(`P${i}`,
          tc.draw(gs.integers({ minValue: 0, maxValue: 800 })),
          tc.draw(gs.integers({ minValue: 0, maxValue: 400 }))));
      }
      const clusters = clusterPoints(candidates, 1000, 1000);
      const seen = new Set<string>();
      let memberSum = 0;
      for (const c of clusters) {
        memberSum += c.members.length;
        for (const m of c.members) {
          if (seen.has(m.datum.filePath)) {
            throw new Error(`duplicate member: ${m.datum.filePath}`);
          }
          seen.add(m.datum.filePath);
        }
      }
      if (memberSum !== n) throw new Error(`expected ${n} members, got ${memberSum}`);
      if (seen.size !== n) throw new Error(`expected ${n} unique paths, got ${seen.size}`);
    }));
});

describe("cluster dissolution", () => {
  // When a label is moved out of a cluster, the cluster dot must remain visible
  // (don't drop the orphan dot). When a 2-element cluster has one member moved
  // out, it must dissolve into two singleton dots, not stay as a 1-member
  // "cluster". clusterPoints models the state — once a member's pixel position
  // moves far away, the next call gets the new positions and produces the right
  // shape.

  test("removing one member from a 2-cluster leaves two singletons (no orphan cluster)", () => {
    const before = clusterPoints([pt("A", 100, 100), pt("B", 102, 100)], RANGE, RANGE);
    expect(before).toHaveLength(1);
    expect(before[0].members).toHaveLength(2);

    const after = clusterPoints([pt("A", 100, 100), pt("B", 800, 100)], RANGE, RANGE);
    expect(after).toHaveLength(2);
    for (const c of after) {
      expect(c.members).toHaveLength(1);
    }
  });

  test("removing one member from a 3-cluster leaves a 2-member cluster + a singleton", () => {
    const before = clusterPoints([
      pt("A", 100, 100), pt("B", 102, 100), pt("C", 104, 100),
    ], RANGE, RANGE);
    expect(before).toHaveLength(1);
    expect(before[0].members).toHaveLength(3);

    const after = clusterPoints([
      pt("A", 100, 100), pt("B", 102, 100), pt("C", 800, 100),
    ], RANGE, RANGE);
    expect(after).toHaveLength(2);
    const sizes = after.map((c) => c.members.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  test("property: a singleton survives clustering as a singleton", () =>
    hegel.test((tc) => {
      const lonely = pt("LONE",
        tc.draw(gs.integers({ minValue: 0, maxValue: 10 })),
        tc.draw(gs.integers({ minValue: 0, maxValue: 10 })));
      const others: ClusterCandidate[] = [];
      const otherCount = tc.draw(gs.integers({ minValue: 0, maxValue: 5 }));
      for (let i = 0; i < otherCount; i++) {
        // Place far from the lonely one (≥ 700 data units away).
        others.push(pt(`O${i}`, 700 + i * 50, 200));
      }
      const result = clusterPoints([lonely, ...others], RANGE, RANGE);
      const lonelyCluster = result.find((c) => c.members.some((m) => m.datum.filePath === "LONE"));
      if (!lonelyCluster) throw new Error("lonely point disappeared");
      if (lonelyCluster.members.length !== 1) {
        throw new Error(`lonely point absorbed into cluster of ${lonelyCluster.members.length}`);
      }
    }));
});

describe("spider angle geometry", () => {
  // The spider for a large cluster lays members out as a regular N-gon
  // starting at angle -π/2 (top). cluster-renderer keeps this geometry
  // inline rather than exposing a helper, so we re-derive the formulae here
  // as an executable spec.
  function spiderAngles(n: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push((i / n) * Math.PI * 2 - Math.PI / 2);
    return out;
  }

  test("first petal is exactly above the centroid (angle = -π/2)", () => {
    expect(spiderAngles(8)[0]).toBeCloseTo(-Math.PI / 2, 10);
  });

  test("property: petals are evenly distributed (constant angular delta)", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 5, maxValue: 16 })); // large-cluster range
      const angles = spiderAngles(n);
      const expectedDelta = (2 * Math.PI) / n;
      for (let i = 1; i < angles.length; i++) {
        const delta = angles[i] - angles[i - 1];
        if (Math.abs(delta - expectedDelta) > 1e-10) {
          throw new Error(`uneven spacing at index ${i}: ${delta} vs ${expectedDelta}`);
        }
      }
    }));

  test("property: every petal lies on the spider radius (within float epsilon)", () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 5, maxValue: 16 }));
      const isCoarse = tc.draw(gs.booleans());
      const r = spiderRadiusForCluster(n, isCoarse);
      for (const a of spiderAngles(n)) {
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        const dist = Math.hypot(x, y);
        if (Math.abs(dist - r) > 1e-9) {
          throw new Error(`petal off-radius: dist=${dist}, expected=${r}`);
        }
      }
    }));
});

describe("performance budget", () => {
  // clusterPoints is O(n²) in pairwise distance checks. Lock "doesn't get
  // pathologically slower" without being so strict it fails on a slow CI
  // runner. If clusters ever start taking seconds at vault scale, this
  // catches the regression.

  test("250 candidates cluster within a generous budget (< 200ms)", () => {
    const candidates: ClusterCandidate[] = [];
    for (let i = 0; i < 250; i++) {
      candidates.push(pt(`P${i}`, (i * 17) % 800, (i * 31) % 400));
    }
    const start = performance.now();
    const result = clusterPoints(candidates, 1000, 1000);
    const elapsed = performance.now() - start;
    expect(result.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(200);
  });

  test("property: cluster count is bounded by candidate count (no infinite expansion)", { timeout: 30_000 }, () =>
    hegel.test((tc) => {
      const n = tc.draw(gs.integers({ minValue: 0, maxValue: 60 }));
      const candidates: ClusterCandidate[] = [];
      for (let i = 0; i < n; i++) {
        candidates.push(pt(`P${i}`,
          tc.draw(gs.integers({ minValue: 0, maxValue: 800 })),
          tc.draw(gs.integers({ minValue: 0, maxValue: 400 }))));
      }
      const clusters = clusterPoints(candidates, 1000, 1000);
      if (clusters.length > n) throw new Error(`got ${clusters.length} clusters from ${n} candidates`);
    }));
});
