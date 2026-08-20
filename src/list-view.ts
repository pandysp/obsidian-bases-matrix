import { BasesView, Notice, TFile, type QueryController } from "obsidian";
import { asBasesConfig, asBasesData } from "./bases-internals";
import { visibleControls, type ControlKey } from "./list-controls";

export const LIST_VIEW_TYPE = "h1-list";

/**
 * A deliberately narrow Bases list layout.
 *
 * Each row is the note's first H1 as a link, followed by inline controls for
 * a fixed allowlist of frontmatter properties: `planned` (date), `done`
 * (checkbox), `area` (text). Which of those controls appear — and in what
 * order — is taken from the view's `order` config; anything outside the
 * allowlist is ignored.
 *
 * Everything else stays with Bases: filters, sorting, and limits are already
 * applied to `data.data` before we see it. This is not a generic table — no
 * arbitrary columns, grouping, summaries, or formulas.
 */
export class ListView extends BasesView {
  type = LIST_VIEW_TYPE;

  private root: HTMLElement;

  constructor(controller: QueryController, containerEl: HTMLElement) {
    super(controller);
    this.root = containerEl.createDiv({ cls: "h1-list" });
  }

  onDataUpdated(): void {
    // Don't re-render out from under an actively-edited control — the blur
    // that commits the edit triggers a data update, which re-renders then.
    if (this.root.contains(document.activeElement)) return;
    this.render();
  }

  private render(): void {
    this.root.empty();
    const entries = asBasesData(this.data)?.data ?? [];
    const controls = visibleControls(asBasesConfig(this.config).getOrder?.() ?? []);

    for (const entry of entries) {
      const filePath = (entry as { file?: { path?: string } }).file?.path;
      if (!filePath) continue;
      const file = this.app.vault.getAbstractFileByPath(filePath);
      if (!(file instanceof TFile)) continue;

      const rowEl = this.root.createDiv({ cls: "h1-list-row" });
      this.renderTitle(rowEl, file);
      for (const key of controls) this.renderControl(rowEl, file, key);
    }


    if (entries.length === 0) {
      this.root.createDiv({
        cls: "h1-list-empty",
        text: "No notes match the current filters.",
      });
    }
  }


  private renderTitle(rowEl: HTMLElement, file: TFile): void {
    const firstH1 = this.app.metadataCache
      .getFileCache(file)
      ?.headings?.find((h) => h.level === 1);
    const titleEl = rowEl.createDiv({
      cls: firstH1 ? "h1-list-title" : "h1-list-title h1-list-title--missing",
      text: firstH1?.heading ?? `Missing H1 — ${file.basename}`,
    });
    titleEl.addEventListener("click", () => {
      void this.app.workspace.getLeaf(false).openFile(file);
    });
  }

  private renderControl(
    rowEl: HTMLElement,
    file: TFile,
    key: ControlKey,
  ): void {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const wrap = rowEl.createDiv({ cls: `h1-list-control h1-list-${key}` });

    if (key === "done") {
      const input = wrap.createEl("input", { type: "checkbox" });
      input.checked = fm.done === true;
      input.addEventListener("change", () => {
        void this.write(file, input, "done", (front) => {
          front.done = input.checked;
        });
      });
      return;
    }

    if (key === "planned") {
      const input = wrap.createEl("input", { type: "date" });
      if (typeof fm.planned === "string") input.value = fm.planned;
      input.addEventListener("change", () => {
        const value = input.value;
        void this.write(file, input, "planned", (front) => {
          if (value) front.planned = value;
          else delete front.planned;
        });
      });
      return;
    }

    const input = wrap.createEl("input", {
      type: "text",
      placeholder: "area",
    });
    if (typeof fm.area === "string") input.value = fm.area;
    input.addEventListener("change", () => {
      const value = input.value.trim();
      void this.write(file, input, "area", (front) => {
        if (value) front.area = value;
        else delete front.area;
      });
    });
  }

  /**
   * Commit one control edit through processFrontMatter. On failure the
   * control snaps back to the on-disk value and the error is surfaced in a
   * Notice — a control must never show an unsaved value as saved.
   */
  private async write(
    file: TFile,
    input: HTMLInputElement,
    key: ControlKey,
    apply: (front: Record<string, unknown>) => void,
  ): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, apply);
    } catch (err) {
      new Notice(`Failed to save ${file.basename}: ${String(err)}`);
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      if (key === "done") input.checked = fm.done === true;
      else input.value = typeof fm[key] === "string" ? (fm[key] as string) : "";
      console.error(`[h1-list] write failed for ${file.path}`, err);
    }
  }
}
