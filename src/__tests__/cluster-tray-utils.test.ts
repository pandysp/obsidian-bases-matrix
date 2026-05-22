/**
 * Tests for the pure helpers that back the cluster tray. The tray itself is
 * DOM-heavy (verified via CDP smoke tests); these helpers are extracted so
 * we can pin the behavior that *would* be hard to debug from screenshots.
 */
import { describe, expect, test } from "vitest";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import {
  sortRowsForDisplay,
  findMatchingLargeCluster,
  setsEqual,
  trayOrientation,
} from "../cluster-tray-utils";
import type { Cluster, ClusterCandidate } from "../cluster-renderer";
import type { PointDatum } from "../point-renderer";

function makeMember(filePath: string, label: string): ClusterCandidate {
  const datum: PointDatum = { entry: null, filePath, label, x: 0, y: 0 };
  return { datum, cx: 0, cy: 0, r: 8, color: "#888" };
}

function makeCluster(filePaths: string[], cx = 100, cy = 100): Cluster {
  return {
    members: filePaths.map((p) => makeMember(p, p)),
    cx, cy,
  };
}

describe("sortRowsForDisplay", () => {
  test("returns members sorted alphabetically by label", () => {
    const members = [
      makeMember("a.md", "Zebra"),
      makeMember("b.md", "Apple"),
      makeMember("c.md", "Mango"),
    ];
    const sorted = sortRowsForDisplay(members);
    expect(sorted.map((m) => m.datum.label)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  test("is case-insensitive", () => {
    const members = [
      makeMember("a.md", "banana"),
      makeMember("b.md", "Apple"),
      makeMember("c.md", "cherry"),
    ];
    const sorted = sortRowsForDisplay(members);
    expect(sorted.map((m) => m.datum.label)).toEqual(["Apple", "banana", "cherry"]);
  });

  test("does not mutate input", () => {
    const members = [
      makeMember("a.md", "Z"),
      makeMember("b.md", "A"),
    ];
    const labelsBefore = members.map((m) => m.datum.label);
    sortRowsForDisplay(members);
    expect(members.map((m) => m.datum.label)).toEqual(labelsBefore);
  });

  test("empty input returns empty array", () => {
    expect(sortRowsForDisplay([])).toEqual([]);
  });

  test("property: output is alphabetically non-decreasing", () =>
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 0, maxValue: 20 }));
      const members: ClusterCandidate[] = [];
      for (let i = 0; i < count; i++) {
        const label = tc.draw(gs.text({ maxLength: 30 }));
        members.push(makeMember(`f${i}.md`, label));
      }
      const sorted = sortRowsForDisplay(members);
      // Use the same comparator the sort uses — sensitivity: "base" treats
      // diacritic variants as equal (e.g., "ì" === "i"). A test using a
      // stricter comparator would flag accented-vs-bare letters as
      // "out of order" even though the sort considered them equivalent.
      for (let i = 1; i < sorted.length; i++) {
        const prev = sorted[i - 1].datum.label;
        const curr = sorted[i].datum.label;
        if (prev.localeCompare(curr, undefined, { sensitivity: "base" }) > 0) {
          throw new Error(`Out of order at index ${i}: "${prev}" > "${curr}"`);
        }
      }
    }));

  test("property: sorted output is a permutation of input (no loss, no dup)", () =>
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 0, maxValue: 20 }));
      const members: ClusterCandidate[] = [];
      const paths = new Set<string>();
      for (let i = 0; i < count; i++) {
        const label = tc.draw(gs.text({ maxLength: 15 }));
        const path = `f${i}.md`;
        paths.add(path);
        members.push(makeMember(path, label));
      }
      const sorted = sortRowsForDisplay(members);
      const sortedPaths = new Set(sorted.map((m) => m.datum.filePath));
      if (sortedPaths.size !== paths.size) {
        throw new Error(`Size mismatch: input=${paths.size} output=${sortedPaths.size}`);
      }
      for (const p of paths) {
        if (!sortedPaths.has(p)) throw new Error(`Missing path ${p} in sorted output`);
      }
    }));
});

describe("findMatchingLargeCluster", () => {
  test("returns the cluster with matching member set", () => {
    const clusters = [
      makeCluster(["a.md", "b.md", "c.md"]),
      makeCluster(["x.md", "y.md", "z.md"]),
    ];
    const result = findMatchingLargeCluster(
      clusters,
      new Set(["x.md", "y.md", "z.md"]),
      3,
    );
    expect(result).toBe(clusters[1]);
  });

  test("returns null when no cluster matches", () => {
    const clusters = [makeCluster(["a.md", "b.md", "c.md"])];
    const result = findMatchingLargeCluster(
      clusters,
      new Set(["x.md", "y.md", "z.md"]),
      3,
    );
    expect(result).toBeNull();
  });

  test("returns null when matched cluster has dropped below minimum", () => {
    // Tray was tracking {a, b, c}; after a drag-out it's now {a, b}.
    // Caller should close the tray — we return null to signal that.
    const clusters = [makeCluster(["a.md", "b.md"])];
    const result = findMatchingLargeCluster(
      clusters,
      new Set(["a.md", "b.md"]),
      3,
    );
    expect(result).toBeNull();
  });

  test("matches even when member ordering differs", () => {
    // Cluster member ordering isn't guaranteed across renders. Match is set-based.
    const clusters = [makeCluster(["c.md", "a.md", "b.md"])];
    const result = findMatchingLargeCluster(
      clusters,
      new Set(["a.md", "b.md", "c.md"]),
      3,
    );
    expect(result).toBe(clusters[0]);
  });

  test("size mismatch is not a match (subset)", () => {
    // A 4-member cluster doesn't match a 3-path memberSet just because all 3 are present.
    const clusters = [makeCluster(["a.md", "b.md", "c.md", "d.md"])];
    const result = findMatchingLargeCluster(
      clusters,
      new Set(["a.md", "b.md", "c.md"]),
      3,
    );
    expect(result).toBeNull();
  });

  test("empty cluster list returns null", () => {
    const result = findMatchingLargeCluster([], new Set(["a.md"]), 3);
    expect(result).toBeNull();
  });

  test("property: matching is symmetric — order of clusters in the list doesn't matter", () =>
    hegel.test((tc) => {
      const count = tc.draw(gs.integers({ minValue: 1, maxValue: 6 }));
      const clusters: Cluster[] = [];
      for (let i = 0; i < count; i++) {
        const memberCount = tc.draw(gs.integers({ minValue: 3, maxValue: 5 }));
        const paths = Array.from({ length: memberCount }, (_, j) => `c${i}-${j}.md`);
        clusters.push(makeCluster(paths));
      }
      const targetIdx = tc.draw(gs.integers({ minValue: 0, maxValue: count - 1 }));
      const targetSet = new Set(clusters[targetIdx].members.map((m) => m.datum.filePath));

      const forward = findMatchingLargeCluster(clusters, targetSet, 3);
      const reversed = findMatchingLargeCluster([...clusters].reverse(), targetSet, 3);

      // Same target cluster in both — they have distinct member sets.
      if (!forward || !reversed) {
        throw new Error("Expected a match in both orderings");
      }
      const fSet = new Set(forward.members.map((m) => m.datum.filePath));
      const rSet = new Set(reversed.members.map((m) => m.datum.filePath));
      for (const p of fSet) {
        if (!rSet.has(p)) throw new Error("Forward/reverse disagreement");
      }
    }));
});

describe("setsEqual", () => {
  test("two empty sets are equal", () => {
    expect(setsEqual(new Set<string>(), new Set<string>())).toBe(true);
  });

  test("identical small sets are equal", () => {
    expect(setsEqual(new Set(["a", "b", "c"]), new Set(["a", "b", "c"]))).toBe(true);
  });

  test("element order does not matter (Sets are unordered)", () => {
    expect(setsEqual(new Set(["a", "b", "c"]), new Set(["c", "b", "a"]))).toBe(true);
  });

  test("different sizes → not equal", () => {
    expect(setsEqual(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
  });

  test("same size, different members → not equal", () => {
    expect(setsEqual(new Set(["a", "b"]), new Set(["a", "c"]))).toBe(false);
  });

  test("property: equality is symmetric", () =>
    hegel.test((tc) => {
      const a = new Set(tc.draw(gs.arrays(gs.text({ maxLength: 8 }), { minSize: 0, maxSize: 12 })));
      const b = new Set(tc.draw(gs.arrays(gs.text({ maxLength: 8 }), { minSize: 0, maxSize: 12 })));
      if (setsEqual(a, b) !== setsEqual(b, a)) {
        throw new Error(`asymmetric: setsEqual(a,b)=${setsEqual(a, b)}, setsEqual(b,a)=${setsEqual(b, a)}`);
      }
    }));

  test("property: a set always equals itself (reflexive)", () =>
    hegel.test((tc) => {
      const a = new Set(tc.draw(gs.arrays(gs.text({ maxLength: 8 }), { minSize: 0, maxSize: 20 })));
      if (!setsEqual(a, a)) throw new Error("setsEqual(a, a) must be true");
    }));

  test("property: equal iff JS Set has-all-of in both directions (independent oracle)", () =>
    hegel.test((tc) => {
      const a = new Set(tc.draw(gs.arrays(gs.text({ maxLength: 8 }), { minSize: 0, maxSize: 10 })));
      const b = new Set(tc.draw(gs.arrays(gs.text({ maxLength: 8 }), { minSize: 0, maxSize: 10 })));
      // Oracle: same size + every member of A in B (and the reverse, ensured
      // by size equality + one-way subset).
      const oracle = a.size === b.size
        && Array.from(a).every((v) => b.has(v));
      if (setsEqual(a, b) !== oracle) {
        throw new Error(`disagrees with oracle for a=${[...a]} b=${[...b]}`);
      }
    }));

  test("property: transitivity — a == b and b == c → a == c", () =>
    hegel.test((tc) => {
      // Draw one set, mirror it twice through Set construction to test
      // identity-through-permutation (Sets are insertion-ordered but
      // setsEqual must not care).
      const elements = tc.draw(gs.arrays(gs.text({ maxLength: 8 }), { minSize: 0, maxSize: 12 }));
      const a = new Set(elements);
      const b = new Set([...elements].reverse());
      const c = new Set(elements);
      const ab = setsEqual(a, b);
      const bc = setsEqual(b, c);
      const ac = setsEqual(a, c);
      if (ab && bc && !ac) throw new Error("transitivity broken");
    }));
});

describe("trayOrientation", () => {
  test("landscape (wider than tall) → side", () => {
    expect(trayOrientation(1000, 600)).toBe("side");
  });

  test("portrait (taller than wide) → bottom", () => {
    expect(trayOrientation(400, 700)).toBe("bottom");
  });

  test("square defaults to side", () => {
    expect(trayOrientation(500, 500)).toBe("side");
  });

  test("property: result depends only on width >= height", () =>
    hegel.test((tc) => {
      const w = tc.draw(gs.integers({ minValue: 1, maxValue: 4000 }));
      const h = tc.draw(gs.integers({ minValue: 1, maxValue: 4000 }));
      const result = trayOrientation(w, h);
      const expected = w >= h ? "side" : "bottom";
      if (result !== expected) {
        throw new Error(`width=${w} height=${h} → ${result}, expected ${expected}`);
      }
    }));
});
