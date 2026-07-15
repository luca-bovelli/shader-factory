export type NodeDomain = "value" | "field3d" | "bridge" | "screen2d" | "output";

export type PortType =
  | "float"
  | "coordinate3d"
  | "field3d"
  | "surface2d"
  | "coordinate2d"
  | "scalar2d"
  | "color2d";

export interface GradientStop {
  color: string;
  position: number;
}

export type NodeParamValue = string | number | boolean | GradientStop[];

export interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  params: Record<string, NodeParamValue>;
}

export interface GraphEdge {
  id: string;
  fromNode: string;
  fromPort: string;
  toNode: string;
  toPort: string;
}

export interface GraphDocument {
  version: 1;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface InputDefinition {
  id: string;
  label: string;
  accepts: PortType[];
  fallbackParam?: string;
}

export interface OutputDefinition {
  id: string;
  label: string;
  type: PortType;
}

export type ParamDefinition =
  | {
      id: string;
      label: string;
      kind: "number";
      default: number;
      min: number;
      max: number;
      step: number;
      precision?: number;
    }
  | {
      id: string;
      label: string;
      kind: "boolean";
      default: boolean;
    }
  | {
      id: string;
      label: string;
      kind: "select";
      default: string;
      options: Array<{ value: string; label: string }>;
    }
  | {
      id: string;
      label: string;
      kind: "color";
      default: string;
    }
  | {
      id: string;
      label: string;
      kind: "gradient";
      default: GradientStop[];
    };

export interface NodeDefinition {
  type: string;
  title: string;
  description: string;
  category: string;
  domain: NodeDomain;
  inputs: InputDefinition[];
  outputs: OutputDefinition[];
  params: ParamDefinition[];
  width?: number;
}

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "edge"; id: string }
  | null;

export type GraphChange =
  | { type: "structure" }
  | { type: "position"; nodeId: string }
  | { type: "param"; nodeId: string; paramId: string; compileRequired: boolean }
  | { type: "selection" }
  | { type: "replace" };

export interface ConnectionResult {
  ok: boolean;
  message?: string;
}
