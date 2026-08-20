/**
 * Pure control selection for the H1 list view.
 *
 * The list renders a fixed allowlist of frontmatter controls — `planned`
 * (date), `done` (checkbox), `area` (text). Which of them appear, and in
 * what order, comes from the view's `order` config. Anything outside the
 * allowlist is ignored: the list is deliberately not a generic table.
 */

export const CONTROL_ALLOWLIST = ["planned", "done", "area"] as const;
export type ControlKey = (typeof CONTROL_ALLOWLIST)[number];

/** Allowlisted control keys present in `order` (note.-prefixed or bare), in order. */
export function visibleControls(order: string[]): ControlKey[] {
  return order
    .map((propId) => (propId.startsWith("note.") ? propId.slice(5) : propId))
    .filter((key): key is ControlKey =>
      (CONTROL_ALLOWLIST as readonly string[]).includes(key),
    );
}
