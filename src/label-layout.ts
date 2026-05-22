/**
 * Pure label-layout algorithm. Decides each label's flip side based purely
 * on whether its bbox would overflow the plot's horizontal edges. Nothing
 * else — no label-vs-label or label-vs-dot resolution.
 *
 * Rule:
 *   - Default: label on the right of its dot.
 *   - If a group's unflipped bbox would overflow plot.right, flip to left.
 *   - If the flipped bbox would also overflow plot.left, stay right (accept
 *     the clip). Halo styling in styles.css softens the visual collision
 *     with neighbors; vertical positions are never touched.
 *
 * Group semantics: members of the same groupId flip together so cluster
 * stacks stay coherent. A flip decision considers ALL members — if any one
 * would overflow, the whole group flips.
 *
 * Why no collision resolution: iterative push/score-based layouts produced
 * worse outcomes than no resolution at all, and the cluster algorithm
 * already absorbs the dense regions where label collision would matter most.
 */

export interface LayoutLabel {
  filePath: string;
  /** Members of the same group flip together (singleton = unique groupId). */
  groupId: string;
  /** Dot center, used as the anchor reference for the label. */
  cx: number;
  cy: number;
  /** Label bbox dimensions (measured upstream). */
  width: number;
  height: number;
  /** Distance from cx to label anchor on the un-flipped side. */
  offsetX: number;
  /** Baseline y for this label. */
  initialAnchorY: number;
  /** False for non-flippable labels (large-cluster radial petals). They are
   *  excluded from the result so the caller's radial renderer keeps full
   *  control over their position and text-anchor. */
  flippable: boolean;
}

export interface PlotBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface LayoutPlacement {
  anchorX: number;
  anchorY: number;
  /** True if the label ended on the LEFT of its dot (text-anchor "end"). */
  flipped: boolean;
}

export type LayoutResult = Map<string, LayoutPlacement>;

/**
 * Compute the final placement for each flippable label.
 *
 * Per-group decision:
 *   1. If any unflipped member's bbox right edge > plot.right → flip group.
 *   2. If the flipped group's left edge < plot.left → revert (both sides
 *      overflow; right side wins by tiebreaker rule).
 *   3. Apply the chosen side to every member; anchorY is unchanged.
 *
 * Non-flippable labels (radial spider petals) are excluded from the result
 * so the caller's renderer retains authority over their layout.
 */
export function layoutLabels(
  labels: LayoutLabel[],
  plot: PlotBounds,
): LayoutResult {
  const groups = new Map<string, LayoutLabel[]>();
  for (const l of labels) {
    if (!l.flippable) continue;
    const arr = groups.get(l.groupId) ?? [];
    arr.push(l);
    groups.set(l.groupId, arr);
  }

  const result: LayoutResult = new Map();
  for (const members of groups.values()) {
    const flipped = decideFlip(members, plot);
    for (const m of members) {
      const anchorX = flipped ? m.cx - m.offsetX : m.cx + m.offsetX;
      result.set(m.filePath, {
        anchorX,
        anchorY: m.initialAnchorY,
        flipped,
      });
    }
  }
  return result;
}

function decideFlip(members: LayoutLabel[], plot: PlotBounds): boolean {
  const unflippedOverflowsRight = members.some(
    (m) => m.cx + m.offsetX + m.width > plot.right,
  );
  if (!unflippedOverflowsRight) return false;
  const flippedOverflowsLeft = members.some(
    (m) => m.cx - m.offsetX - m.width < plot.left,
  );
  return !flippedOverflowsLeft;
}
