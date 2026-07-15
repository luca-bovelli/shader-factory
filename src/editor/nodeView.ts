import { getNodeDefinition } from "../graph/registry";
import type { GradientStop, GraphNode, NodeParamValue, ParamDefinition, PortType } from "../graph/types";
import { GraphStore } from "../graph/store";

interface NodeViewCallbacks {
  onHeaderPointerDown: (event: PointerEvent, nodeId: string) => void;
  onSocketPointerDown: (event: PointerEvent, nodeId: string, portId: string, direction: "input" | "output") => void;
}

export class NodeView {
  readonly root = document.createElement("article");
  readonly #inputs = new Map<string, HTMLElement>();
  readonly #outputs = new Map<string, HTMLElement>();
  readonly #paramControls = new Map<string, HTMLElement>();

  constructor(
    readonly node: GraphNode,
    private readonly store: GraphStore,
    callbacks: NodeViewCallbacks,
  ) {
    const definition = getNodeDefinition(node.type);
    this.root.className = `graph-node domain-${definition.domain}`;
    this.root.dataset.nodeId = node.id;
    this.root.style.width = `${definition.width ?? 200}px`;

    const header = document.createElement("header");
    header.className = "node-header";
    header.innerHTML = `<div><span class="node-domain-label">${domainLabel(definition.domain)}</span><strong></strong></div><button type="button" class="node-menu" aria-label="Delete node" title="Delete node">×</button>`;
    const title = header.querySelector("strong");
    if (title) title.textContent = definition.title;
    header.title = definition.description;
    header.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).closest("button")) return;
      callbacks.onHeaderPointerDown(event, node.id);
    });
    header.querySelector(".node-menu")?.addEventListener("click", (event) => {
      event.stopPropagation();
      store.removeNode(node.id);
    });
    this.root.append(header);

    if (definition.inputs.length) {
      const ports = document.createElement("div");
      ports.className = "node-ports node-ports--inputs";
      for (const input of definition.inputs) {
        const row = document.createElement("div");
        row.className = "port-row port-row--input";
        const socket = createSocket(node.id, input.id, "input", input.accepts[0]!);
        socket.title = `Accepts ${input.accepts.join(" or ")}`;
        socket.addEventListener("pointerdown", (event) => callbacks.onSocketPointerDown(event, node.id, input.id, "input"));
        socket.addEventListener("dblclick", () => store.disconnectInput(node.id, input.id));
        const label = document.createElement("span");
        label.textContent = input.label;
        row.append(socket, label);
        ports.append(row);
        this.#inputs.set(input.id, socket);
      }
      this.root.append(ports);
    }

    if (definition.params.length) {
      const params = document.createElement("div");
      params.className = "node-params";
      definition.params.forEach((param) => {
        const control = this.createParamControl(param);
        params.append(control);
        this.#paramControls.set(param.id, control);
      });
      this.root.append(params);
    }

    if (definition.outputs.length) {
      const ports = document.createElement("div");
      ports.className = "node-ports node-ports--outputs";
      for (const output of definition.outputs) {
        const row = document.createElement("div");
        row.className = "port-row port-row--output";
        const label = document.createElement("span");
        label.textContent = output.label;
        const socket = createSocket(node.id, output.id, "output", output.type);
        socket.title = output.type;
        socket.addEventListener("pointerdown", (event) => callbacks.onSocketPointerDown(event, node.id, output.id, "output"));
        row.append(label, socket);
        ports.append(row);
        this.#outputs.set(output.id, socket);
      }
      this.root.append(ports);
    }

    this.root.addEventListener("pointerdown", (event) => {
      if (!(event.target as Element).closest(".node-socket")) store.select({ kind: "node", id: node.id });
      event.stopPropagation();
    });
    this.updatePosition();
    this.syncConnections();
  }

  updatePosition(): void {
    this.root.style.transform = `translate3d(${this.node.x}px, ${this.node.y}px, 0)`;
  }

  setSelected(selected: boolean): void {
    this.root.classList.toggle("is-selected", selected);
  }

  syncConnections(): void {
    const definition = getNodeDefinition(this.node.type);
    for (const input of definition.inputs) {
      const connected = Boolean(this.store.getInputEdge(this.node.id, input.id));
      this.#inputs.get(input.id)?.classList.toggle("is-connected", connected);
      if (input.fallbackParam) this.#paramControls.get(input.fallbackParam)?.classList.toggle("is-overridden", connected);
    }
    for (const output of definition.outputs) {
      const connected = this.store.snapshot.edges.some((edge) => edge.fromNode === this.node.id && edge.fromPort === output.id);
      this.#outputs.get(output.id)?.classList.toggle("is-connected", connected);
    }
  }

  socket(portId: string, direction: "input" | "output"): HTMLElement | undefined {
    return direction === "input" ? this.#inputs.get(portId) : this.#outputs.get(portId);
  }

  private createParamControl(definition: ParamDefinition): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = `node-param node-param--${definition.kind}`;
    wrapper.dataset.paramId = definition.id;
    const label = document.createElement("span");
    label.className = "param-label";
    label.textContent = definition.label;

    if (definition.kind === "boolean") {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = this.node.params[definition.id] === true;
      const track = document.createElement("i");
      wrapper.classList.add("switch-control");
      wrapper.append(label, input, track);
      input.addEventListener("input", () => this.store.setParam(this.node.id, definition.id, input.checked));
      return wrapper;
    }

    if (definition.kind === "select") {
      const select = document.createElement("select");
      definition.options.forEach((option) => select.add(new Option(option.label, option.value)));
      select.value = String(this.node.params[definition.id]);
      wrapper.append(label, select);
      select.addEventListener("change", () => this.store.setParam(this.node.id, definition.id, select.value));
      return wrapper;
    }

    if (definition.kind === "color") {
      const input = document.createElement("input");
      input.type = "color";
      input.value = String(this.node.params[definition.id]);
      wrapper.append(label, input);
      input.addEventListener("input", () => this.store.setParam(this.node.id, definition.id, input.value));
      return wrapper;
    }

    if (definition.kind === "gradient") {
      wrapper.classList.add("gradient-control");
      const editor = document.createElement("div");
      wrapper.append(label, editor);
      this.renderGradient(editor, definition.id);
      return wrapper;
    }

    const fields = document.createElement("div");
    fields.className = "number-control";
    const range = document.createElement("input");
    range.type = "range";
    range.min = String(definition.min);
    range.max = String(definition.max);
    range.step = String(definition.step);
    range.value = String(this.node.params[definition.id]);
    const number = document.createElement("input");
    number.type = "number";
    number.min = range.min;
    number.max = range.max;
    number.step = range.step;
    number.value = range.value;
    const update = (raw: string, source: HTMLInputElement): void => {
      const parsed = Number.parseFloat(raw);
      if (!Number.isFinite(parsed)) return;
      const value = Math.min(definition.max, Math.max(definition.min, parsed));
      range.value = String(value);
      number.value = source === number ? raw : value.toFixed(definition.precision ?? 2);
      this.store.setParam(this.node.id, definition.id, value);
    };
    range.addEventListener("input", () => update(range.value, range));
    number.addEventListener("change", () => update(number.value, number));
    fields.append(range, number);
    wrapper.append(label, fields);
    return wrapper;
  }

  private renderGradient(container: HTMLElement, paramId: string): void {
    const stops = this.node.params[paramId] as GradientStop[];
    container.replaceChildren();
    const preview = document.createElement("div");
    preview.className = "node-gradient-preview";
    preview.style.background = gradientCss(stops);
    container.append(preview);
    const rows = document.createElement("div");
    rows.className = "node-gradient-stops";
    stops.forEach((stop, index) => {
      const row = document.createElement("div");
      const color = document.createElement("input");
      color.type = "color";
      color.value = stop.color;
      const position = document.createElement("input");
      position.type = "number";
      position.min = "0";
      position.max = "1";
      position.step = "0.01";
      position.value = String(stop.position);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.disabled = stops.length <= 1;
      color.addEventListener("input", () => {
        const next = cloneGradient(stops);
        next[index]!.color = color.value;
        this.store.setParam(this.node.id, paramId, next);
        preview.style.background = gradientCss(next);
      });
      position.addEventListener("change", () => {
        const next = cloneGradient(stops);
        next[index]!.position = Math.min(1, Math.max(0, Number.parseFloat(position.value) || 0));
        this.store.setParam(this.node.id, paramId, next);
        this.renderGradient(container, paramId);
      });
      remove.addEventListener("click", () => {
        if (stops.length <= 1) return;
        const next = cloneGradient(stops);
        next.splice(index, 1);
        this.store.setParam(this.node.id, paramId, next);
        this.renderGradient(container, paramId);
      });
      row.append(color, position, remove);
      rows.append(row);
    });
    container.append(rows);
    const add = document.createElement("button");
    add.type = "button";
    add.className = "add-gradient-stop";
    add.textContent = "+ Add stop";
    add.disabled = stops.length >= 16;
    add.addEventListener("click", () => {
      const next = cloneGradient(stops);
      next.push({ color: "#ffffff", position: 0.5 });
      this.store.setParam(this.node.id, paramId, next);
      this.renderGradient(container, paramId);
    });
    container.append(add);
  }
}

function createSocket(nodeId: string, portId: string, direction: "input" | "output", type: PortType): HTMLButtonElement {
  const socket = document.createElement("button");
  socket.type = "button";
  socket.className = `node-socket socket-${type}`;
  socket.dataset.nodeId = nodeId;
  socket.dataset.portId = portId;
  socket.dataset.direction = direction;
  socket.dataset.portType = type;
  socket.setAttribute("aria-label", `${direction} ${portId}`);
  return socket;
}

function domainLabel(domain: string): string {
  return domain === "field3d" ? "3D Field" : domain === "bridge" ? "3D → 2D" : domain === "screen2d" ? "2D Screen" : domain === "output" ? "Output" : "Value";
}

function cloneGradient(stops: GradientStop[]): GradientStop[] { return stops.map((stop) => ({ ...stop })); }
function gradientCss(stops: GradientStop[]): string {
  const sorted = [...stops].sort((a,b) => a.position - b.position);
  if (sorted.length === 1) return sorted[0]!.color;
  return `linear-gradient(90deg, ${sorted.map((stop) => `${stop.color} ${stop.position * 100}%`).join(",")})`;
}
