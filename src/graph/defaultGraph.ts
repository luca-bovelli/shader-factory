import { createDefaultParams } from "./registry";
import type { GraphDocument, GraphEdge, GraphNode, NodeParamValue } from "./types";

const node = (id: string, type: string, x: number, y: number, params: Record<string, NodeParamValue> = {}): GraphNode => ({
  id,
  type,
  x,
  y,
  params: { ...createDefaultParams(type), ...params },
});

let edgeCounter = 0;
const edge = (fromNode: string, fromPort: string, toNode: string, toPort: string): GraphEdge => ({
  id: `default-edge-${edgeCounter++}`,
  fromNode,
  fromPort,
  toNode,
  toPort,
});

export function createDefaultGraph(): GraphDocument {
  edgeCounter = 0;
  return {
    version: 1,
    nodes: [
      node("coordinates", "coordinate3d", 40, 280),
      node("time", "time", 40, 40),
      node("slice-speed", "mathFloat", 280, 40, { operation: "multiply", b: 0.2 }),
      node("base-mapping", "mapping3d", 280, 250),
      node("noise-scale", "value", 300, 650, { value: 2 }),
      node("noise-mapping", "mapping3d", 570, 210),
      node("noise", "simplex3d", 850, 190, { seed: 0 }),
      node("pinch", "pinchEnvelope", 590, 530, { mode: "none", exponent: 1 }),
      node("noise-pinch", "fieldMath", 1090, 250, { operation: "multiply" }),
      node("depth-pinch", "depthRamp", 840, 500, { enabled: true, slope: 10 }),
      node("depth-multiply", "fieldMath", 1340, 280, { operation: "multiply" }),
      node("y-axis", "axis3d", 580, 820, { axis: "y" }),
      node("y-scale", "fieldMath", 850, 800, { operation: "multiply" }),
      node("slope", "value", 850, 1020, { value: 4 }),
      node("y-gradient", "fieldMath", 1110, 800, { operation: "multiply" }),
      node("field", "fieldMath", 1600, 440, { operation: "add" }),
      node("projection", "projection", 1880, 390, { epsilon: 0.005, positiveFalloff: 0.2, negativeFalloff: 0.2, verticalOrigin: 1 }),
      node("shrink", "morphology", 2190, 390, { shrink: 1 }),
      node("surface-info", "surfaceInfo", 2460, 180),
      node("positive-ramp", "colorRamp", 2760, 100, { gradient: [{ color: "#222222", position: 0 }, { color: "#00ccff", position: 1 }] }),
      node("negative-ramp", "colorRamp", 2760, 460, { gradient: [{ color: "#222222", position: 0 }, { color: "#e61a99", position: 1 }] }),
      node("colorize", "surfaceColorize", 3070, 300, { positiveEnabled: false, negativeEnabled: true, opacity: 1 }),
      node("output", "output", 3370, 320, { background: "#f5f5f7", blurRadius: 4 }),
    ],
    edges: [
      edge("time", "value", "slice-speed", "a"),
      edge("coordinates", "position", "base-mapping", "coordinate"),
      edge("base-mapping", "coordinate", "noise-mapping", "coordinate"),
      edge("noise-scale", "value", "noise-mapping", "scaleX"),
      edge("noise-scale", "value", "noise-mapping", "scaleY"),
      edge("noise-mapping", "coordinate", "noise", "coordinate"),
      edge("base-mapping", "coordinate", "pinch", "coordinate"),
      edge("noise", "value", "noise-pinch", "a"),
      edge("pinch", "value", "noise-pinch", "b"),
      edge("base-mapping", "coordinate", "depth-pinch", "coordinate"),
      edge("slice-speed", "value", "depth-pinch", "slice"),
      edge("noise-pinch", "value", "depth-multiply", "a"),
      edge("depth-pinch", "value", "depth-multiply", "b"),
      edge("base-mapping", "coordinate", "y-axis", "coordinate"),
      edge("y-axis", "value", "y-scale", "a"),
      edge("noise-scale", "value", "y-scale", "b"),
      edge("y-scale", "value", "y-gradient", "a"),
      edge("slope", "value", "y-gradient", "b"),
      edge("depth-multiply", "value", "field", "a"),
      edge("y-gradient", "value", "field", "b"),
      edge("field", "value", "projection", "field"),
      edge("slice-speed", "value", "projection", "slice"),
      edge("projection", "surface", "shrink", "surface"),
      edge("shrink", "surface", "surface-info", "surface"),
      edge("surface-info", "positiveT", "positive-ramp", "value"),
      edge("surface-info", "negativeT", "negative-ramp", "value"),
      edge("shrink", "surface", "colorize", "surface"),
      edge("positive-ramp", "color", "colorize", "positiveColor"),
      edge("negative-ramp", "color", "colorize", "negativeColor"),
      edge("colorize", "color", "output", "color"),
    ],
  };
}
