/**
 * Adapter between point-renderer's SVG-world render state and the pure
 * label-layout module. Converts measured label data into the LayoutLabel
 * shape that layoutLabels() consumes.
 */
import {
  layoutLabels,
  type LayoutLabel,
  type LayoutResult,
  type PlotBounds,
} from "./label-layout";

export interface SingletonInput {
  filePath: string;
  cx: number;
  cy: number;
  radius: number;
  labelWidth: number;
  labelHeight: number;
  initialAnchorY: number;
}

export function singletonToLayoutLabel(s: SingletonInput): LayoutLabel {
  return {
    filePath: s.filePath,
    groupId: s.filePath,
    cx: s.cx,
    cy: s.cy,
    width: s.labelWidth,
    height: s.labelHeight,
    offsetX: s.radius + 8,
    initialAnchorY: s.initialAnchorY,
    flippable: true,
  };
}

export interface RunLayoutInput {
  singletons: SingletonInput[];
  /** Retained as an empty array on the input shape for backwards
   *  compatibility — clusters render as a single count-glyph and don't
   *  contribute member labels to the layout pass anymore. */
  clusters: never[];
  plotBounds: PlotBounds;
}

/**
 * Orchestrator: takes render-time data, converts to LayoutLabel[], runs the
 * pure layout algorithm, returns placements keyed by file path.
 */
export function runLayout(input: RunLayoutInput): LayoutResult {
  const labels: LayoutLabel[] = input.singletons.map(singletonToLayoutLabel);
  return layoutLabels(labels, input.plotBounds);
}
