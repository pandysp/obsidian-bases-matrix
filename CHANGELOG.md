# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.31]

### Changed (cluster simplification)

- **Dropped the "cluster of 2" small-cluster path entirely.** Every cluster (2 or more members) now renders as the same count-glyph + tap-opens-tray UI, eliminating a parallel rendering path that was producing stacked member labels for clusters of exactly 2 members. Behavior is more uniform across cluster sizes; drag-out of a single member always goes through the tray's ghost-dot flow.
- `LARGE_CLUSTER_MIN` (in cluster-tray) lowered from 3 to 2.

### Removed (dead code)

- `SMALL_CLUSTER_MAX` constant (cluster-renderer)
- `renderSmallCluster` function (cluster-renderer)
- `appendPetalLabel` helper (cluster-renderer; was only called by `renderSmallCluster`)
- `smallClusterToLayoutLabels` + `ClusterMemberInput`/`ClusterInput` types (label-layout-adapter)
- `getClusterContext` callback + the drag-manager code that consumed it (drag-out-from-spider visual state)
- `RenderedPoint.clusterGroup` / `RenderedPoint.petalGroup` fields (point-renderer)
- `CLUSTER_GROUP_SMALL`, `CLUSTER_GROUP_DRAGGING_OUT`, `CLUSTER_PETAL_GROUP`, `CLUSTER_PETAL_GROUP_ACTIVE` CSS class constants
- Corresponding CSS rules: `.matrix-cluster-petal-group--active`, three `.matrix-cluster-petal-group:has(:hover)` rules
- `canExpand` parameter on `wireClusterMarkInteraction` (always true now)

### Tests removed

- `label-layout-adapter.test.ts`: `smallClusterToLayoutLabels` block
- `label-layout.test.ts`: `smallCluster` helper, "small cluster flips as a group" block, two PBT tests that constructed clusters via the helper

### Tests pass

376 tests (down from 382 — 6 small-cluster tests removed; nothing else affected).

## [0.1.30]

### Changed (layout, even tighter)

- **"Importance" closer to the y-axis.** `yLabelX` 12→16, tick text margin `left − 7` → `left − 5`. Gap between the rotated title and tick numbers drops from ~4px to ~2px — the visual minimum before they touch.
- **Less space below "Urgency".** xLabel y moved from `dims.height − 8` to `dims.height − 4`. The text baseline sits 4px above the SVG bottom; the typeface descent (~3px) leaves ~1px clearance. Container's CSS `padding-bottom` still reserves the iOS-home-indicator safe area, so this just compresses the empty visual space below the title. Skipped-notice CSS updated to the same 4px offset so they stay on the same baseline.

## [0.1.29]

### Fixed

- **Skipped-notice aligned with the x-axis title.** The 0.1.27 `padding-bottom` on `.matrix-container` (for the iOS home indicator) pushed the SVG's bottom edge — and the xLabel inside it — `paddingBottom` ABOVE the container's outer bottom, while the absolute-positioned notice was still anchored at `bottom: 8px` relative to that same outer bottom. Result: notice sat `paddingBottom` BELOW the xLabel (~34px on iOS, 8px on desktop). The notice's bottom offset is now `calc(8px + max(8px, env(safe-area-inset-bottom, 0px)))` so it lands at the same baseline as the xLabel in both environments.

### Changed (layout)

- **Left gutter slimmed further: 56→48px.** Y-axis title pulled to `x = 12`; tick labels right-anchored at `left − 7` (was `left − 9`). The gap between the rotated "Importance" text and the y-axis tick numbers drops from ~8px to ~4px. Saves another 8px of horizontal real estate.
- **Skipped-notice abbreviated.** Now reads `1 skipped` (or `N skipped`) instead of `1 note skipped (missing numeric values)`. Full explanation is on the element's `title` attribute as a hover tooltip. Lets the notice sit alongside "Urgency" even on narrow landscape viewports. Font-size dropped to `--font-ui-smaller` so the notice doesn't compete visually with the axis title.

## [0.1.28]

### Changed (layout tightening)

- **Left gutter slimmed from 72px → 56px.** Inside the SVG, the rotated y-axis title was at `x = 22` with tick numbers right-anchored at `x = 63`, leaving ~18px of empty space between the title and the ticks on both portrait and landscape. Now: title at `x = 14`, gutter 56px, gap reduced to ~8px while keeping rotated text and tick numbers from overlapping.
- **Right padding shrunk from 24px → 12px.** Just enough to keep the rightmost dot from clipping the SVG edge.
- **Skipped-notice and x-axis title now sit on the same row.** Notice font-size and font-weight matched to `.matrix-axis-label` so they read as one row of metadata, not two. The notice was already at `bottom: 8px` and the axis title at SVG `y = dims.height - 8` — same vertical position visually, just needed the typography to match.

### Internal

- `computeDims` now uses the container's CONTENT box dimensions (subtracts CSS padding) for the viewBox, not the padding box from `getBoundingClientRect`. Otherwise the `padding-bottom` added in 0.1.27 for the iOS home indicator was producing the same viewBox letterboxing bug we already chased twice (`xMidYMid meet` shrinks the viewBox to fit the rendered area).

## [0.1.27]

### Fixed

- **Landscape mobile: visually overlapping dots now stack cleanly into clusters.** The 0.1.26 switch to pure data-space clustering was too pure — on a squeezed Y axis, data-far points still render on top of each other but their normalized data delta is above the 0.06 threshold, so they refused to cluster. Result: a smudge of overlapping singletons instead of a clean count glyph. Reverted to a UNION of (a) data-space normalized distance and (b) pixel-space distance via the legacy `CLUSTER_PROXIMITY_FACTOR × baseRadius` threshold. Points cluster if EITHER condition fires. Portrait and desktop behavior unchanged (the two tests align); landscape now catches visual overlap that data-space alone missed.
- **Drawer no longer briefly visible after closing a modal on desktop.** Expanded the modal-detection guard in `handleDocumentClick` to include `.modal-bg` (the dimmed backdrop, sometimes a sibling of `.modal-container` rather than a descendant) and `.modal` (the inner panel). Added a `target.isConnected` safety net so clicks whose target has already been detached from the DOM by the time our handler runs are treated as modal interactions, not outside-clicks.
- **Bottom of plot no longer clipped on mobile.** The matrix container now applies `padding-bottom: max(8px, env(safe-area-inset-bottom, 0px))` to reserve room for the iOS home indicator / Obsidian Mobile's bottom nav, with a small 8px floor so desktop also gets a tiny breathing margin. Bottom-padding floor bumped from 28→40 so the x-axis title (e.g. "Urgency") and the skipped-notice div always have room.

### Internal

- `clusterPoints` takes a new `pixelThreshold` parameter (default 0, which disables the pixel-overlap test). Tests cover both the data-only and combined modes, plus the anisotropic-axis case.

## [0.1.26]

### Changed

- **Clustering is now data-space, not pixel-space.** Points cluster when their normalized data delta — `(dx/xRange)² + (dy/yRange)² < ε²` with `ε = 0.06` — is below threshold. Previously the threshold was `baseRadius × CLUSTER_PROXIMITY_FACTOR` in pixels (24–30px), which over-clustered on landscape mobile: the inner plot is short, so the Y axis maps to few pixels per data unit, and data-far points fell within the pixel threshold. Data-space clustering is dimension-independent — same decisions in portrait, landscape, desktop.
- **Vertical padding adapts to plot height.** Top + bottom padding now scale (6% / 12% of height) within clamps (top 8–24, bottom 28–48). On landscape mobile (~190px tall plot) this reclaims ~25px of inner plot height that was being eaten by fixed 24/48 padding. Portrait and desktop see no change (clamped at the original values). Horizontal padding stays fixed — y-axis label + tick numbers need text-driven space, not a width percentage.

### Internal

- `clusterPoints` signature changed: now takes `(candidates, xRange, yRange, epsilon?)` instead of `(candidates, baseRadius)`. The single internal caller (point-renderer) is updated; tests rewritten around the new contract. The legacy `CLUSTER_PROXIMITY_FACTOR` constant is retained — `findSnapTarget` still uses it as a pixel-space UX trigger, independent of the clustering decision.

## [0.1.25]

### Changed

- **Touch-drag finger offset stays at the full 50px in landscape too.** The previous 15%-of-plot-height ratio (intended to prevent the dot from pinning at the top edge on short plots) kicked in too early: landscape mobile plots are ~190px tall, so the offset capped at ~28px — below the threshold needed to clear a finger-tip. Ratio bumped to 40%, so the 50px cap applies on any plot ≥125px tall (i.e., every normal landscape mobile use case). Only extreme split-pane-mobile-with-keyboard scenarios get a smaller offset now.

## [0.1.24]

### Fixed

- **Everything no longer renders smaller on landscape mobile.** `computeDims` had a hardcoded `Math.max(rect.height, 300)` floor on the SVG viewBox. On landscape iPhone the matrix container is typically ~700×260px after Obsidian's chrome — the floor forced viewBox to 700×300, then SVG's default `preserveAspectRatio="xMidYMid meet"` letterboxed the viewBox content to fit the actual rendered 700×260, scaling everything (fonts, axis labels, point circles, cluster marks) down by ~13%. Floor is now `padding.left + padding.right + 1` / `padding.top + padding.bottom + 1`, so the plot area is always at least 1px and otherwise tracks the container exactly.
- **Cluster radius no longer over-aggressive on landscape mobile.** Same root cause: the cluster proximity threshold is in viewBox-space pixels. With the viewBox 13% larger than rendered, every dimension was effectively magnified, which made point pairs that visually looked separated still fall inside the threshold. Removing the viewBox floor restores 1:1 correspondence between rendered pixels and viewBox pixels.

## [0.1.23]

### Changed

- **Touch-drag finger offset bumped 30px → 50px.** The previous offset was the iOS text-selection-handle convention but didn't clearly clear a finger-tip contact ellipse on typical iPhones — the dot sat just at the edge of the finger. 50px lifts it visibly above. Affects both singleton point drag and tray-row drag-out. Landscape orientation keeps the 15%-of-plot-height proportional scaling, so the dot doesn't get pinned at the plot's top edge on short viewports.

## [0.1.22]

### Fixed (cluster tray, mobile)

- **Tray-row drag-out now lifts the dot above the finger.** The singleton point drag has applied this offset on touch since 0.1.0, but the bespoke tray-row drag pipeline (a parallel code path that creates a ghost dot instead of using an existing SVG circle) was reading the cursor position directly. The drop position now also uses the dot's rendered location, not the cursor — the offset is the truth, the finger is just the ghost cursor.
- **Tray header drag down no longer triggers Obsidian's command palette.** The previous 0.1.21 attempt blocked the browser's default action (native scroll) but didn't prevent Obsidian's own document-level gesture handlers from receiving the events. Strengthened the blocker: `stopPropagation()` with `capture: true` so we run in the capture phase and gate the events before they reach any descendant listener; also covers `touchstart` / `touchend` since gesture recognizers can be armed by any of the three.

## [0.1.21]

### Fixed (cluster tray, mobile)

- **Long-press drag-out actually works now.** The root cause of the previous attempts not sticking: iOS Safari evaluates `touch-action` at touchstart time and ignores mid-gesture changes. Setting `touch-action: none` on long-press fire was a no-op — the browser had already committed to pan-y. The fix: install a document-level non-passive `touchmove` listener that calls `preventDefault()` for the duration of the active gesture. This explicitly suppresses native scroll even after the browser has nominally committed to it.
- **Tray header drag down no longer triggers Obsidian's command palette.** Same root cause — Obsidian Mobile's window-level swipe-from-top-edge gesture isn't blocked by element-level `touch-action`. The same `touchmove` blocker now wraps the header resize gesture too.
- **Tray stays open when a detail modal is dismissed.** Previously, the `handleDocumentClick` listener treated clicks inside Obsidian's modal as "outside the tray" and closed the tray. Added an exclusion for clicks inside `.modal-container`.

## [0.1.20]

### Fixed (cluster tray, mobile)

- **Long-press drag-out no longer aborts on finger movement.** Previously, the long-press handler took pointer capture on the row, then handed off to the DragManager. When the DragManager applied `pointer-events: none` to the tray (the standard translucent-during-drag style), iOS Safari invalidated the row's capture mid-gesture → pointercancel fired → drag torn down → tray re-appeared → native scroll engaged. The row no longer captures on long-press; the DragManager establishes its own capture cleanly.

### Changed

- **Expanded snap point now fills 100% of the matrix container** (was 85%). The container is already bounded by Obsidian's chrome (app titlebar + Bases toolbar), so 100% never overlaps the chrome. The grip handle sits at the top of the container — still reachable to drag back down.

## [0.1.19]

### Changed (cluster tray, mobile fixes)

- **Two snap points instead of three.** Removed the middle "default" snap; the tray now has just collapsed (default opening size) and expanded. Drag the header to flip between them.
- **Snap points are container-relative, not viewport-relative.** Previously the expanded snap at 80vh overflowed past the Bases chrome at the top of the view — the header disappeared and the user could no longer reach the grip handle to drag back down. Now: collapsed = 20% of the matrix container's height, expanded = 85%. Always 15% of room above the tray so the chrome stays visible and the grip stays grabbable.
- **Default opening size reduced to 20vh** (was 35%). Slightly larger than the pre-bottom-sheet behavior, but smaller than the previous 3-row default — scroll handles overflow.
- **Safe-area notch padding moved from the tray to the row content.** The landscape side panel now sits flush with the screen edge; only the row inner content gets the extra right padding so text doesn't run into the iPhone notch.

## [0.1.18]

### Changed (cluster tray, mobile-first)

- **Bottom-sheet resize gesture (portrait).** The tray on portrait now behaves like an iOS bottom sheet: drag the header up/down to grow/shrink the tray, release to snap to the nearest of three snap points (12vh collapsed, 35vh default, 80vh expanded). Default height bumped from 22% → 35% so the smallest mobile viewport shows the header + 3 rows out of the box (was 2 rows). A grip indicator at the top of the header signals the affordance.
- **Long-press to drag-out on touch.** Touch gestures now disambiguate three actions: tap (open the note), scroll (vertical drag within the rows — native browser scroll), and drag-out (hold ~450ms, row "lifts", then drag onto the chart to re-position). Desktop behavior unchanged (4px movement threshold = drag).
- **Safe-area aware on landscape.** The side panel respects `env(safe-area-inset-right)` so the tray no longer hides behind iPhone notches in landscape orientation.

## [0.1.17]

### Added

- **`newItemFilenamePattern` view option** — optional pattern for naming files created via Bases' "+New" toolbar button. Supports a single `{N}` token that resolves to the next integer making the basename unique in the target folder (scanned from `newItemFolder`). Useful for folders that use stable identifier conventions like `TODO-N`, `ISSUE-N`, or Zettelkasten timestamps. Unset → Obsidian native default (`Untitled.md`). Example: `newItemFilenamePattern: "TODO-{N}"` on a view whose `newItemFolder` contains `TODO-1.md`, `TODO-2.md` produces `TODO-3.md`. Patterns without `{N}` are returned verbatim (Bases' collision counter applies).

## [0.1.0] — first public release

Initial public release of the **2×2 Matrix for Bases** plugin — a 2D scatter
view for [Obsidian Bases](https://help.obsidian.md/bases) with optional 2×2
quadrant overlay, smart clustering, drag-to-edit, and full mobile support.

### Added

#### Core view
- 2D scatter view (`type: matrix`) registered as a Bases view
- Configurable X/Y numeric properties, axis labels, axis ranges
- Optional color encoding (`colorBy`) — deterministic palette from a stable hash of the category name; same category always gets the same color across renders and filtered subsets
- Optional size encoding (`sizeBy`) — data-relative normalization against the dataset's actual min/max
- 4-sided plot frame with theme-token tick marks at "nice" intervals (auto-derived for any axis range)
- Quadrant overlay with configurable corner labels (clockwise from top-right)

#### Interaction
- **Drag points or labels** to update both axis values in frontmatter at once. Commit precision derived from axis range (0–1 keeps 2 decimals, 0–10 keeps 1, 0–100 keeps 0)
- **Click a point** to open an inline detail modal — the full Obsidian editor (properties panel + body) embedded
- **Click axis or quadrant labels** to inline-edit; persists to the `.base` file
- **Cmd/Ctrl-click** a point → open in a new tab (escape hatch around the modal)
- **Hover-synced** dot + label highlighting via `:has(:hover)`

#### Smart clustering
- Multiple notes at the same coordinates fuse into one cluster glyph with a count badge
- N ≤ 4: cluster glyph + all member labels stacked next to it
- N ≥ 5: cluster glyph alone at rest; tap to fan out into a regular N-gon spider with each member's dot and label radially arranged
- **Drag whole cluster** by grabbing the cluster mark — all members move together with snap-to-coordinates on release
- **Drag out of cluster** to break a single member from the group
- **Tap cluster mark to toggle** spider expand/collapse; outside-tap also collapses
- Expanded-state persists across re-renders (member-set memoization)

#### Bases-native integration
- **Toolbar Search** filters points by the configured `titleProperty`; the plugin auto-injects the title property into the view's `order` list so Bases' built-in search has something meaningful to match against
- **Toolbar +New** creates a note pre-populated with x/y axis values at the chart midpoint, so the new note lands on-chart immediately
- **Properties panel** controls which property chips appear in the per-point tooltip; same chip vocabulary as base-board cards (relative dates via `DateValue.relative()`, link aliases, list joining)

#### Layout algorithm
- Pure label-layout module with side-flipping (collision OR overflow), vertical fallback, and cluster-vs-cluster collision resolution
- Score-based flip decisions (overflow weighted heavier than element collision) so when both sides are bad, vertical fallback resolves it
- Snap-to-coordinates on drag: when dropped within cluster-proximity of another point, the dragged point gets that point's exact x/y so clusters form consistently across viewports

#### Mobile support
- Verified on iPhone Safari / Obsidian Mobile
- `touch-action: none` on SVG + permanent touch handlers to claim every touch from the first event (prevents Obsidian's sidebar-swipe gesture from interfering)
- Finger-offset drag: the dragged dot renders ~30px above the finger so it stays visible; adaptive shrink in landscape orientation
- Coarse-pointer radius floor (`TOUCH_MIN_RADIUS = 10`) keeps small dots tappable without making big ones cartoonishly large
- Narrower spider geometry on coarse-pointer so the expanded N-gon fits inside narrow viewports
- Click-suppress window (400ms on touch, 50ms on desktop) prevents the post-drag synthetic click from opening the modal
- Tooltip suppressed on coarse-pointer (no hover state on touch); inline detail modal is the touch-equivalent for property inspection

#### Theming
- Theme-token-driven defaults — looks clean in any Obsidian theme
- Stable CSS hooks for user snippets: `.matrix-point`, `.matrix-cluster-*`, `.matrix-tooltip[data-property-id="..."]`, etc.
- Tooltip chip vocabulary intentionally matches base-board's, so a single user snippet can style both views identically
- Example snippet (`examples/eisenhower/linear.css`) demonstrates Linear-flavored skinning

#### Project / infrastructure
- Vitest + Hegel (property-based testing) suite covering layout algorithm, geometry helpers, clustering, value extraction, and session-tracked regression cases — 130+ tests across 8 files
- Tag-triggered GitHub Actions release workflow (`.github/workflows/release.yml`) that builds, tests, and drafts a Release with artifacts attached
- `version-bump.mjs` to sync version across `manifest.json` and `versions.json` after `npm version`
- BRAT-compatible repository layout for pre-release distribution
- Self-contained example folder (`examples/eisenhower/`) with `.base` file, 14 sample notes, and optional Linear CSS snippet

[Unreleased]: https://github.com/pandysp/obsidian-bases-matrix/compare/0.1.0...HEAD
[0.1.0]: https://github.com/pandysp/obsidian-bases-matrix/releases/tag/0.1.0
