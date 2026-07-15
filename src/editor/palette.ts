import { NODE_DEFINITIONS } from "../graph/registry";
import { GraphStore } from "../graph/store";
import { GraphEditor } from "./editor";

interface PaletteElements {
  root: HTMLElement;
  list: HTMLElement;
  search: HTMLInputElement;
  close: HTMLButtonElement;
  onMessage: (message: string, error?: boolean) => void;
}

export class NodePalette {
  #graphPosition = { x: 0, y: 0 };

  constructor(private readonly store: GraphStore, private readonly editor: GraphEditor, private readonly elements: PaletteElements) {
    this.render();
    elements.search.addEventListener("input", () => this.render(elements.search.value));
    elements.close.addEventListener("click", () => this.close());
    window.addEventListener("pointerdown", (event) => {
      if (!elements.root.hidden && !elements.root.contains(event.target as Node) && !(event.target as Element).closest("#add-node")) this.close();
    });
    window.addEventListener("keydown", (event) => { if (event.key === "Escape") this.close(); });
    void editor;
  }

  open(clientX: number, clientY: number, graphX: number, graphY: number): void {
    this.#graphPosition = { x: graphX, y: graphY };
    const width = 300;
    const height = 500;
    this.elements.root.style.left = `${Math.min(window.innerWidth - width - 10, Math.max(10, clientX))}px`;
    this.elements.root.style.top = `${Math.min(window.innerHeight - height - 10, Math.max(58, clientY))}px`;
    this.elements.root.hidden = false;
    this.elements.search.value = "";
    this.render();
    requestAnimationFrame(() => this.elements.search.focus());
  }

  close(): void { this.elements.root.hidden = true; }

  private render(query = ""): void {
    this.elements.list.replaceChildren();
    const normalized = query.trim().toLowerCase();
    const definitions = NODE_DEFINITIONS.filter((definition) => !normalized || `${definition.title} ${definition.description} ${definition.category}`.toLowerCase().includes(normalized));
    const categories = [...new Set(definitions.map((definition) => definition.category))];
    for (const category of categories) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = category;
      section.append(heading);
      definitions.filter((definition) => definition.category === category).forEach((definition) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `palette-node domain-${definition.domain}`;
        const outputExists = definition.type === "output" && this.store.snapshot.nodes.some((node) => node.type === "output");
        button.disabled = outputExists;
        button.innerHTML = `<i></i><span><strong></strong><small></small></span>`;
        button.querySelector("strong")!.textContent = definition.title;
        button.querySelector("small")!.textContent = outputExists ? "Delete the existing output first" : definition.description;
        button.addEventListener("click", () => {
          if (outputExists) return;
          this.store.addNode(definition.type, this.#graphPosition.x, this.#graphPosition.y);
          this.close();
          this.elements.onMessage(`${definition.title} added`);
        });
        section.append(button);
      });
      this.elements.list.append(section);
    }
    if (!definitions.length) {
      const empty = document.createElement("p");
      empty.className = "palette-empty";
      empty.textContent = "No matching nodes";
      this.elements.list.append(empty);
    }
  }
}
