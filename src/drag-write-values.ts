/**
 * Pure helper that decides what value a drag commit should write to
 * frontmatter for each axis. Behavior depends on the axis's value type:
 *
 *   - "numeric":      write a number. `exact` bypasses rounding for snap-to-
 *                     point (avoid 7.34 → 7.3 drift when matching a target).
 *                     Otherwise round to the range's nice decimal precision.
 *
 *   - "time" / "date": write a STRING formatted in the user's native
 *                      grammar ("5:30", "2025-06-15") so the frontmatter
 *                      keeps their original format. Dragging is always
 *                      "exact" for these — formatValue handles rounding
 *                      to the canonical unit (whole seconds, whole ms).
 *
 *   - "string":       defensive fallback: pass the number through. Should
 *                     never trigger in practice — axis values are detected
 *                     as one of the first three.
 */
import { roundForRange } from "./geometry";
import { formatValue, type ValueType } from "./value-type";

export interface DragWriteValuesInput {
  xValue: number;
  yValue: number;
  xRange: number;
  yRange: number;
  xType: ValueType;
  yType: ValueType;
  exact: boolean;
}

export function computeDragWriteValues(input: DragWriteValuesInput): {
  x: number | string; y: number | string;
} {
  const { xValue, yValue, xRange, yRange, xType, yType, exact } = input;
  return {
    x: writeOne(xValue, xRange, xType, exact),
    y: writeOne(yValue, yRange, yType, exact),
  };
}

function writeOne(value: number, range: number, type: ValueType, exact: boolean): number | string {
  if (type === "time" || type === "date") {
    // Formatted string preserves the user's native grammar. formatValue
    // rounds to whole canonical units (whole seconds / whole ms day).
    return formatValue(value, type);
  }
  // Numeric (default + "string" fallback): keep the existing exact/round
  // behavior so the 2x2-matrix case is unchanged.
  return exact ? value : roundForRange(value, range);
}
