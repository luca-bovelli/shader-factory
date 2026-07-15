import { createDefaultParams, getNodeDefinition, isCompileTimeParam } from "./registry";
import type { ConnectionResult, GraphChange, GraphDocument, GraphEdge, GraphNode, NodeParamValue, PortType, Selection } from "./types";

type Listener = (graph: GraphDocument, change: GraphChange, selection: Selection) => void;
let idCounter = 0;

const makeId = (prefix: string): string => globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now()}-${idCounter++}`;

export class GraphStore {
  readonly #listeners = new Set<Listener>();
  #selection: Selection = null;

  constructor(private graph: GraphDocument) {}

  get snapshot(): GraphDocument { return this.graph; }
  get selection(): Selection { return this.#selection; }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  getNode(id: string): GraphNode | undefined {
    return this.graph.nodes.find((node) => node.id === id);
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.graph.edges.find((edge) => edge.id === id);
  }

  addNode(type: string, x: number, y: number): GraphNode {
    getNodeDefinition(type);
    const newNode: GraphNode = { id: makeId("node"), type, x, y, params: createDefaultParams(type) };
    this.graph.nodes.push(newNode);
    this.#selection = { kind: "node", id: newNode.id };
    this.emit({ type: "structure" });
    return newNode;
  }

  removeSelection(): void {
    if (!this.#selection) return;
    if (this.#selection.kind === "node") this.removeNode(this.#selection.id);
    else this.removeEdge(this.#selection.id);
  }

  removeNode(id: string): void {
    const index = this.graph.nodes.findIndex((node) => node.id === id);
    if (index < 0) return;
    this.graph.nodes.splice(index, 1);
    this.graph.edges = this.graph.edges.filter((edge) => edge.fromNode !== id && edge.toNode !== id);
    if (this.#selection?.id === id) this.#selection = null;
    this.emit({ type: "structure" });
  }

  removeEdge(id: string): void {
    const index = this.graph.edges.findIndex((edge) => edge.id === id);
    if (index < 0) return;
    this.graph.edges.splice(index, 1);
    if (this.#selection?.id === id) this.#selection = null;
    this.emit({ type: "structure" });
  }

  moveNode(id: string, x: number, y: number): void {
    const node = this.getNode(id);
    if (!node) return;
    node.x = x;
    node.y = y;
    this.emit({ type: "position", nodeId: id });
  }

  setParam(nodeId: string, paramId: string, value: NodeParamValue): void {
    const node = this.getNode(nodeId);
    if (!node) return;
    node.params[paramId] = value;
    this.emit({ type: "param", nodeId, paramId, compileRequired: isCompileTimeParam(node.type, paramId) });
  }

  select(selection: Selection): void {
    if (selection?.kind === this.#selection?.kind && selection?.id === this.#selection?.id) return;
    this.#selection = selection;
    this.emit({ type: "selection" });
  }

  connect(fromNode: string, fromPort: string, toNode: string, toPort: string): ConnectionResult {
    if (fromNode === toNode) return { ok: false, message: "A node cannot connect to itself" };
    const source = this.getNode(fromNode);
    const target = this.getNode(toNode);
    if (!source || !target) return { ok: false, message: "One of the nodes no longer exists" };
    const sourceDefinition = getNodeDefinition(source.type);
    const targetDefinition = getNodeDefinition(target.type);
    const output = sourceDefinition.outputs.find((port) => port.id === fromPort);
    const input = targetDefinition.inputs.find((port) => port.id === toPort);
    if (!output || !input) return { ok: false, message: "The selected socket does not exist" };
    if (!input.accepts.includes(output.type)) return { ok: false, message: `${output.type} cannot connect to ${input.accepts.join(" or ")}` };
    if (this.wouldCreateCycle(fromNode, toNode)) return { ok: false, message: "That connection would create a cycle" };

    this.graph.edges = this.graph.edges.filter((edge) => !(edge.toNode === toNode && edge.toPort === toPort));
    const newEdge: GraphEdge = { id: makeId("edge"), fromNode, fromPort, toNode, toPort };
    this.graph.edges.push(newEdge);
    this.#selection = { kind: "edge", id: newEdge.id };
    this.emit({ type: "structure" });
    return { ok: true };
  }

  disconnectInput(nodeId: string, portId: string): void {
    const edge = this.graph.edges.find((candidate) => candidate.toNode === nodeId && candidate.toPort === portId);
    if (edge) this.removeEdge(edge.id);
  }

  replace(graph: GraphDocument): void {
    this.graph = graph;
    this.#selection = null;
    this.emit({ type: "replace" });
  }

  getInputEdge(nodeId: string, portId: string): GraphEdge | undefined {
    return this.graph.edges.find((edge) => edge.toNode === nodeId && edge.toPort === portId);
  }

  getOutputType(nodeId: string, portId: string): PortType | undefined {
    const node = this.getNode(nodeId);
    return node && getNodeDefinition(node.type).outputs.find((port) => port.id === portId)?.type;
  }

  private wouldCreateCycle(sourceId: string, targetId: string): boolean {
    const visited = new Set<string>();
    const visit = (nodeId: string): boolean => {
      if (nodeId === sourceId) return true;
      if (visited.has(nodeId)) return false;
      visited.add(nodeId);
      return this.graph.edges.filter((edge) => edge.fromNode === nodeId).some((edge) => visit(edge.toNode));
    };
    return visit(targetId);
  }

  private emit(change: GraphChange): void {
    this.#listeners.forEach((listener) => listener(this.graph, change, this.#selection));
  }
}
