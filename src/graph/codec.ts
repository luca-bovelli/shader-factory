import { getNodeDefinition } from "./registry";
import type { GradientStop, GraphDocument, GraphEdge, GraphNode, NodeParamValue } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;

export function serializeGraph(graph: GraphDocument): string {
  return JSON.stringify(graph, null, 2);
}

export function parseGraph(text: string): GraphDocument {
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error("The graph is not valid JSON"); }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("The graph root must be an object");
  const source = raw as Record<string, unknown>;
  if (source.version !== 1) throw new Error("Only node graph version 1 is supported");
  if (!Array.isArray(source.nodes) || !Array.isArray(source.edges)) throw new Error("The graph must contain nodes and edges arrays");
  if (source.nodes.length > 256 || source.edges.length > 1024) throw new Error("The graph is too large");

  const ids = new Set<string>();
  const nodes = source.nodes.map((entry, index) => parseNode(entry, index, ids));
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const edges = source.edges.map((entry, index) => parseEdge(entry, index, nodeMap));
  const graph: GraphDocument = { version: 1, nodes, edges };
  const errors = validateGraph(graph);
  if (errors.length) throw new Error(errors[0]);
  return graph;
}

export function validateGraph(graph: GraphDocument): string[] {
  const errors: string[] = [];
  const nodeMap = new Map(graph.nodes.map((node) => [node.id, node]));
  const occupiedInputs = new Set<string>();
  for (const edge of graph.edges) {
    const source = nodeMap.get(edge.fromNode);
    const target = nodeMap.get(edge.toNode);
    if (!source || !target) { errors.push(`Connection ${edge.id} references a missing node`); continue; }
    const output = getNodeDefinition(source.type).outputs.find((port) => port.id === edge.fromPort);
    const input = getNodeDefinition(target.type).inputs.find((port) => port.id === edge.toPort);
    if (!output || !input) { errors.push(`Connection ${edge.id} references a missing socket`); continue; }
    if (!input.accepts.includes(output.type)) errors.push(`${output.type} cannot connect to ${target.type}.${edge.toPort}`);
    const inputKey = `${edge.toNode}:${edge.toPort}`;
    if (occupiedInputs.has(inputKey)) errors.push(`${target.type}.${edge.toPort} has more than one connection`);
    occupiedInputs.add(inputKey);
  }
  const outputCount = graph.nodes.filter((node) => node.type === "output").length;
  if (outputCount !== 1) errors.push("The graph must contain exactly one Screen Output node");
  if (hasCycle(graph)) errors.push("The graph contains a cycle");
  return errors;
}

function parseNode(raw: unknown, index: number, ids: Set<string>): GraphNode {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`nodes[${index}] must be an object`);
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== "string" || !source.id || ids.has(source.id)) throw new Error(`nodes[${index}].id must be unique`);
  if (typeof source.type !== "string") throw new Error(`nodes[${index}].type is invalid`);
  const definition = getNodeDefinition(source.type);
  const x = finite(source.x, `nodes[${index}].x`, -100000, 100000);
  const y = finite(source.y, `nodes[${index}].y`, -100000, 100000);
  if (!source.params || typeof source.params !== "object" || Array.isArray(source.params)) throw new Error(`nodes[${index}].params must be an object`);
  const rawParams = source.params as Record<string, unknown>;
  const params: Record<string, NodeParamValue> = {};
  for (const param of definition.params) {
    const value = rawParams[param.id] ?? param.default;
    if (param.kind === "number") params[param.id] = finite(value, `${source.id}.${param.id}`, param.min, param.max);
    else if (param.kind === "boolean") {
      if (typeof value !== "boolean") throw new Error(`${source.id}.${param.id} must be a boolean`);
      params[param.id] = value;
    } else if (param.kind === "select") {
      if (typeof value !== "string" || !param.options.some((option) => option.value === value)) throw new Error(`${source.id}.${param.id} is invalid`);
      params[param.id] = value;
    } else if (param.kind === "color") params[param.id] = parseColor(value, `${source.id}.${param.id}`);
    else params[param.id] = parseGradient(value, `${source.id}.${param.id}`);
  }
  ids.add(source.id);
  return { id: source.id, type: source.type, x, y, params };
}

function parseEdge(raw: unknown, index: number, nodes: Map<string, GraphNode>): GraphEdge {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`edges[${index}] must be an object`);
  const source = raw as Record<string, unknown>;
  for (const field of ["id", "fromNode", "fromPort", "toNode", "toPort"] as const) {
    if (typeof source[field] !== "string" || !source[field]) throw new Error(`edges[${index}].${field} is invalid`);
  }
  if (!nodes.has(source.fromNode as string) || !nodes.has(source.toNode as string)) throw new Error(`edges[${index}] references a missing node`);
  return source as unknown as GraphEdge;
}

function finite(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${path} must be a finite number`);
  return Math.min(max, Math.max(min, value));
}

function parseColor(value: unknown, path: string): string {
  if (typeof value !== "string" || !HEX.test(value)) throw new Error(`${path} must be a six-digit hex color`);
  return value.toLowerCase();
}

function parseGradient(value: unknown, path: string): GradientStop[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16) throw new Error(`${path} must contain 1–16 stops`);
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`${path}[${index}] is invalid`);
    const stop = raw as Record<string, unknown>;
    return { color: parseColor(stop.color, `${path}[${index}].color`), position: finite(stop.position, `${path}[${index}].position`, 0, 1) };
  });
}

function hasCycle(graph: GraphDocument): boolean {
  const adjacency = new Map<string, string[]>();
  graph.nodes.forEach((node) => adjacency.set(node.id, []));
  graph.edges.forEach((edge) => adjacency.get(edge.fromNode)?.push(edge.toNode));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    if (adjacency.get(id)?.some(visit)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return graph.nodes.some((node) => visit(node.id));
}
