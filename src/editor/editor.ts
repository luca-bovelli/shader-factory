import { GraphStore } from "../graph/store";
import type { GraphEdge, Selection } from "../graph/types";
import { NodeView } from "./nodeView";

interface EditorElements {
  viewport: HTMLElement;
  world: HTMLElement;
  nodeLayer: HTMLElement;
  connectionLayer: SVGSVGElement;
  zoomReadout: HTMLElement;
  onMessage: (message: string, error?: boolean) => void;
}

interface Point { x: number; y: number }

export class GraphEditor {
  readonly #views = new Map<string, NodeView>();
  #pan = { x: 40, y: 40 };
  #zoom = 0.75;
  #paletteOpener: ((clientX: number, clientY: number, graphX: number, graphY: number) => void) | null = null;
  #temporaryPath: SVGPathElement | null = null;

  constructor(private readonly store: GraphStore, private readonly elements: EditorElements) {
    this.rebuild();
    this.applyCamera();
    store.subscribe((_graph, change, selection) => {
      if (change.type === "structure" || change.type === "replace") this.rebuild();
      else if (change.type === "position") {
        this.#views.get(change.nodeId)?.updatePosition();
        this.renderConnections();
      }
      if (change.type === "selection" || change.type === "structure" || change.type === "replace") this.syncSelection(selection);
    });
    elements.viewport.addEventListener("pointerdown", this.handleViewportPointerDown);
    elements.viewport.addEventListener("wheel", this.handleWheel, { passive: false });
    elements.viewport.addEventListener("contextmenu", this.handleContextMenu);
    window.addEventListener("keydown", this.handleKeyDown);
    new ResizeObserver(() => this.renderConnections()).observe(elements.viewport);
  }

  setPaletteOpener(opener: (clientX: number, clientY: number, graphX: number, graphY: number) => void): void {
    this.#paletteOpener = opener;
  }

  viewportCenterInGraph(): Point {
    const rect = this.elements.viewport.getBoundingClientRect();
    return this.clientToGraph(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  clientToGraph(clientX: number, clientY: number): Point {
    const rect = this.elements.viewport.getBoundingClientRect();
    return { x: (clientX - rect.left - this.#pan.x) / this.#zoom, y: (clientY - rect.top - this.#pan.y) / this.#zoom };
  }

  frameAll(animate: boolean): void {
    const nodes = this.store.snapshot.nodes;
    if (!nodes.length) return;
    const bounds = nodes.reduce((result, node) => {
      const view = this.#views.get(node.id);
      const width = view?.root.offsetWidth ?? 220;
      const height = view?.root.offsetHeight ?? 220;
      return {
        minX: Math.min(result.minX, node.x), minY: Math.min(result.minY, node.y),
        maxX: Math.max(result.maxX, node.x + width), maxY: Math.max(result.maxY, node.y + height),
      };
    }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    const rect = this.elements.viewport.getBoundingClientRect();
    const padding = 70;
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    this.#zoom = Math.min(1, Math.max(0.2, Math.min((rect.width - padding * 2) / width, (rect.height - padding * 2) / height)));
    this.#pan.x = (rect.width - width * this.#zoom) / 2 - bounds.minX * this.#zoom;
    this.#pan.y = (rect.height - height * this.#zoom) / 2 - bounds.minY * this.#zoom;
    this.elements.world.classList.toggle("animate-camera", animate);
    this.applyCamera();
    if (animate) window.setTimeout(() => this.elements.world.classList.remove("animate-camera"), 260);
  }

  private rebuild(): void {
    const active = new Set(this.store.snapshot.nodes.map((node) => node.id));
    for (const [id, view] of this.#views) {
      const currentNode = this.store.getNode(id);
      if (!active.has(id) || currentNode !== view.node) {
        view.root.remove();
        this.#views.delete(id);
      }
    }
    for (const node of this.store.snapshot.nodes) {
      let view = this.#views.get(node.id);
      if (!view) {
        view = new NodeView(node, this.store, {
          onHeaderPointerDown: this.startNodeDrag,
          onSocketPointerDown: this.startConnection,
        });
        this.#views.set(node.id, view);
        this.elements.nodeLayer.append(view.root);
      }
      view.syncConnections();
      view.updatePosition();
    }
    requestAnimationFrame(() => this.renderConnections());
  }

  private renderConnections(): void {
    this.elements.connectionLayer.replaceChildren();
    for (const edge of this.store.snapshot.edges) {
      const pathData = this.edgePath(edge);
      if (!pathData) continue;
      const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
      group.classList.toggle("is-selected", this.store.selection?.kind === "edge" && this.store.selection.id === edge.id);
      group.dataset.edgeId = edge.id;
      const type = this.store.getOutputType(edge.fromNode, edge.fromPort);
      const visible = document.createElementNS("http://www.w3.org/2000/svg", "path");
      visible.setAttribute("d", pathData);
      visible.setAttribute("class", `connection connection-${type ?? "float"}`);
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("d", pathData);
      hit.setAttribute("class", "connection-hit");
      hit.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        this.store.select({ kind: "edge", id: edge.id });
      });
      group.append(visible, hit);
      this.elements.connectionLayer.append(group);
    }
    if (this.#temporaryPath) this.elements.connectionLayer.append(this.#temporaryPath);
  }

  private edgePath(edge: GraphEdge): string | null {
    const source = this.#views.get(edge.fromNode)?.socket(edge.fromPort, "output");
    const target = this.#views.get(edge.toNode)?.socket(edge.toPort, "input");
    if (!source || !target) return null;
    return curve(this.socketPoint(source), this.socketPoint(target));
  }

  private socketPoint(socket: HTMLElement): Point {
    const socketRect = socket.getBoundingClientRect();
    const worldRect = this.elements.world.getBoundingClientRect();
    return {
      x: (socketRect.left + socketRect.width / 2 - worldRect.left) / this.#zoom,
      y: (socketRect.top + socketRect.height / 2 - worldRect.top) / this.#zoom,
    };
  }

  private syncSelection(selection: Selection): void {
    for (const [id, view] of this.#views) view.setSelected(selection?.kind === "node" && selection.id === id);
    this.elements.connectionLayer.querySelectorAll<SVGGElement>("g[data-edge-id]").forEach((group) => {
      group.classList.toggle("is-selected", selection?.kind === "edge" && selection.id === group.dataset.edgeId);
    });
  }

  private readonly startNodeDrag = (event: PointerEvent, nodeId: string): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const node = this.store.getNode(nodeId);
    if (!node) return;
    this.store.select({ kind: "node", id: nodeId });
    const start = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    const move = (next: PointerEvent): void => {
      this.store.moveNode(nodeId, start.nodeX + (next.clientX - start.x) / this.#zoom, start.nodeY + (next.clientY - start.y) / this.#zoom);
    };
    const end = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  private readonly startConnection = (event: PointerEvent, nodeId: string, portId: string, direction: "input" | "output"): void => {
    event.preventDefault();
    event.stopPropagation();
    if (direction === "input") {
      const existing = this.store.getInputEdge(nodeId, portId);
      if (existing) this.store.select({ kind: "edge", id: existing.id });
      return;
    }
    const socket = this.#views.get(nodeId)?.socket(portId, "output");
    if (!socket) return;
    const start = this.socketPoint(socket);
    this.#temporaryPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const type = this.store.getOutputType(nodeId, portId);
    this.#temporaryPath.setAttribute("class", `connection connection-${type ?? "float"} is-temporary`);
    const move = (next: PointerEvent): void => {
      const point = this.clientToGraph(next.clientX, next.clientY);
      this.#temporaryPath?.setAttribute("d", curve(start, point));
      this.renderConnections();
    };
    const end = (next: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      const target = document.elementFromPoint(next.clientX, next.clientY)?.closest<HTMLElement>('.node-socket[data-direction="input"]');
      this.#temporaryPath = null;
      if (target?.dataset.nodeId && target.dataset.portId) {
        const result = this.store.connect(nodeId, portId, target.dataset.nodeId, target.dataset.portId);
        if (!result.ok) this.elements.onMessage(result.message ?? "Unable to connect sockets", true);
      }
      this.renderConnections();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  private readonly handleViewportPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 && event.button !== 1) return;
    if ((event.target as Element).closest(".graph-node, .connection-hit")) return;
    event.preventDefault();
    this.store.select(null);
    const start = { x: event.clientX, y: event.clientY, panX: this.#pan.x, panY: this.#pan.y };
    const move = (next: PointerEvent): void => {
      this.#pan.x = start.panX + next.clientX - start.x;
      this.#pan.y = start.panY + next.clientY - start.y;
      this.applyCamera();
    };
    const end = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
  };

  private readonly handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const before = this.clientToGraph(event.clientX, event.clientY);
    this.#zoom = Math.min(1.6, Math.max(0.2, this.#zoom * Math.exp(-event.deltaY * 0.001)));
    const rect = this.elements.viewport.getBoundingClientRect();
    this.#pan.x = event.clientX - rect.left - before.x * this.#zoom;
    this.#pan.y = event.clientY - rect.top - before.y * this.#zoom;
    this.applyCamera();
  };

  private readonly handleContextMenu = (event: MouseEvent): void => {
    if ((event.target as Element).closest(".graph-node")) return;
    event.preventDefault();
    const graphPoint = this.clientToGraph(event.clientX, event.clientY);
    this.#paletteOpener?.(event.clientX, event.clientY, graphPoint.x, graphPoint.y);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    if (target.matches("input, textarea, select")) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      this.store.removeSelection();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      event.preventDefault();
      this.frameAll(true);
    }
  };

  private applyCamera(): void {
    this.elements.world.style.transform = `translate3d(${this.#pan.x}px, ${this.#pan.y}px, 0) scale(${this.#zoom})`;
    this.elements.zoomReadout.textContent = `${Math.round(this.#zoom * 100)}%`;
    this.renderConnections();
  }
}

function curve(from: Point, to: Point): string {
  const distance = Math.abs(to.x - from.x);
  const handle = Math.max(70, distance * 0.48);
  return `M ${from.x} ${from.y} C ${from.x + handle} ${from.y}, ${to.x - handle} ${to.y}, ${to.x} ${to.y}`;
}
