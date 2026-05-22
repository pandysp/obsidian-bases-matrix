import { CSS } from "./constants";
import { computeTooltipPosition } from "./tooltip-position";

/** Structured data for a tooltip render. */
export interface TooltipData {
  title: string;
  /** File basename for the hovered point (e.g. "TODO-105"). Surfaced as
   *  `data-file-name` on the tooltip root so theme snippets can render it
   *  as a subtitle via CSS ::before { content: attr(data-file-name); }. */
  fileName?: string;
  /** Axis name + formatted value pairs, e.g. [["Urgency", "8"], ["Importance", "5.9"]]. */
  axisValues: Array<[label: string, value: string]>;
  /** Optional color-by category name and the resolved CSS color string. */
  category?: { label: string; color: string } | null;
  /** Extra property chips from the view's `order` list — user-selected props
   *  that aren't already represented by axis/color/title. Each chip carries
   *  its property ID so theme snippets can target specific properties via
   *  `[data-property-id="..."]` (matches base-board's data-attribute idiom). */
  extraChips?: Array<{ propId: string; label: string; value: string }>;
}

/**
 * Floating tooltip positioned near the cursor on point hover.
 * One instance per view, reused across all points.
 *
 * Visual layout:
 *   - Title          (white, medium weight)
 *   - Axis values    (inline, muted, mid-dot separator)
 *   - Category chip  (color dot + label, optional)
 */
export class Tooltip {
  private el: HTMLDivElement;
  private titleEl: HTMLDivElement;
  private chipsEl: HTMLDivElement;

  constructor(container: HTMLElement) {
    this.el = container.createDiv({ cls: CSS.TOOLTIP });
    this.titleEl = this.el.createDiv({ cls: CSS.TOOLTIP_TITLE });
    this.chipsEl = this.el.createDiv({ cls: CSS.TOOLTIP_CHIPS });
    this.hide();
  }

  show(data: TooltipData, clientX: number, clientY: number, scope: HTMLElement): void {
    if (data.fileName) {
      this.el.setAttribute("data-file-name", data.fileName);
    } else {
      this.el.removeAttribute("data-file-name");
    }
    this.titleEl.textContent = data.title;

    // Metadata renders as a row of chips, matching base-board's card-chip
    // vocabulary: small pill with opacity-0.6 label and full-opacity value.
    // The category chip (if present) gets a colored dot prefix instead of a
    // tinted backdrop — keeps text contrast theme-safe regardless of hue.
    this.chipsEl.empty();
    for (const [label, value] of data.axisValues) {
      const chip = this.chipsEl.createSpan({ cls: CSS.TOOLTIP_CHIP });
      chip.createSpan({ cls: CSS.TOOLTIP_CHIP_LABEL, text: label });
      chip.createSpan({ cls: CSS.TOOLTIP_CHIP_VALUE, text: value });
    }
    if (data.category) {
      const chip = this.chipsEl.createSpan({
        cls: `${CSS.TOOLTIP_CHIP} ${CSS.TOOLTIP_CHIP_CATEGORY}`,
      });
      const dot = chip.createSpan({ cls: CSS.TOOLTIP_CHIP_DOT });
      dot.style.backgroundColor = data.category.color;
      chip.createSpan({ cls: CSS.TOOLTIP_CHIP_VALUE, text: data.category.label });
    }
    if (data.extraChips) {
      for (const { propId, label, value } of data.extraChips) {
        const chip = this.chipsEl.createSpan({
          cls: CSS.TOOLTIP_CHIP,
          attr: { "data-property-id": propId },
        });
        chip.createSpan({ cls: CSS.TOOLTIP_CHIP_LABEL, text: label });
        chip.createSpan({ cls: CSS.TOOLTIP_CHIP_VALUE, text: value });
      }
    }

    // Initial placement: down-right of cursor, before measurement.
    // Final placement (with flip + edge-clamp) lives in computeTooltipPosition
    // and runs after rAF when tip dimensions are available.
    const scopeRect = scope.getBoundingClientRect();
    const OFFSET = 14;
    const cursor = { x: clientX - scopeRect.left, y: clientY - scopeRect.top };
    this.el.style.left = `${cursor.x + OFFSET}px`;
    this.el.style.top = `${cursor.y + OFFSET}px`;
    this.el.style.display = "block";

    requestAnimationFrame(() => {
      const tipRect = this.el.getBoundingClientRect();
      const { left, top } = computeTooltipPosition({
        cursor,
        scope: { width: scopeRect.width, height: scopeRect.height },
        tip: { width: tipRect.width, height: tipRect.height },
        offset: OFFSET,
        edgePadding: 4,
      });
      this.el.style.left = `${left}px`;
      this.el.style.top = `${top}px`;
    });
  }

  hide(): void {
    this.el.style.display = "none";
  }

  destroy(): void {
    this.el.remove();
  }
}
