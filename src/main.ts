import { Plugin, type QueryController } from "obsidian";
import { VIEW_TYPE } from "./constants";
import { MatrixView } from "./matrix-view";

export default class BasesMatrixPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerBasesView(VIEW_TYPE, {
      name: "Matrix",
      icon: "lucide-layout-grid",
      factory: (controller: QueryController, containerEl: HTMLElement) =>
        new MatrixView(controller, containerEl),
      options: (config) => MatrixView.getViewOptions(config),
    });
  }

  onunload(): void {
    // Bases unregisters the view automatically.
  }
}
