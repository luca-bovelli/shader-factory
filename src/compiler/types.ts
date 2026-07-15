import type { GraphDocument, GradientStop } from "../graph/types";

export interface UniformBinding {
  name: string;
  nodeId: string;
  paramId: string;
  kind: "number" | "boolean" | "color";
}

export interface GradientBinding {
  name: string;
  nodeId: string;
  paramId: string;
  stops: GradientStop[];
}

export interface CompiledGraph {
  fragmentSource: string;
  uniforms: UniformBinding[];
  gradients: GradientBinding[];
  outputNodeId: string;
  graph: GraphDocument;
}
