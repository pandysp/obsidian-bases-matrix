/**
 * Pure helpers for the cluster tray. Extracted from cluster-tray.ts so they
 * can be unit/property-tested without DOM machinery.
 */
import type { Cluster, ClusterCandidate } from "./cluster-renderer";

/** Set equality: same size + every member of `a` present in `b`. Reused by
 *  ClusterTray's toggle check and PointRenderer's --expanded-class lookup
 *  (the matching-cluster detection). */
export function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/** Sort cluster members for stable display in the tray. Alphabetical by
 *  label (case-insensitive), so the user can scan and predict positions.
 *  Pure: does not mutate the input. */
export function sortRowsForDisplay(
  members: ClusterCandidate[],
): ClusterCandidate[] {
  return [...members].sort((a, b) =>
    a.datum.label.localeCompare(b.datum.label, undefined, { sensitivity: "base" }),
  );
}

/** Find the cluster in `clusters` whose member set equals `memberPaths`.
 *  Used by tray.refresh() on re-render: cluster object identity isn't stable
 *  across renders, but member-file-path identity is.
 *
 *  Returns null in three cases (all signal "close the tray"):
 *    - no cluster has a matching member set
 *    - the matching cluster's size has dropped below `largeClusterMin` (the
 *      cluster is now small or singleton; tray is no longer appropriate)
 *    - input clusters is empty
 *
 *  Match is set-based (order-independent) and size-exact (subset != match). */
export function findMatchingLargeCluster(
  clusters: Cluster[],
  memberPaths: Set<string>,
  largeClusterMin: number,
): Cluster | null {
  for (const c of clusters) {
    if (c.members.length < largeClusterMin) continue;
    if (c.members.length !== memberPaths.size) continue;
    let allMatch = true;
    for (const m of c.members) {
      if (!memberPaths.has(m.datum.filePath)) {
        allMatch = false;
        break;
      }
    }
    if (allMatch) return c;
  }
  return null;
}

/** Tray slides in from the side ("side") on landscape-shaped containers, and
 *  from the bottom ("bottom") on portrait-shaped containers. Square ties go
 *  to "side" — most desktop and tablet usage is wider-than-tall, and the
 *  bottom drawer convention is specifically for narrow-tall phone shapes. */
export function trayOrientation(
  width: number,
  height: number,
): "side" | "bottom" {
  return width >= height ? "side" : "bottom";
}
