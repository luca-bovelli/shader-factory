import type { GradientStop, NodeDefinition, NodeParamValue } from "./types";

const NUMBER = (id: string, label: string, value: number, min: number, max: number, step: number, precision = 2) => ({
  id, label, kind: "number" as const, default: value, min, max, step, precision,
});

const BOOLEAN = (id: string, label: string, value: boolean) => ({
  id, label, kind: "boolean" as const, default: value,
});

const SELECT = (id: string, label: string, value: string, options: Array<{ value: string; label: string }>) => ({
  id, label, kind: "select" as const, default: value, options,
});

const COLOR = (id: string, label: string, value: string) => ({
  id, label, kind: "color" as const, default: value,
});

const GRADIENT = (id: string, label: string, value: GradientStop[]) => ({
  id, label, kind: "gradient" as const, default: value,
});

const MATH_OPTIONS = [
  { value: "add", label: "Add" },
  { value: "subtract", label: "Subtract" },
  { value: "multiply", label: "Multiply" },
  { value: "divide", label: "Divide" },
  { value: "power", label: "Power" },
  { value: "minimum", label: "Minimum" },
  { value: "maximum", label: "Maximum" },
  { value: "absolute", label: "Absolute A" },
  { value: "sine", label: "Sine A" },
  { value: "cosine", label: "Cosine A" },
  { value: "clamp01", label: "Clamp A to 0–1" },
];

export const NODE_DEFINITIONS: readonly NodeDefinition[] = [
  {
    type: "coordinate3d",
    title: "Field Coordinates",
    description: "The coordinate currently being evaluated inside a 3D procedural field.",
    category: "3D Field",
    domain: "field3d",
    inputs: [],
    outputs: [{ id: "position", label: "Position", type: "coordinate3d" }],
    params: [],
  },
  {
    type: "time",
    title: "Time",
    description: "Elapsed animation time in seconds.",
    category: "Values",
    domain: "value",
    inputs: [],
    outputs: [{ id: "value", label: "Seconds", type: "float" }],
    params: [],
  },
  {
    type: "value",
    title: "Value",
    description: "A reusable scalar parameter.",
    category: "Values",
    domain: "value",
    inputs: [],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    params: [NUMBER("value", "Value", 1, -1000, 1000, 0.01)],
  },
  {
    type: "mathFloat",
    title: "Value Math",
    description: "Combines global scalar values such as Time and speed.",
    category: "Values",
    domain: "value",
    inputs: [
      { id: "a", label: "A", accepts: ["float"], fallbackParam: "a" },
      { id: "b", label: "B", accepts: ["float"], fallbackParam: "b" },
    ],
    outputs: [{ id: "value", label: "Value", type: "float" }],
    params: [
      SELECT("operation", "Operation", "multiply", MATH_OPTIONS),
      NUMBER("a", "A", 0, -1000, 1000, 0.01),
      NUMBER("b", "B", 1, -1000, 1000, 0.01),
    ],
  },
  {
    type: "mapping3d",
    title: "Mapping 3D",
    description: "Transforms field coordinates before they enter another 3D node.",
    category: "3D Field",
    domain: "field3d",
    inputs: [
      { id: "coordinate", label: "Coordinate", accepts: ["coordinate3d"] },
      { id: "scaleX", label: "Scale X", accepts: ["float"], fallbackParam: "scaleX" },
      { id: "scaleY", label: "Scale Y", accepts: ["float"], fallbackParam: "scaleY" },
      { id: "scaleZ", label: "Scale Z", accepts: ["float"], fallbackParam: "scaleZ" },
    ],
    outputs: [{ id: "coordinate", label: "Coordinate", type: "coordinate3d" }],
    params: [
      NUMBER("scaleX", "Scale X", 1, -20, 20, 0.01),
      NUMBER("scaleY", "Scale Y", 1, -20, 20, 0.01),
      NUMBER("scaleZ", "Scale Z", 1, -20, 20, 0.01),
      NUMBER("offsetX", "Offset X", 0, -100, 100, 0.01),
      NUMBER("offsetY", "Offset Y", 0, -100, 100, 0.01),
      NUMBER("offsetZ", "Offset Z", 0, -100, 100, 0.01),
      NUMBER("rotationX", "Rotate X°", 0, -360, 360, 1, 1),
      NUMBER("rotationY", "Rotate Y°", 0, -360, 360, 1, 1),
      NUMBER("rotationZ", "Rotate Z°", 0, -360, 360, 1, 1),
      BOOLEAN("flipX", "Flip X", false),
      BOOLEAN("flipY", "Flip Y", false),
    ],
    width: 228,
  },
  {
    type: "simplex3d",
    title: "Simplex Noise 3D",
    description: "A deterministic 3D scalar field. Seed changes its domain offset.",
    category: "3D Field",
    domain: "field3d",
    inputs: [{ id: "coordinate", label: "Coordinate", accepts: ["coordinate3d"] }],
    outputs: [{ id: "value", label: "Field", type: "field3d" }],
    params: [NUMBER("seed", "Seed", 0, -10000, 10000, 1, 0)],
  },
  {
    type: "axis3d",
    title: "Separate Coordinate",
    description: "Extracts one coordinate axis as a scalar 3D field.",
    category: "3D Field",
    domain: "field3d",
    inputs: [{ id: "coordinate", label: "Coordinate", accepts: ["coordinate3d"] }],
    outputs: [{ id: "value", label: "Field", type: "field3d" }],
    params: [SELECT("axis", "Axis", "y", [
      { value: "x", label: "X" }, { value: "y", label: "Y" }, { value: "z", label: "Z" },
    ])],
  },
  {
    type: "pinchEnvelope",
    title: "Pinch Envelope",
    description: "The existing (1 − x²)^(1/a²) horizontal envelope.",
    category: "3D Field",
    domain: "field3d",
    inputs: [{ id: "coordinate", label: "Coordinate", accepts: ["coordinate3d"] }],
    outputs: [{ id: "value", label: "Envelope", type: "field3d" }],
    params: [
      SELECT("mode", "Mode", "none", [
        { value: "none", label: "None" },
        { value: "center", label: "Center pinch" },
        { value: "edges", label: "Edge pinch" },
      ]),
      NUMBER("exponent", "Exponent", 1, 0.1, 3, 0.01),
    ],
  },
  {
    type: "depthRamp",
    title: "Depth Pinch",
    description: "Builds slope × (z − slice), anchored exactly to the projection plane.",
    category: "3D Field",
    domain: "field3d",
    inputs: [
      { id: "coordinate", label: "Coordinate", accepts: ["coordinate3d"] },
      { id: "slice", label: "Slice Z", accepts: ["float"], fallbackParam: "slice" },
    ],
    outputs: [{ id: "value", label: "Field", type: "field3d" }],
    params: [
      BOOLEAN("enabled", "Enabled", true),
      NUMBER("slice", "Slice Z", 0, -1000, 1000, 0.01),
      NUMBER("slope", "Slope", 10, -20, 20, 0.1),
    ],
  },
  {
    type: "fieldMath",
    title: "Field Math",
    description: "Combines 3D scalar fields. Plain values are promoted to constant fields.",
    category: "3D Field",
    domain: "field3d",
    inputs: [
      { id: "a", label: "A", accepts: ["field3d", "float"], fallbackParam: "a" },
      { id: "b", label: "B", accepts: ["field3d", "float"], fallbackParam: "b" },
    ],
    outputs: [{ id: "value", label: "Field", type: "field3d" }],
    params: [
      SELECT("operation", "Operation", "multiply", MATH_OPTIONS),
      NUMBER("a", "A", 0, -1000, 1000, 0.01),
      NUMBER("b", "B", 1, -1000, 1000, 0.01),
    ],
  },
  {
    type: "projection",
    title: "Linear Isosurface Projection",
    description: "The one-way bridge: estimates the signed Z distance to a 3D field's zero crossing.",
    category: "3D → 2D",
    domain: "bridge",
    inputs: [
      { id: "field", label: "Field 3D", accepts: ["field3d"] },
      { id: "slice", label: "Slice Z", accepts: ["float"], fallbackParam: "slice" },
    ],
    outputs: [{ id: "surface", label: "Surface 2D", type: "surface2d" }],
    params: [
      NUMBER("slice", "Slice Z", 0, -1000, 1000, 0.01),
      NUMBER("epsilon", "Derivative ε", 0.005, 0.0001, 0.05, 0.0001, 4),
      NUMBER("positiveFalloff", "+Z extent", 0.2, 0.01, 0.5, 0.01),
      NUMBER("negativeFalloff", "−Z extent", 0.2, 0.01, 0.5, 0.01),
      NUMBER("verticalOrigin", "Vertical origin", 1, -1, 1, 0.01),
    ],
    width: 250,
  },
  {
    type: "morphology",
    title: "Surface Shrink",
    description: "Screen-space opacity-gradient erosion from the original shader.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [{ id: "surface", label: "Surface 2D", accepts: ["surface2d"] }],
    outputs: [{ id: "surface", label: "Surface 2D", type: "surface2d" }],
    params: [NUMBER("shrink", "Shrink", 1, 0, 3, 0.1)],
  },
  {
    type: "surfaceInfo",
    title: "Surface Information",
    description: "Exposes projected depth, coverage and signed-side masks.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [{ id: "surface", label: "Surface 2D", accepts: ["surface2d"] }],
    outputs: [
      { id: "depth", label: "Signed depth", type: "scalar2d" },
      { id: "coverage", label: "Coverage", type: "scalar2d" },
      { id: "positiveT", label: "+Z ramp", type: "scalar2d" },
      { id: "negativeT", label: "−Z ramp", type: "scalar2d" },
      { id: "positiveMask", label: "+Z mask", type: "scalar2d" },
      { id: "negativeMask", label: "−Z mask", type: "scalar2d" },
    ],
    params: [],
    width: 220,
  },
  {
    type: "screenCoordinates",
    title: "Screen Coordinates",
    description: "2D coordinates available only after projection into screen space.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [],
    outputs: [{ id: "uv", label: "UV 2D", type: "coordinate2d" }],
    params: [],
  },
  {
    type: "axis2d",
    title: "Separate Screen Coordinate",
    description: "Extracts X or Y from screen-space coordinates.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [{ id: "coordinate", label: "UV 2D", accepts: ["coordinate2d"] }],
    outputs: [{ id: "value", label: "Scalar 2D", type: "scalar2d" }],
    params: [SELECT("axis", "Axis", "x", [{ value: "x", label: "X" }, { value: "y", label: "Y" }])],
  },
  {
    type: "screenMath",
    title: "Screen Math",
    description: "Combines 2D scalar fields after projection.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [
      { id: "a", label: "A", accepts: ["scalar2d", "float"], fallbackParam: "a" },
      { id: "b", label: "B", accepts: ["scalar2d", "float"], fallbackParam: "b" },
    ],
    outputs: [{ id: "value", label: "Scalar 2D", type: "scalar2d" }],
    params: [SELECT("operation", "Operation", "multiply", MATH_OPTIONS), NUMBER("a", "A", 0, -1000, 1000, 0.01), NUMBER("b", "B", 1, -1000, 1000, 0.01)],
  },
  {
    type: "colorRamp",
    title: "Color Ramp",
    description: "Maps a screen-space scalar through an editable color gradient.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [{ id: "value", label: "Factor", accepts: ["scalar2d"] }],
    outputs: [{ id: "color", label: "Color 2D", type: "color2d" }],
    params: [GRADIENT("gradient", "Gradient", [{ color: "#222222", position: 0 }, { color: "#ffffff", position: 1 }])],
    width: 220,
  },
  {
    type: "solidColor",
    title: "Solid Color",
    description: "A constant color in screen space.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [],
    outputs: [{ id: "color", label: "Color 2D", type: "color2d" }],
    params: [COLOR("color", "Color", "#ffffff"), NUMBER("alpha", "Alpha", 1, 0, 1, 0.01)],
  },
  {
    type: "surfaceColorize",
    title: "Surface Colorize",
    description: "Selects the signed ramp, applies coverage, visibility and layer opacity.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [
      { id: "surface", label: "Surface 2D", accepts: ["surface2d"] },
      { id: "positiveColor", label: "+Z color", accepts: ["color2d"] },
      { id: "negativeColor", label: "−Z color", accepts: ["color2d"] },
    ],
    outputs: [{ id: "color", label: "Color 2D", type: "color2d" }],
    params: [BOOLEAN("positiveEnabled", "Render +Z", false), BOOLEAN("negativeEnabled", "Render −Z", true), NUMBER("opacity", "Opacity", 1, 0, 1, 0.01)],
    width: 230,
  },
  {
    type: "setAlpha",
    title: "Set Alpha",
    description: "Replaces a screen color's alpha and premultiplies its RGB.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [
      { id: "color", label: "Color 2D", accepts: ["color2d"] },
      { id: "alpha", label: "Alpha", accepts: ["scalar2d", "float"], fallbackParam: "alpha" },
    ],
    outputs: [{ id: "color", label: "Color 2D", type: "color2d" }],
    params: [NUMBER("alpha", "Alpha", 1, 0, 1, 0.01)],
  },
  {
    type: "blend",
    title: "Combine Colors",
    description: "Combines two complete screen-space branches using a selected blend mode.",
    category: "2D Screen",
    domain: "screen2d",
    inputs: [
      { id: "bottom", label: "Bottom", accepts: ["color2d"] },
      { id: "top", label: "Top", accepts: ["color2d"] },
    ],
    outputs: [{ id: "color", label: "Color 2D", type: "color2d" }],
    params: [
      SELECT("mode", "Blend mode", "sourceOver", [
        { value: "sourceOver", label: "Source over" },
        { value: "add", label: "Add" },
        { value: "screen", label: "Screen" },
        { value: "multiply", label: "Multiply" },
        { value: "maximum", label: "Maximum" },
      ]),
      NUMBER("opacity", "Top opacity", 1, 0, 1, 0.01),
    ],
    width: 220,
  },
  {
    type: "output",
    title: "Screen Output",
    description: "Final display, background and post-projection Gaussian blur.",
    category: "Output",
    domain: "output",
    inputs: [{ id: "color", label: "Color 2D", accepts: ["color2d"] }],
    outputs: [],
    params: [COLOR("background", "Background", "#f5f5f7"), NUMBER("blurRadius", "Master blur", 4, 0, 30, 0.5, 1)],
    width: 220,
  },
];

const DEFINITION_MAP = new Map(NODE_DEFINITIONS.map((definition) => [definition.type, definition]));

export function getNodeDefinition(type: string): NodeDefinition {
  const definition = DEFINITION_MAP.get(type);
  if (!definition) throw new Error(`Unknown node type: ${type}`);
  return definition;
}

export function createDefaultParams(type: string): Record<string, NodeParamValue> {
  const params: Record<string, NodeParamValue> = {};
  for (const definition of getNodeDefinition(type).params) {
    params[definition.id] = Array.isArray(definition.default)
      ? definition.default.map((stop) => ({ ...stop }))
      : definition.default;
  }
  return params;
}

export function isCompileTimeParam(type: string, paramId: string): boolean {
  if (paramId === "operation" || paramId === "mode" || paramId === "axis") return true;
  if (type === "depthRamp" && paramId === "enabled") return true;
  return type === "mapping3d" && (paramId === "flipX" || paramId === "flipY");
}
