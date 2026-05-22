/**
 * Cluster tray — an HTML overlay opened on tap of a large cluster (≥3
 * members). Replaces the radial spider, which didn't scale past ~12 members
 * and overflowed plot edges on small viewports. The tray:
 *
 *   - lists members as rows (colored dot + title), sorted alphabetically
 *   - lives inside .matrix-container so it can slide in from the side
 *     (landscape) or bottom (portrait), driven by a CSS container query
 *   - tap a row → caller opens the note (tray stays open)
 *   - drag a row → caller takes over (ghost dot, frontmatter write)
 *   - close on × button, on outside tap (caller decides), or when the
 *     cluster dissolves below the large-cluster minimum
 *
 * State across re-renders is preserved by tracking the open cluster's
 * member-path set; on refresh() we look it up in the new cluster list.
 * If the cluster shrank below the minimum (drag-out, AI edit), refresh
 * closes the tray automatically.
 */
import { setIcon } from "obsidian";
import { CSS } from "./constants";
import type { Cluster, ClusterCandidate } from "./cluster-renderer";
import { findMatchingLargeCluster, setsEqual, sortRowsForDisplay } from "./cluster-tray-utils";
import { crossedDragThreshold, DEFAULT_DRAG_THRESHOLD_PX } from "./drag-gesture";
import { pickClusterColor } from "./pick-cluster-color";

/** Minimum cluster size that opens the tray. Clusters of 1 are singletons;
 *  every cluster ≥2 opens the tray when tapped. The "small cluster"
 *  (stacked labels next to the mark) path was retired — clusters of any
 *  size now use the same count-glyph + tray UI. */
export const LARGE_CLUSTER_MIN = 2;

/** Slide animation duration. Must stay in sync with the CSS transition on
 *  .matrix-cluster-tray (otherwise the close-then-remove timing leaves a
 *  partially-animated element in the DOM). */
const SLIDE_ANIMATION_MS = 200;

/** On touch devices, the user must hold a row this long before the gesture
 *  commits to drag-out. Before this elapses, the gesture stays a candidate
 *  for tap (release) or native scroll (move). 450ms matches iOS Reminders
 *  / Photos reorder feel. */
const LONG_PRESS_MS = 450;

/** While waiting for the long-press timer, finger movement beyond this
 *  many pixels cancels the timer (user is scrolling, not pressing). */
const LONG_PRESS_SLOP_PX = 8;

/** Portrait bottom-sheet snap points, expressed as fractions of the matrix
 *  container's height (not the viewport). The matrix container is already
 *  sized to fit between Obsidian's chrome (app titlebar, Bases toolbar),
 *  so 100% of the container = full available area without ever covering
 *  the chrome. The grip handle sits at the top of the container — still
 *  reachable for dragging the tray back down.
 *
 *  Two points only: collapsed = default opening size; expanded = full
 *  container height. */
const BOTTOM_SHEET_SNAPS = {
  collapsed: 0.20,
  expanded: 1.0,
} as const;

export interface ClusterTrayCallbacks {
  /** A row was tapped. Caller opens the corresponding note. Tray stays open. */
  onRowTap: (filePath: string) => void;
  /** A row's pointer crossed the drag threshold. Caller takes over: creates
   *  a ghost dot, tracks the pointer, commits/cancels on release. The tray
   *  fades to translucent via setDragging(true) until the drag completes.
   *  The member includes color + pixel position (cluster center) so the
   *  caller can render the ghost without re-lookup. */
  onRowDragStart: (member: ClusterCandidate, evt: PointerEvent) => void;
  /** Pointer entered a row — caller shows the same hover tooltip used for
   *  singleton dots. */
  onRowHover?: (member: ClusterCandidate, evt: PointerEvent) => void;
  /** Pointer left a row — caller hides the tooltip. */
  onRowHoverEnd?: () => void;
  /** Optional: fired when the tray closes for any reason. */
  onClose?: () => void;
}

export class ClusterTray {
  private container: HTMLElement;
  private trayEl: HTMLDivElement | null = null;
  /** The currently-open cluster. memberPaths is derived via getMemberSet().
   *  Null when closed. */
  private currentCluster: Cluster | null = null;
  private callbacks: ClusterTrayCallbacks;
  /** Disposer for the active touchmove-blocker (set while a gesture is
   *  actively running — long-press drag-out, header resize). Null when no
   *  gesture is in progress. */
  private touchMoveBlockerDispose: (() => void) | null = null;

  constructor(container: HTMLElement, callbacks: ClusterTrayCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
  }

  /**
   * Suppress browser-default gestures (native scroll) AND prevent
   * Obsidian Mobile's window-level gesture handlers from receiving the
   * touch events during an active in-tray gesture (long-press drag-out
   * on a row, or resize drag on the header).
   *
   * Why both are needed:
   *
   *   - preventDefault() blocks the browser's native scroll / pan / zoom
   *     interpretation. touch-action CSS can't do this mid-gesture on iOS
   *     (touch-action is evaluated at touchstart and ignored thereafter).
   *
   *   - stopPropagation() (with capture: true so we're in the capture
   *     phase) prevents Obsidian's document-level gesture listeners from
   *     ever seeing the events. preventDefault alone leaves Obsidian's
   *     own touchmove handler running, which is how the command-palette
   *     swipe-down was triggering despite the previous blocker.
   *
   * We block all three of touchstart, touchmove, touchend because
   * gesture recognizers can be armed by any of them. Listeners run in
   * the capture phase so we preempt descendants; capture-phase listeners
   * registered earlier than ours still fire first, but Obsidian's are
   * most likely in bubble phase.
   *
   * Pointer events propagate normally; only touch events are intercepted.
   * The DragManager's pointer-based tracking is unaffected.
   */
  private blockNativeGestures(): void {
    if (this.touchMoveBlockerDispose) return;
    const types: Array<keyof DocumentEventMap> = ["touchstart", "touchmove", "touchend"];
    const listener = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const opts: AddEventListenerOptions = { passive: false, capture: true };
    for (const t of types) {
      document.addEventListener(t, listener as EventListener, opts);
    }
    this.touchMoveBlockerDispose = () => {
      for (const t of types) {
        document.removeEventListener(t, listener as EventListener, opts);
      }
    };
  }

  private unblockNativeGestures(): void {
    if (!this.touchMoveBlockerDispose) return;
    this.touchMoveBlockerDispose();
    this.touchMoveBlockerDispose = null;
  }

  isOpen(): boolean {
    return this.trayEl !== null;
  }

  /** Set of file paths in the currently-open cluster, or null if closed.
   *  Read-only — caller must not mutate (we return the live derivation). */
  getMemberSet(): Set<string> | null {
    if (!this.currentCluster) return null;
    return new Set(this.currentCluster.members.map((m) => m.datum.filePath));
  }

  /** Open the tray for `cluster`. If the tray is already open for the same
   *  cluster (member-set equal), close it instead (tap-to-toggle). If open
   *  for a different cluster, swap contents in place — the slide animation
   *  doesn't re-run, just the content. */
  open(cluster: Cluster): void {
    const newPaths = new Set(cluster.members.map((m) => m.datum.filePath));
    const currentPaths = this.getMemberSet();

    if (currentPaths && setsEqual(currentPaths, newPaths)) {
      this.close();
      return;
    }

    this.currentCluster = cluster;

    if (!this.trayEl) {
      this.trayEl = this.buildTrayEl();
      this.container.appendChild(this.trayEl);
      // Force layout flush so adding --open triggers the transition rather
      // than rendering the final state instantly.
      void this.trayEl.offsetHeight;
      this.trayEl.classList.add(CSS.CLUSTER_TRAY_OPEN);
    } else {
      // Cluster swap — content updates in place; outer panel stays put.
      this.refreshContent();
    }
  }

  /** Close the tray. Slides out, then removes from DOM after the animation. */
  close(): void {
    if (!this.trayEl) return;
    const el = this.trayEl;
    this.trayEl = null;
    this.currentCluster = null;
    el.classList.remove(CSS.CLUSTER_TRAY_OPEN);
    setTimeout(() => el.remove(), SLIDE_ANIMATION_MS);
    this.callbacks.onClose?.();
  }

  /** Toggle the translucent-during-drag state. Caller flips this true when
   *  a row drag starts and false on release. Tray fades AND becomes
   *  pointer-events: none (CSS) so the pointer falls through to the SVG
   *  plot underneath — user can drop on plot positions visually covered
   *  by the tray. */
  setDragging(dragging: boolean): void {
    if (!this.trayEl) return;
    this.trayEl.classList.toggle(CSS.CLUSTER_TRAY_DRAGGING, dragging);
  }

  /** Re-find the tracked cluster in `allClusters` by member-set. If still
   *  present and ≥LARGE_CLUSTER_MIN, refresh content. Otherwise close.
   *  Called by matrix-view on every render. */
  refresh(allClusters: Cluster[]): void {
    const target = this.getMemberSet();
    if (!target) return;
    const match = findMatchingLargeCluster(allClusters, target, LARGE_CLUSTER_MIN);
    if (!match) {
      this.close();
      return;
    }
    this.currentCluster = match;
    this.refreshContent();
  }

  private buildTrayEl(): HTMLDivElement {
    const el = document.createElement("div");
    el.className = CSS.CLUSTER_TRAY;

    const header = document.createElement("div");
    header.className = CSS.CLUSTER_TRAY_HEADER;

    const mark = document.createElement("span");
    mark.className = CSS.CLUSTER_TRAY_MARK;

    const count = document.createElement("span");
    count.className = CSS.CLUSTER_TRAY_COUNT;

    const closeBtn = document.createElement("button");
    closeBtn.className = CSS.CLUSTER_TRAY_CLOSE;
    closeBtn.setAttribute("aria-label", "Close cluster tray");
    // Obsidian-native X icon (Lucide) for visual consistency with modal
    // close buttons elsewhere in the app.
    setIcon(closeBtn, "lucide-x");
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close();
    });

    header.appendChild(mark);
    header.appendChild(count);
    header.appendChild(closeBtn);
    el.appendChild(header);

    const list = document.createElement("div");
    list.className = CSS.CLUSTER_TRAY_LIST;
    el.appendChild(list);

    this.attachHeaderResize(el, header, closeBtn);
    this.populateInto(el);
    return el;
  }

  /**
   * Bottom-sheet resize gesture: drag the header up/down to grow/shrink
   * the tray. On pointer release, snap to the nearest of three points
   * (collapsed / default / expanded). Active only in portrait orientation
   * — the side panel (landscape) is a fixed-width column, no resize.
   *
   * The close button lives inside the header but must remain tappable;
   * we skip the resize start when the pointer originated on it.
   */
  private attachHeaderResize(
    tray: HTMLDivElement,
    header: HTMLDivElement,
    closeBtn: HTMLButtonElement,
  ): void {
    let dragStartY = 0;
    let dragStartHeight = 0;
    let dragging = false;
    let pointerCaptured = false;

    const isPortrait = () => {
      const rect = this.container.getBoundingClientRect();
      return rect.height > rect.width;
    };

    const onPointerDown = (e: PointerEvent) => {
      if (!isPortrait()) return;
      // Ignore taps that originated on the close button (which has its
      // own click handler).
      if (closeBtn.contains(e.target as Node)) return;
      dragStartY = e.clientY;
      dragStartHeight = tray.getBoundingClientRect().height;
      dragging = true;
      tray.classList.add(CSS.CLUSTER_TRAY_RESIZING);
      // Block both browser native scroll and Obsidian Mobile's window-level
      // swipe gestures (e.g. top-edge swipe → command palette) for the
      // duration of the resize drag.
      this.blockNativeGestures();
      try {
        header.setPointerCapture(e.pointerId);
        pointerCaptured = true;
      } catch { /* capture not supported — fine */ }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      // Finger moves UP → tray grows. Y decreases as you go up.
      const deltaY = dragStartY - e.clientY;
      const newHeight = dragStartHeight + deltaY;
      const containerH = this.container.getBoundingClientRect().height;
      const min = containerH * BOTTOM_SHEET_SNAPS.collapsed;
      const max = containerH * BOTTOM_SHEET_SNAPS.expanded;
      const clamped = Math.max(min, Math.min(max, newHeight));
      tray.style.setProperty("--tray-height", `${clamped}px`);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      tray.classList.remove(CSS.CLUSTER_TRAY_RESIZING);
      this.unblockNativeGestures();
      if (pointerCaptured) {
        try { header.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        pointerCaptured = false;
      }
      // Snap to the nearer of the two snap points.
      const current = tray.getBoundingClientRect().height;
      const containerH = this.container.getBoundingClientRect().height;
      const snaps = [
        containerH * BOTTOM_SHEET_SNAPS.collapsed,
        containerH * BOTTOM_SHEET_SNAPS.expanded,
      ];
      const nearest = snaps.reduce((best, s) =>
        Math.abs(s - current) < Math.abs(best - current) ? s : best
      );
      tray.style.setProperty("--tray-height", `${nearest}px`);
    };

    header.addEventListener("pointerdown", onPointerDown);
    header.addEventListener("pointermove", onPointerMove);
    header.addEventListener("pointerup", onPointerUp);
    header.addEventListener("pointercancel", onPointerUp);
  }

  private refreshContent(): void {
    if (!this.trayEl) return;
    this.populateInto(this.trayEl);
  }

  private populateInto(tray: HTMLDivElement): void {
    if (!this.currentCluster) return;
    const cluster = this.currentCluster;

    const mark = tray.querySelector<HTMLElement>(`.${CSS.CLUSTER_TRAY_MARK}`);
    const count = tray.querySelector<HTMLElement>(`.${CSS.CLUSTER_TRAY_COUNT}`);
    const list = tray.querySelector<HTMLElement>(`.${CSS.CLUSTER_TRAY_LIST}`);
    if (!mark || !count || !list) return;

    const clusterColor = pickClusterColor(cluster.members.map((m) => m.color));
    mark.style.backgroundColor = clusterColor;
    count.textContent = String(cluster.members.length);

    list.replaceChildren();
    const sorted = sortRowsForDisplay(cluster.members);
    for (const m of sorted) {
      list.appendChild(this.buildRow(m));
    }
  }

  private buildRow(member: ClusterCandidate): HTMLDivElement {
    const row = document.createElement("div");
    row.className = CSS.CLUSTER_TRAY_ROW;
    row.setAttribute("data-file-path", member.datum.filePath);

    const dot = document.createElement("span");
    dot.className = CSS.CLUSTER_TRAY_ROW_DOT;
    dot.style.backgroundColor = member.color;

    const title = document.createElement("span");
    title.className = CSS.CLUSTER_TRAY_ROW_TITLE;
    title.textContent = member.datum.label;

    row.appendChild(dot);
    row.appendChild(title);

    // Touch and mouse take different paths through the same handler:
    //
    //   - Mouse: existing 4px threshold disambiguates tap vs drag.
    //     Native scroll isn't possible (the list scrolls via wheel, which
    //     is independent of the pointer down/move/up sequence).
    //
    //   - Touch: we DON'T take pointer capture immediately. The browser
    //     handles native scroll for the first ~450ms. If the user moves
    //     their finger before the long-press timer fires, we cancel —
    //     they're scrolling. If they release before, it's a tap. If the
    //     timer fires (finger held still), we commit to drag-out: take
    //     capture, add the lifted class (which sets touch-action: none),
    //     and call onRowDragStart.
    let startX = 0, startY = 0;
    let dragFired = false;
    let pointerCaptured = false;
    let longPressTimer: number | null = null;
    const clearLongPress = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };
    const onMove = (e: PointerEvent) => {
      if (dragFired) return;
      // For touch: any movement before the long-press timer fires means
      // the user is starting to scroll. Cancel the timer; the gesture is
      // now a scroll (we don't do anything; browser handles it).
      if (e.pointerType === "touch" && longPressTimer !== null) {
        if (crossedDragThreshold(startX, startY, e.clientX, e.clientY, LONG_PRESS_SLOP_PX)) {
          clearLongPress();
        }
        return;
      }
      if (!crossedDragThreshold(startX, startY, e.clientX, e.clientY, DEFAULT_DRAG_THRESHOLD_PX)) return;
      dragFired = true;
      if (pointerCaptured) {
        try { row.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        pointerCaptured = false;
      }
      this.callbacks.onRowDragStart(member, e);
    };
    const onUp = (e: PointerEvent) => {
      clearLongPress();
      this.unblockNativeGestures();
      row.removeEventListener("pointermove", onMove);
      row.removeEventListener("pointerup", onUp);
      row.removeEventListener("pointercancel", onUp);
      if (pointerCaptured) {
        try { row.releasePointerCapture(e.pointerId); } catch { /* already released */ }
        pointerCaptured = false;
      }
      row.classList.remove(CSS.CLUSTER_TRAY_ROW_LIFTED);
      if (!dragFired) {
        this.callbacks.onRowTap(member.datum.filePath);
      }
    };
    row.addEventListener("pointerdown", (e) => {
      startX = e.clientX;
      startY = e.clientY;
      dragFired = false;
      if (e.pointerType === "touch") {
        // Don't capture yet — let the browser keep the gesture available
        // for native vertical scroll (touch-action: pan-y on the row).
        longPressTimer = window.setTimeout(() => {
          longPressTimer = null;
          dragFired = true;
          // Suppress native scroll for the rest of this touch sequence.
          // touch-action: none on the row alone isn't enough — iOS Safari
          // locks in pan-y at touchstart and ignores mid-gesture changes.
          // preventDefault on touchmove is the only thing that actually
          // stops the browser from starting a scroll.
          this.blockNativeGestures();
          row.classList.add(CSS.CLUSTER_TRAY_ROW_LIFTED);
          this.callbacks.onRowDragStart(member, e);
        }, LONG_PRESS_MS);
      } else {
        // Mouse path — capture immediately and use threshold.
        try {
          row.setPointerCapture(e.pointerId);
          pointerCaptured = true;
        } catch { /* mouse without capture support — fine */ }
      }
      row.addEventListener("pointermove", onMove);
      row.addEventListener("pointerup", onUp);
      row.addEventListener("pointercancel", onUp);
    });

    // Hover tooltip — same as singleton dots. CSS suppresses on coarse-pointer
    // (no hover on touch) so this is a desktop-only affordance.
    row.addEventListener("pointerover", (e) => {
      this.callbacks.onRowHover?.(member, e);
    });
    row.addEventListener("pointerout", () => {
      this.callbacks.onRowHoverEnd?.();
    });

    return row;
  }
}

