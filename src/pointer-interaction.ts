/**
 * Shared pointer-event wiring used by both singleton points (PointRenderer)
 * and cluster petals (cluster-renderer). Extracts hover, click (with drag-
 * suppression), and pointerdown into one place — the four-event contract is
 * identical for either surface.
 */
import type { DragOrigin } from "./drag-manager";
import type { PointDatum } from "./point-renderer";

export interface PointerInteractionCallbacks {
  onHover: (datum: PointDatum, evt: PointerEvent) => void;
  onHoverEnd: () => void;
  onClick: (datum: PointDatum, evt: PointerEvent) => void;
  onPointerDown: (datum: PointDatum, evt: PointerEvent, origin: DragOrigin) => void;
}

/**
 * Attach pointer events on an element so it becomes a drag-or-click surface
 * for the given point. `draggingClass` is consulted by the click handler to
 * suppress navigation right after a real drag (the click that fires
 * synthetically after pointerup would otherwise open the modal).
 */
export function wirePointerInteraction(
  el: SVGElement,
  datum: PointDatum,
  dragOrigin: DragOrigin,
  draggingClass: string,
  callbacks: PointerInteractionCallbacks,
): void {
  el.addEventListener("pointerover", (e) => callbacks.onHover(datum, e as PointerEvent));
  el.addEventListener("pointerout", () => callbacks.onHoverEnd());
  el.addEventListener("click", (e) => {
    if (!el.classList.contains(draggingClass)) {
      callbacks.onClick(datum, e as PointerEvent);
    }
  });
  el.addEventListener("pointerdown", (e) => {
    callbacks.onPointerDown(datum, e as PointerEvent, dragOrigin);
  });
}
