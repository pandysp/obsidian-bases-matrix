import { App, TFile } from "obsidian";
import { CSS } from "./constants";
import { clamp, clientToSvgPoint } from "./svg-utils";
import { touchDragFingerOffset } from "./geometry";
import { crossedDragThreshold, DEFAULT_DRAG_THRESHOLD_PX } from "./drag-gesture";
import { pixelToDataPoint, pixelToDataDelta } from "./coords";
import { computeDragWriteValues } from "./drag-write-values";
import type { PointDatum } from "./point-renderer";
import type { PlotDims } from "./axes-renderer";

export interface DragConfig {
  xMin: number; xMax: number; yMin: number; yMax: number;
  /** Frontmatter property keys (without note. prefix) to write x and y to. */
  xPropertyKey: string;
  yPropertyKey: string;
  /** Axis value types — drag-write formats the committed value via these so
   *  a time axis writes "5:30" not 330 and a date axis writes "2025-06-15"
   *  not 1750000000000. Default "numeric" for the legacy 2x2 matrix case. */
  xType: import("./value-type").ValueType;
  yType: import("./value-type").ValueType;
}

/**
 * Drag entry point: identifies which element the pointer landed on (origin),
 * plus the circle and optional label that belong to the same point. Pointer
 * capture is taken on `origin`; the dragging CSS class is applied to both
 * the circle and the label so either visual stays in the "active" state.
 */
export interface DragOrigin {
  origin: SVGElement;
  circle: SVGCircleElement;
  label: SVGTextElement | null;
}

export interface DragCallbacks {
  /** Provide current plot dimensions and config (called per drag, allows live resize). */
  getDims: () => PlotDims;
  getConfig: () => DragConfig;
  /** Live position update during drag. */
  onPositionChange: (filePath: string, pixelX: number, pixelY: number) => void;
  /** Commit final position to frontmatter. */
  onCommit: (filePath: string, dataX: number, dataY: number) => Promise<void>;
  /** Commit a cluster drag (multi-member). Caller decides snap + exact-write
   *  + parallel-write strategy. dx/dy are data-space deltas the cluster was
   *  translated by, with each member's startDataX/Y included so the caller
   *  can compute final coords. */
  onClusterCommit?: (
    members: Array<{ filePath: string; startDataX: number; startDataY: number }>,
    dataDx: number,
    dataDy: number,
  ) => Promise<void>;
  /** Fired the moment a real drag is detected (after the click-suppress
   *  threshold). Callers use this to hide the tooltip, collapse spiders,
   *  etc. — anything that should not survive into the dragged state. */
  onDragStart?: (filePath: string) => void;
}

/**
 * Pointer-event based drag handler for moving SVG points on the plot.
 * Uses pointer capture so the drag continues even if the cursor leaves the circle.
 * Writes the new x/y back to frontmatter on pointerup.
 *
 * Design notes:
 *   - One DragManager handles all points. A drag is identified by the pointerId.
 *   - We deliberately use pointer events (not HTML5 drag-drop) because:
 *       * Drag-drop fires a ghost preview we don't control
 *       * Pointer events give us per-frame coordinates for live updates
 *       * Same code works for touch
 *   - The 4px movement threshold prevents click handlers from being clobbered
 *     by accidental micro-drags.
 */
export class DragManager {
  private app: App;
  private callbacks: DragCallbacks;
  private activeDrag: {
    pointerId: number;
    filePath: string;
    datum: PointDatum;
    origin: SVGElement;
    circle: SVGCircleElement;
    label: SVGTextElement | null;
    /** Offset from cursor to circle center at pointerdown, in SVG space.
     *  Maintained throughout the drag so the grab point stays under the cursor
     *  rather than the circle snapping to the cursor. */
    offsetX: number;
    offsetY: number;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null = null;

  // Drag-vs-click threshold lives in ./drag-gesture as DEFAULT_DRAG_THRESHOLD_PX
  // so the cluster-drag and single-point-drag paths share one source of truth.

  /** Active CLUSTER drag (parallel to activeDrag for single-point). The
   *  cluster mark is grabbed; all members move together via a translate
   *  transform on the cluster group, then each member's frontmatter is
   *  written on release. */
  private activeClusterDrag: {
    pointerId: number;
    clusterGroup: SVGGElement;
    origin: SVGElement;
    /** Each member's filePath + their starting data-space coords (read from
     *  the cluster's input data) so commit can compute newX = startX + dx. */
    members: Array<{ filePath: string; startDataX: number; startDataY: number }>;
    startClientX: number;
    startClientY: number;
    moved: boolean;
  } | null = null;

  constructor(app: App, callbacks: DragCallbacks) {
    this.app = app;
    this.callbacks = callbacks;
  }

  /** True while a real (moved beyond DEFAULT_DRAG_THRESHOLD_PX) drag is in progress.
   *  Used by MatrixView.handleHover to suppress the tooltip during drag —
   *  pointerover can re-fire mid-drag on iOS and the tooltip would otherwise
   *  re-show after onDragStart's explicit hide. */
  isDragging(): boolean {
    return (this.activeDrag !== null && this.activeDrag.moved)
      || (this.activeClusterDrag !== null && this.activeClusterDrag.moved);
  }

  /**
   * Cluster drag entry point. Tracks the cluster mark; visual update is a
   * single translate transform on the cluster group (vs. updating each
   * member's circle individually). On commit, writes each member's
   * frontmatter with the new data-space coords.
   */
  startClusterDrag(
    members: Array<{ filePath: string; startDataX: number; startDataY: number }>,
    clusterGroup: SVGGElement,
    markEl: SVGCircleElement,
    evt: PointerEvent,
  ): void {
    if (evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();
    document.addEventListener("touchmove", this.blockTouchDuringDrag, { capture: true, passive: false });
    document.addEventListener("touchstart", this.blockTouchDuringDrag, { capture: true, passive: false });

    this.activeClusterDrag = {
      pointerId: evt.pointerId,
      clusterGroup,
      origin: markEl,
      members,
      startClientX: evt.clientX,
      startClientY: evt.clientY,
      moved: false,
    };
    markEl.setPointerCapture(evt.pointerId);
    markEl.addEventListener("pointermove", this.onClusterPointerMove);
    markEl.addEventListener("pointerup", this.onClusterPointerUp);
    markEl.addEventListener("pointercancel", this.onClusterPointerCancel);
  }

  private onClusterPointerMove = (evt: PointerEvent): void => {
    if (!this.activeClusterDrag || evt.pointerId !== this.activeClusterDrag.pointerId) return;
    const drag = this.activeClusterDrag;
    if (!drag.moved && !crossedDragThreshold(
      drag.startClientX, drag.startClientY,
      evt.clientX, evt.clientY,
      DEFAULT_DRAG_THRESHOLD_PX,
    )) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.clusterGroup.classList.add(CSS.CLUSTER_GROUP_DRAGGING);
      this.callbacks.onDragStart?.(drag.members[0]?.filePath ?? "");
    }
    const svg = drag.clusterGroup.ownerSVGElement;
    if (!svg) return;
    const start = clientToSvgPoint(svg,drag.startClientX, drag.startClientY);
    const cur = clientToSvgPoint(svg,evt.clientX, evt.clientY);
    if (!start || !cur) return;
    drag.clusterGroup.setAttribute("transform", `translate(${cur.x - start.x}, ${cur.y - start.y})`);
  };

  private onClusterPointerUp = async (evt: PointerEvent): Promise<void> => {
    if (!this.activeClusterDrag || evt.pointerId !== this.activeClusterDrag.pointerId) return;
    const drag = this.activeClusterDrag;
    this.detachClusterListeners(drag);

    if (!drag.moved) {
      drag.clusterGroup.classList.remove(CSS.CLUSTER_GROUP_DRAGGING);
      return; // click handler will run for the toggle-expand path
    }
    // Keep the dragging class long enough to suppress the synthetic click
    // (same iOS-touch-delay reason as single-point drag).
    const clickSuppressDelay = evt.pointerType === "touch" ? 400 : 50;
    setTimeout(() => drag.clusterGroup.classList.remove(CSS.CLUSTER_GROUP_DRAGGING), clickSuppressDelay);

    // Compute data-space delta from the final transform.
    const transform = drag.clusterGroup.getAttribute("transform") ?? "";
    const match = transform.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/);
    if (!match) return;
    const pixelDx = parseFloat(match[1]);
    const pixelDy = parseFloat(match[2]);
    const dims = this.callbacks.getDims();
    const config = this.callbacks.getConfig();
    const { dataDx, dataDy } = pixelToDataDelta({
      pixelDx, pixelDy,
      plot: {
        left: dims.padding.left,
        right: dims.width - dims.padding.right,
        top: dims.padding.top,
        bottom: dims.height - dims.padding.bottom,
      },
      axes: { xMin: config.xMin, xMax: config.xMax, yMin: config.yMin, yMax: config.yMax },
    });

    try {
      // Delegate the actual writes to the caller (matrix-view) so snap-to-
      // point + parallel-write happens with knowledge of the full dataset.
      await this.callbacks.onClusterCommit?.(drag.members, dataDx, dataDy);
    } catch (err) {
      console.error("[bases-matrix] failed to commit cluster drag:", err);
      drag.clusterGroup.removeAttribute("transform");
    }
  };

  private onClusterPointerCancel = (evt: PointerEvent): void => {
    if (!this.activeClusterDrag || evt.pointerId !== this.activeClusterDrag.pointerId) return;
    const drag = this.activeClusterDrag;
    this.detachClusterListeners(drag);
    drag.clusterGroup.classList.remove(CSS.CLUSTER_GROUP_DRAGGING);
    drag.clusterGroup.removeAttribute("transform");
  };

  private detachClusterListeners(drag: NonNullable<typeof this.activeClusterDrag>): void {
    drag.origin.removeEventListener("pointermove", this.onClusterPointerMove);
    drag.origin.removeEventListener("pointerup", this.onClusterPointerUp);
    drag.origin.removeEventListener("pointercancel", this.onClusterPointerCancel);
    document.removeEventListener("touchmove", this.blockTouchDuringDrag, { capture: true } as AddEventListenerOptions);
    document.removeEventListener("touchstart", this.blockTouchDuringDrag, { capture: true } as AddEventListenerOptions);
    try { drag.origin.releasePointerCapture(drag.pointerId); } catch { /* ignore */ }
    this.activeClusterDrag = null;
  }

  /** Call from PointRenderer's onPointerDown callback. */
  startDrag(datum: PointDatum, evt: PointerEvent, dragOrigin: DragOrigin): void {
    // Only primary button.
    if (evt.button !== 0) return;
    evt.preventDefault();
    evt.stopPropagation();
    // Belt-and-suspenders against Obsidian Mobile's workspace-level swipe
    // gesture. The primary fix is the SVG-level bubble-phase touch listeners
    // in MatrixView.onload — these document-level capture-phase listeners
    // catch any handler registered ABOVE the SVG in capture phase. Scoped to
    // the active-drag window so we don't disable global gestures.
    document.addEventListener("touchmove", this.blockTouchDuringDrag, { capture: true, passive: false });
    document.addEventListener("touchstart", this.blockTouchDuringDrag, { capture: true, passive: false });

    const { origin, circle, label } = dragOrigin;
    // For labels, preserve the initial cursor-to-circle offset so the grab
    // point on the label stays under the cursor as the point moves. For
    // circles, keep the historical snap-to-cursor behavior (offset = 0):
    // clicking a circle anywhere on its area snaps its center to the cursor.
    let offsetX = 0;
    let offsetY = 0;
    if (origin === label && label !== null) {
      const svg = circle.ownerSVGElement;
      if (svg) {
        const cursor = clientToSvgPoint(svg,evt.clientX, evt.clientY);
        if (cursor) {
          const cx = Number(circle.getAttribute("cx") ?? "0");
          const cy = Number(circle.getAttribute("cy") ?? "0");
          offsetX = cx - cursor.x;
          offsetY = cy - cursor.y;
        }
      }
    }

    this.activeDrag = {
      pointerId: evt.pointerId,
      filePath: datum.filePath,
      datum,
      origin,
      circle,
      label,
      offsetX,
      offsetY,
      startClientX: evt.clientX,
      startClientY: evt.clientY,
      moved: false,
    };

    origin.setPointerCapture(evt.pointerId);
    origin.addEventListener("pointermove", this.onPointerMove);
    origin.addEventListener("pointerup", this.onPointerUp);
    origin.addEventListener("pointercancel", this.onPointerCancel);
  }

  private onPointerMove = (evt: PointerEvent): void => {
    if (!this.activeDrag || evt.pointerId !== this.activeDrag.pointerId) return;

    if (!this.activeDrag.moved && !crossedDragThreshold(
      this.activeDrag.startClientX, this.activeDrag.startClientY,
      evt.clientX, evt.clientY,
      DEFAULT_DRAG_THRESHOLD_PX,
    )) {
      return;
    }
    if (!this.activeDrag.moved) {
      this.activeDrag.moved = true;
      this.applyDraggingClass(this.activeDrag);
      this.callbacks.onDragStart?.(this.activeDrag.filePath);
    }

    // Translate cursor position to SVG coordinate space.
    const svg = this.activeDrag.circle.ownerSVGElement;
    if (!svg) return;
    const pt = clientToSvgPoint(svg,evt.clientX, evt.clientY);
    if (!pt) return;

    const dims = this.callbacks.getDims();
    const left = dims.padding.left;
    const right = dims.width - dims.padding.right;
    const top = dims.padding.top;
    const bottom = dims.height - dims.padding.bottom;
    // Preserve the initial cursor-to-circle offset so the grab point stays put.
    // Then clamp to plot area so points can't escape the chart.
    const cx = clamp(pt.x + this.activeDrag.offsetX, left, right);
    let cy = pt.y + this.activeDrag.offsetY;
    // Touch + circle-origin drag: lift the dot above the finger so it's
    // visible. Label-origin drag skips this — the dot is already off to the
    // side, finger doesn't occlude it, and lifting would feel disorienting.
    // Adaptive offset: in landscape the plot is short and a fixed 30px lift
    // pins the dot at the top edge, breaking the follow-the-finger feel.
    // Scale the offset to plot height so it stays proportional.
    if (
      evt.pointerType === "touch"
      && this.activeDrag.origin === this.activeDrag.circle
    ) {
      cy -= touchDragFingerOffset(bottom - top);
    }
    cy = clamp(cy, top, bottom);

    this.callbacks.onPositionChange(this.activeDrag.filePath, cx, cy);
  };

  private onPointerUp = async (evt: PointerEvent): Promise<void> => {
    if (!this.activeDrag || evt.pointerId !== this.activeDrag.pointerId) return;
    const drag = this.activeDrag;
    this.detachListeners(drag);

    if (!drag.moved) {
      // No actual drag occurred — let the click event fire normally to navigate.
      this.clearDraggingClass(drag);
      return;
    }

    // Drag happened. The browser synthesizes a `click` after pointerup. The
    // click handler skips navigation when the dragging class is present, so
    // we keep the class long enough to cover that click. iOS Safari delays
    // the click event by up to ~350ms after touch — setTimeout(0) clears the
    // class too early and the modal opens after a real drag. Use a delay
    // that's safely longer than iOS's click delay.
    const clickSuppressDelay = evt.pointerType === "touch" ? 400 : 50;
    setTimeout(() => this.clearDraggingClass(drag), clickSuppressDelay);

    // Compute final data-space coords from circle position.
    const cx = Number(drag.circle.getAttribute("cx") ?? "0");
    const cy = Number(drag.circle.getAttribute("cy") ?? "0");
    const dims = this.callbacks.getDims();
    const config = this.callbacks.getConfig();
    const left = dims.padding.left;
    const right = dims.width - dims.padding.right;
    const top = dims.padding.top;
    const bottom = dims.height - dims.padding.bottom;
    const { dataX, dataY } = pixelToDataPoint({
      pixelX: cx,
      pixelY: cy,
      plot: { left, right, top, bottom },
      axes: { xMin: config.xMin, xMax: config.xMax, yMin: config.yMin, yMax: config.yMax },
    });

    try {
      await this.callbacks.onCommit(drag.filePath, dataX, dataY);
    } catch (err) {
      console.error("[bases-matrix] failed to commit drag:", err);
    }
  };

  private onPointerCancel = (evt: PointerEvent): void => {
    if (!this.activeDrag || evt.pointerId !== this.activeDrag.pointerId) return;
    const drag = this.activeDrag;
    this.detachListeners(drag);
    this.clearDraggingClass(drag);
  };

  private applyDraggingClass(drag: NonNullable<typeof this.activeDrag>): void {
    drag.circle.classList.add(CSS.POINT_DRAGGING);
    drag.label?.classList.add(CSS.POINT_LABEL_DRAGGING);
  }

  private clearDraggingClass(drag: NonNullable<typeof this.activeDrag>): void {
    drag.circle.classList.remove(CSS.POINT_DRAGGING);
    drag.label?.classList.remove(CSS.POINT_LABEL_DRAGGING);
  }

  /** Detach pointer listeners and release capture. Visual class removal is the caller's job. */
  private detachListeners(drag: NonNullable<typeof this.activeDrag>): void {
    drag.origin.removeEventListener("pointermove", this.onPointerMove);
    drag.origin.removeEventListener("pointerup", this.onPointerUp);
    drag.origin.removeEventListener("pointercancel", this.onPointerCancel);
    document.removeEventListener("touchmove", this.blockTouchDuringDrag, { capture: true } as AddEventListenerOptions);
    document.removeEventListener("touchstart", this.blockTouchDuringDrag, { capture: true } as AddEventListenerOptions);
    try { drag.origin.releasePointerCapture(drag.pointerId); } catch { /* ignore */ }
    this.activeDrag = null;
  }

  /** Document-level capture-phase listener installed only during active drag.
   *  See startDrag for rationale (belt-and-suspenders against ancestor-level
   *  capture-phase gesture handlers). The activeDrag check ensures this is a
   *  no-op when no drag is in progress, so global gestures are unaffected. */
  private blockTouchDuringDrag = (evt: TouchEvent): void => {
    if (this.activeDrag === null) return;
    evt.preventDefault();
    evt.stopPropagation();
  };


  /**
   * Write x/y data values to the file's frontmatter. Uses Obsidian's
   * processFrontMatter so YAML formatting and other fields are preserved.
   * When `exact` is true, skips rounding — used for snap-to-point so the
   * dragged value matches the target's value bit-exactly (no 7.34 → 7.3 drift).
   */
  async writeFrontmatter(
    filePath: string,
    xKey: string,
    yKey: string,
    xValue: number,
    yValue: number,
    xRange: number,
    yRange: number,
    xType: import("./value-type").ValueType,
    yType: import("./value-type").ValueType,
    exact = false,
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) {
      throw new Error(`File not found or not a TFile: ${filePath}`);
    }
    // computeDragWriteValues routes numeric → number, time/date → formatted
    // string so the user's "5:30" / "2025-06-15" frontmatter format is
    // preserved across drag commits.
    const { x, y } = computeDragWriteValues({ xValue, yValue, xRange, yRange, xType, yType, exact });
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm[xKey] = x;
      fm[yKey] = y;
    });
  }
}

