import {
  App,
  ButtonComponent,
  MarkdownView,
  Modal,
  TFile,
  WorkspaceLeaf,
} from "obsidian";

/**
 * Inline detail modal opened when a point (dot or label) is clicked.
 *
 * Pattern borrowed from mderazon/obsidian-base-board: instead of building a
 * custom frontmatter form, embed Obsidian's own markdown view (frontmatter
 * properties UI + body editor) inside the modal via an *orphaned* workspace
 * leaf. The leaf is created with `new WorkspaceLeaf(app)` (Obsidian's
 * private constructor, but it's stable across versions), opened on the file,
 * then its container element is re-parented into our modal body.
 *
 * Result: the user gets the full Obsidian editor — including the properties
 * panel for editing the matrix's x/y values — without us re-implementing it.
 * Position changes propagate back through Bases.onDataUpdated automatically.
 */
export class MatrixDetailModal extends Modal {
  private file: TFile;
  private leaf: WorkspaceLeaf | null = null;

  constructor(app: App, file: TFile) {
    super(app);
    this.file = file;
  }

  async onOpen(): Promise<void> {
    const { contentEl } = this;
    this.modalEl.addClass("matrix-card-modal");
    // The embedded leaf carries the file's own title, so drop the modal's own header.
    this.titleEl.empty();

    // Quick-action row: escape hatches into the standard workspace.
    const actionsEl = contentEl.createDiv({ cls: "matrix-card-modal-actions" });

    // Icon-only action buttons with tooltips — base-board's modal uses the
    // same pattern. Text appears on hover so the bar stays compact and
    // matches the matrix's chip vocabulary visually.
    new ButtonComponent(actionsEl)
      .setIcon("lucide-columns")
      .setTooltip("Open in split pane")
      .onClick(() => {
        this.close();
        void this.app.workspace.getLeaf("split").openFile(this.file);
      });

    new ButtonComponent(actionsEl)
      .setIcon("lucide-external-link")
      .setTooltip("Open in new tab")
      .onClick(() => {
        this.close();
        void this.app.workspace.getLeaf("tab").openFile(this.file);
      });

    contentEl.createEl("hr", { cls: "matrix-card-modal-separator" });

    const bodyEl = contentEl.createDiv({ cls: "matrix-card-modal-body" });

    // The `WorkspaceLeaf` constructor isn't part of the public Obsidian typings.
    // Cast to access it. This produces a leaf untracked by the workspace —
    // exactly what we want, so closing the modal doesn't leave a phantom tab.
    const LeafClass = WorkspaceLeaf as unknown as new (app: App) => WorkspaceLeaf;
    this.leaf = new LeafClass(this.app);
    await this.leaf.openFile(this.file, { active: false });

    bodyEl.appendChild(this.leaf.view.containerEl);
    this.leaf.view.containerEl.addClass("matrix-card-modal-leaf-container");

    if (this.leaf.view instanceof MarkdownView) {
      const firstH1 = this.app.metadataCache
        .getFileCache(this.file)
        ?.headings?.find((heading) => heading.level === 1);
      if (firstH1) {
        this.leaf.view.editor.setCursor({
          line: firstH1.position.start.line,
          ch: firstH1.position.start.col,
        });
      }
      this.leaf.view.editor.focus();
    }
  }

  onClose(): void {
    this.leaf?.detach();
    this.leaf = null;
    this.contentEl.empty();
  }
}
