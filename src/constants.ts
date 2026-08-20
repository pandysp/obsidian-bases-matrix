export const VIEW_TYPE = "matrix";

export const CONFIG_KEYS = {
  X_AXIS: "xAxis",
  Y_AXIS: "yAxis",
  COLOR_BY: "colorBy",
  COLOR_SCALE: "colorScale",
  COLOR_DIRECTION: "colorDirection",
  SIZE_BY: "sizeBy",
  X_MIN: "xMin",
  X_MAX: "xMax",
  Y_MIN: "yMin",
  Y_MAX: "yMax",
  X_LABEL: "xLabel",
  Y_LABEL: "yLabel",
  SHOW_QUADRANTS: "showQuadrants",
  QUADRANT_LABEL_Q1: "quadrantLabelQ1",
  QUADRANT_LABEL_Q2: "quadrantLabelQ2",
  QUADRANT_LABEL_Q3: "quadrantLabelQ3",
  QUADRANT_LABEL_Q4: "quadrantLabelQ4",
  SHOW_RINGS: "showRings",
  RING_LABEL_1: "ring1Label",
  RING_LABEL_2: "ring2Label",
  RING_LABEL_3: "ring3Label",
  RING_LABEL_4: "ring4Label",
  CENTER_AXES: "centerAxes",
  SHOW_FRAME: "showFrame",
  SHOW_AXES: "showAxes",
  SQUARE_PLOT: "squarePlot",
  POINT_RADIUS: "pointRadius",
  SHOW_LABELS: "showLabels",
  LABEL_MAX_LENGTH: "labelMaxLength",
  NEW_ITEM_FILENAME_PATTERN: "newItemFilenamePattern",
} as const;

export const DEFAULTS = {
  X_MIN: 0,
  X_MAX: 10,
  Y_MIN: 0,
  Y_MAX: 10,
  X_LABEL: "X-axis",
  Y_LABEL: "Y-axis",
  SHOW_QUADRANTS: true,
  // Generic 2×2 matrix — defaults are positional placeholders, expected
  // to be renamed per use case (Eisenhower, RICE, 2×2 prioritization).
  // Clockwise from top-right.
  QUADRANT_Q1: "Quadrant A",  // top-right
  QUADRANT_Q2: "Quadrant B",  // top-left
  QUADRANT_Q3: "Quadrant C",  // bottom-left
  QUADRANT_Q4: "Quadrant D",  // bottom-right
  SHOW_RINGS: false,
  // Concentric rings — innermost first. Tech-radar canon: Adopt → Trial →
  // Assess → Hold. Empty string suppresses the label for that ring.
  RING_1: "",
  RING_2: "",
  RING_3: "",
  RING_4: "",
  // Axes through the plot midpoint (math-plot style) instead of along the
  // frame edges. When true: tick marks render along the center cross,
  // edge ticks suppressed. Pairs naturally with quadrants (which already
  // draw lines through the center) and/or rings (radar/polar style).
  CENTER_AXES: false,
  // Rectangular frame around the plot area. Defaults true for traditional
  // 2D charts; set false for math-plot or tech-radar styles where the
  // axes/rings carry the bounding visually.
  SHOW_FRAME: true,
  // Master toggle for the axis chrome: center cross / quadrant divider
  // lines, tick marks, and tick number labels. Default on. Set false for
  // pure-radar layouts where rings + quadrant corner labels carry the
  // structure and the numerical scale would just be noise.
  SHOW_AXES: true,
  // Force a square aspect ratio for the SVG plot. Useful when rings need
  // to render as true circles (rather than ellipses on a stretched plot).
  // Off by default; the plot fills its container.
  SQUARE_PLOT: false,
  POINT_RADIUS: 8,
  // Color assignment mode for the colorBy axis:
  //   null → auto-detect: all-numeric / all-ISO-date → gradient (red-
  //          yellow-green default); else categorical (hash-based discrete).
  //   "categorical" → force discrete colors even on numeric data (use for
  //                   ratings 1-5, status codes, numbered quadrants).
  //   "red-yellow-green" | "viridis" | "red-white-blue" → force gradient
  //                   with that palette. Numeric / dates / letter grades all
  //                   parse in explicit mode.
  COLOR_SCALE: null as null | "categorical" | "red-yellow-green" | "viridis" | "red-white-blue",
  // For diverging gradient palettes (red-yellow-green, red-white-blue):
  // which end of the value range maps to the "good" / "neutral" pole.
  // Default high-is-good fits scores, ratings, revenue, grades. Flip to
  // "low-is-good" for times, error counts, costs.
  COLOR_DIRECTION: "high-is-good" as "low-is-good" | "high-is-good",
  SHOW_LABELS: true,
  LABEL_MAX_LENGTH: 32,
};

export const CSS = {
  ROOT: "matrix-view",
  CONTAINER: "matrix-container",
  SVG: "matrix-svg",
  AXES: "matrix-axes",
  AXIS_LINE: "matrix-axis-line",
  AXIS_LABEL: "matrix-axis-label",
  GRID_LINE: "matrix-grid-line",
  TICK: "matrix-tick",
  TICK_LABEL: "matrix-tick-label",
  QUADRANT_DIVIDER: "matrix-quadrant-divider",
  QUADRANT_LABEL: "matrix-quadrant-label",
  RING: "matrix-ring",
  RING_LABEL: "matrix-ring-label",
  POINTS: "matrix-points",
  POINT_GROUP: "matrix-point-group",
  POINT_GROUP_ENTERING: "matrix-point-group--entering",
  POINT: "matrix-point",
  POINT_DRAGGING: "matrix-point--dragging",
  POINT_HOVERED: "matrix-point--hovered",
  POINT_LABEL: "matrix-point-label",
  POINT_LABEL_BG: "matrix-point-label-bg",
  POINT_LABEL_DRAGGING: "matrix-point-label--dragging",
  // Overlap clustering: wraps multiple data points whose pixel positions
  // overlap into a single visual mark with a count. Tap opens the cluster
  // tray (HTML overlay listing members); drag-out happens via a ghost dot
  // created on demand from the tray.
  CLUSTER_GROUP: "matrix-cluster-group",
  CLUSTER_GROUP_LARGE: "matrix-cluster-group--large",
  CLUSTER_GROUP_EXPANDED: "matrix-cluster-group--expanded",
  CLUSTER_GROUP_DRAGGING: "matrix-cluster-group--dragging",
  // Cluster tray: HTML overlay opened on tap of a cluster.
  CLUSTER_TRAY: "matrix-cluster-tray",

  CLUSTER_TRAY_OPEN: "matrix-cluster-tray--open",
  CLUSTER_TRAY_DRAGGING: "matrix-cluster-tray--dragging",
  /** Active resize gesture (portrait bottom-sheet). Disables the height
   *  transition so the sheet tracks the finger 1:1 instead of easing. */
  CLUSTER_TRAY_RESIZING: "matrix-cluster-tray--resizing",
  CLUSTER_TRAY_HEADER: "matrix-cluster-tray-header",
  CLUSTER_TRAY_MARK: "matrix-cluster-tray-mark",
  CLUSTER_TRAY_COUNT: "matrix-cluster-tray-count",
  CLUSTER_TRAY_CLOSE: "matrix-cluster-tray-close",
  CLUSTER_TRAY_LIST: "matrix-cluster-tray-list",
  CLUSTER_TRAY_ROW: "matrix-cluster-tray-row",
  CLUSTER_TRAY_ROW_DOT: "matrix-cluster-tray-row-dot",
  CLUSTER_TRAY_ROW_TITLE: "matrix-cluster-tray-row-title",
  /** Touch long-press has fired and the row is now in drag-out mode.
   *  Adds visual lift + sets touch-action: none so subsequent finger
   *  movement is interpreted as drag, not native scroll. */
  CLUSTER_TRAY_ROW_LIFTED: "matrix-cluster-tray-row--lifted",
  /** Separator embedded in the cluster-group's data-members attribute. \n
   *  picked because file paths cannot contain it; lets us roundtrip a path
   *  set as a single string attribute. */
  CLUSTER_MEMBERS_SEPARATOR: "\n",
  CLUSTER_MARK: "matrix-cluster-mark",
  CLUSTER_COUNT: "matrix-cluster-count",
  TOOLTIP: "matrix-tooltip",
  TOOLTIP_TITLE: "matrix-tooltip-title",
  TOOLTIP_CHIPS: "matrix-tooltip-chips",
  TOOLTIP_CHIP: "matrix-tooltip-chip",
  TOOLTIP_CHIP_LABEL: "matrix-tooltip-chip-label",
  TOOLTIP_CHIP_VALUE: "matrix-tooltip-chip-value",
  TOOLTIP_CHIP_DOT: "matrix-tooltip-chip-dot",
  TOOLTIP_CHIP_CATEGORY: "matrix-tooltip-chip--category",
  SKIPPED: "matrix-skipped-warning",
} as const;

export const SVG_NS = "http://www.w3.org/2000/svg";
