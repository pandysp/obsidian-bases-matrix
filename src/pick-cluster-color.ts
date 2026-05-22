/**
 * Pick the representative color for a cluster — the mode of member colors,
 * with ties broken by first appearance.
 *
 * Extracted from cluster-renderer's renderCluster, where the same logic was
 * inlined. Exposing the function makes the tie-break rule (first-appearance,
 * inherited from Map insertion order) explicit and testable.
 *
 * Empty input throws — clusters always have ≥1 member by construction, and
 * a silent default would mask the upstream bug if a caller ever produced
 * an empty cluster.
 */
export function pickClusterColor(colors: readonly string[]): string {
  if (colors.length === 0) {
    throw new Error("pickClusterColor: empty input — clusters must have ≥1 member");
  }
  const counts = new Map<string, number>();
  for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);

  // Map iteration is insertion-order, so the first inserted color (= the
  // first color in the input) wins ties at the strict-greater check below.
  let best = colors[0];
  let bestCount = 0;
  for (const [color, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      best = color;
    }
  }
  return best;
}
