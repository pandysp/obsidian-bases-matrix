/**
 * Tests for sortClustersForPaint — the cluster paint-order rule.
 *
 * Why this is its own helper with its own tests: SVG paints in DOM order, so
 * the order we append cluster groups to the layer IS the z-order for label
 * overlap. The matrix relies on "rightmost wins" — the rightmost label paints
 * on top so its informative left side (start of the title) stays visible
 * while the loser keeps its own left side. Break this ordering and overlap
 * resolution becomes arbitrary.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { sortClustersForPaint, type Cluster } from "../cluster-renderer";
import type { ClusterCandidate } from "../cluster-renderer";

/** Minimal Cluster fixture. members is required by the type; sort ignores it. */
function cluster(cx: number, cy = 0, members: ClusterCandidate[] = []): Cluster {
  return { cx, cy, members };
}

/** Cluster carrying a single fake member with a unique filePath so we can
 *  check permutation identity without relying on object reference. */
function clusterWithId(cx: number, filePath: string): Cluster {
  const member = {
    datum: { filePath, label: filePath, x: cx, y: 0, entry: {} },
    cx, cy: 0, r: 8, color: "blue",
  } as ClusterCandidate;
  return { cx, cy: 0, members: [member] };
}

describe("sortClustersForPaint — unit", () => {
  test("empty input → empty output", () => {
    expect(sortClustersForPaint([])).toEqual([]);
  });

  test("already cx-ascending input is unchanged", () => {
    const input = [cluster(10), cluster(20), cluster(30)];
    const out = sortClustersForPaint(input);
    expect(out.map((c) => c.cx)).toEqual([10, 20, 30]);
  });

  test("reverse-sorted input is reversed — proves the sort actually runs", () => {
    const input = [cluster(30), cluster(20), cluster(10)];
    const out = sortClustersForPaint(input);
    expect(out.map((c) => c.cx)).toEqual([10, 20, 30]);
  });

  test("mixed input → cx-ascending output", () => {
    const input = [cluster(50), cluster(10), cluster(30), cluster(20), cluster(40)];
    const out = sortClustersForPaint(input);
    expect(out.map((c) => c.cx)).toEqual([10, 20, 30, 40, 50]);
  });

  test("does not mutate the input array", () => {
    const input = [cluster(30), cluster(10), cluster(20)];
    const snapshot = input.map((c) => c.cx);
    sortClustersForPaint(input);
    expect(input.map((c) => c.cx)).toEqual(snapshot);
  });
});

describe("sortClustersForPaint — properties", () => {
  function arbitraryClusters(tc: { draw: <T>(g: unknown) => T }): Cluster[] {
    const count = tc.draw(gs.integers({ minValue: 0, maxValue: 20 }));
    const out: Cluster[] = [];
    for (let i = 0; i < count; i++) {
      const cx = tc.draw(gs.integers({ minValue: -500, maxValue: 1500 }));
      out.push(clusterWithId(cx, `P${i}`));
    }
    return out;
  }

  test("output is cx-monotonic non-decreasing (the core invariant)", () =>
    hegel.test((tc) => {
      const input = arbitraryClusters(tc);
      const out = sortClustersForPaint(input);
      for (let i = 1; i < out.length; i++) {
        if (out[i].cx < out[i - 1].cx) {
          throw new Error(`Not monotonic at ${i}: ${out[i - 1].cx} > ${out[i].cx}`);
        }
      }
    }));

  test("output is a permutation of input — no loss, no duplication", () =>
    hegel.test((tc) => {
      const input = arbitraryClusters(tc);
      const out = sortClustersForPaint(input);
      const idsOf = (cs: Cluster[]) =>
        new Set(cs.map((c) => c.members[0].datum.filePath));
      const inIds = idsOf(input);
      const outIds = idsOf(out);
      if (out.length !== input.length) {
        throw new Error(`Length mismatch: in=${input.length}, out=${out.length}`);
      }
      if (inIds.size !== outIds.size) {
        throw new Error(`Set size mismatch: in=${inIds.size}, out=${outIds.size}`);
      }
      for (const id of inIds) {
        if (!outIds.has(id)) throw new Error(`Missing id: ${id}`);
      }
    }));

  // Stable for equal cx — JS Array.sort is stable as of ES2019; locking it
  // here so a future "optimization" (custom sort, alternative algorithm)
  // can't silently break the contract callers depend on.
  test("stable for equal cx — clusters at the same cx preserve input order", () =>
    hegel.test((tc) => {
      const cx = tc.draw(gs.integers({ minValue: -200, maxValue: 1200 }));
      const count = tc.draw(gs.integers({ minValue: 2, maxValue: 8 }));
      const tied: Cluster[] = [];
      for (let i = 0; i < count; i++) {
        tied.push(clusterWithId(cx, `T${i}`));
      }
      const out = sortClustersForPaint(tied);
      for (let i = 0; i < count; i++) {
        const got = out[i].members[0].datum.filePath;
        const want = `T${i}`;
        if (got !== want) {
          throw new Error(`Stability broken at ${i}: got ${got}, want ${want}`);
        }
      }
    }));

  test("stable for equal cx — interleaved with other cx values", () => {
    // Two clusters at cx=100 with distinguishable ids, sandwiched by lower
    // and higher cx values. The two equal-cx clusters must retain order A
    // before B regardless of what surrounds them.
    const input: Cluster[] = [
      clusterWithId(50, "left"),
      clusterWithId(100, "A"),
      clusterWithId(200, "right"),
      clusterWithId(100, "B"),
    ];
    const out = sortClustersForPaint(input);
    const ids = out.map((c) => c.members[0].datum.filePath);
    expect(ids).toEqual(["left", "A", "B", "right"]);
  });
});
