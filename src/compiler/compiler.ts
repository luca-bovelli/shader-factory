import { getNodeDefinition } from "../graph/registry";
import { validateGraph } from "../graph/codec";
import type { GraphDocument, GraphEdge, GraphNode, PortType } from "../graph/types";
import type { CompiledGraph, GradientBinding, UniformBinding } from "./types";

interface OutputRef { node: GraphNode; port: string; type: PortType }

export class GraphCompiler {
  readonly #nodes: Map<string, GraphNode>;
  readonly #uniforms = new Map<string, UniformBinding>();
  readonly #gradients = new Map<string, GradientBinding>();
  readonly #fieldFunctions = new Map<string, string>();
  readonly #surfaceFunctions = new Map<string, string>();
  readonly #screenStatements: string[] = [];
  readonly #screenVariables = new Map<string, string>();

  constructor(private readonly graph: GraphDocument) {
    this.#nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  }

  compile(): CompiledGraph {
    const errors = validateGraph(this.graph);
    if (errors.length) throw new Error(errors[0]);
    const output = this.graph.nodes.find((node) => node.type === "output");
    if (!output) throw new Error("Screen Output is missing");
    const colorRef = this.inputRef(output, "color");
    const finalColor = colorRef ? this.compileScreen(colorRef) : "vec4(0.0)";

    const uniformDeclarations = [
      "uniform vec2 u_resolution;",
      "uniform float u_time;",
      ...[...this.#uniforms.values()].map((uniform) => `uniform ${uniform.kind === "color" ? "vec3" : "float"} ${uniform.name};`),
      ...[...this.#gradients.values()].map((gradient) => `uniform sampler2D ${gradient.name};`),
    ].join("\n");

    const fragmentSource = `
precision highp float;
${uniformDeclarations}

${SIMPLEX_GLSL}
${COMMON_GLSL}
${[...this.#fieldFunctions.values()].join("\n")}
${[...this.#surfaceFunctions.values()].join("\n")}

void main() {
  vec2 screenPoint = gl_FragCoord.xy / u_resolution.x;
  screenPoint.x -= 0.5;
  ${this.#screenStatements.join("\n  ")}
  gl_FragColor = ${finalColor};
}
`;

    return {
      fragmentSource,
      uniforms: [...this.#uniforms.values()],
      gradients: [...this.#gradients.values()],
      outputNodeId: output.id,
      graph: this.graph,
    };
  }

  private compileFloat(ref: OutputRef | undefined): string {
    if (!ref) return "0.0";
    const { node } = ref;
    if (node.type === "time") return "u_time";
    if (node.type === "value") return this.param(node, "value");
    if (node.type === "mathFloat") {
      const aRef = this.inputRef(node, "a");
      const bRef = this.inputRef(node, "b");
      return mathExpression(
        String(node.params.operation),
        aRef ? this.compileFloat(aRef) : this.param(node, "a"),
        bRef ? this.compileFloat(bRef) : this.param(node, "b"),
      );
    }
    throw new Error(`${node.type} cannot produce a global float`);
  }

  private compileField(ref: OutputRef, position: string, memo = new Map<string, string>()): string {
    const key = `${ref.node.id}:${ref.port}:${position}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const node = ref.node;
    let expression: string;
    switch (node.type) {
      case "coordinate3d": expression = position; break;
      case "mapping3d": {
        const coordinate = this.inputRef(node, "coordinate");
        if (!coordinate) throw new Error("Mapping 3D requires coordinates");
        const base = this.compileField(coordinate, position, memo);
        const scaleX = this.fieldOrFloatInput(node, "scaleX", position, memo);
        const scaleY = this.fieldOrFloatInput(node, "scaleY", position, memo);
        const scaleZ = this.fieldOrFloatInput(node, "scaleZ", position, memo);
        const flipX = node.params.flipX === true ? "-1.0" : "1.0";
        const flipY = node.params.flipY === true ? "-1.0" : "1.0";
        expression = `mapCoordinates(${base}, vec3(${scaleX} * ${flipX}, ${scaleY} * ${flipY}, ${scaleZ}), vec3(${this.param(node,"rotationX")}, ${this.param(node,"rotationY")}, ${this.param(node,"rotationZ")}), vec3(${this.param(node,"offsetX")}, ${this.param(node,"offsetY")}, ${this.param(node,"offsetZ")}))`;
        break;
      }
      case "simplex3d": {
        const coordinate = this.inputRef(node, "coordinate");
        if (!coordinate) throw new Error("Simplex Noise requires coordinates");
        expression = `snoise(${this.compileField(coordinate, position, memo)} + seedOffset(${this.param(node, "seed")}))`;
        break;
      }
      case "axis3d": {
        const coordinate = this.inputRef(node, "coordinate");
        if (!coordinate) throw new Error("Separate Coordinate requires coordinates");
        const axis = node.params.axis === "x" ? "x" : node.params.axis === "z" ? "z" : "y";
        expression = `(${this.compileField(coordinate, position, memo)}).${axis}`;
        break;
      }
      case "pinchEnvelope": {
        const coordinate = this.inputRef(node, "coordinate");
        if (!coordinate) throw new Error("Pinch Envelope requires coordinates");
        const x = `((${this.compileField(coordinate, position, memo)}).x * 2.0)`;
        const base = `pow(max(0.0, 1.0 - ${x} * ${x}), 1.0 / (${this.param(node,"exponent")} * ${this.param(node,"exponent")}))`;
        expression = node.params.mode === "center" ? `(1.0 - ${base})` : node.params.mode === "edges" ? base : "1.0";
        break;
      }
      case "depthRamp": {
        if (node.params.enabled !== true) { expression = "1.0"; break; }
        const coordinate = this.inputRef(node, "coordinate");
        if (!coordinate) throw new Error("Depth Pinch requires coordinates");
        const slice = this.inputRef(node, "slice") ? this.compileFloat(this.inputRef(node, "slice")) : this.param(node, "slice");
        expression = `(((${this.compileField(coordinate, position, memo)}).z - ${slice}) * ${this.param(node,"slope")})`;
        break;
      }
      case "fieldMath": {
        expression = mathExpression(
          String(node.params.operation),
          this.fieldOrFloatInput(node, "a", position, memo),
          this.fieldOrFloatInput(node, "b", position, memo),
        );
        break;
      }
      case "value":
      case "time":
      case "mathFloat": expression = this.compileFloat(ref); break;
      default: throw new Error(`${node.type} cannot be evaluated in a 3D field`);
    }
    memo.set(key, expression);
    return expression;
  }

  private fieldOrFloatInput(node: GraphNode, port: string, position: string, memo: Map<string, string>): string {
    const ref = this.inputRef(node, port);
    if (!ref) {
      const fallback = getNodeDefinition(node.type).inputs.find((input) => input.id === port)?.fallbackParam;
      return fallback ? this.param(node, fallback) : "0.0";
    }
    return ref.type === "float" ? this.compileFloat(ref) : this.compileField(ref, position, memo);
  }

  private compileSurfaceAt(ref: OutputRef, point: string): string {
    if (ref.node.type === "projection") {
      this.ensureProjectionFunction(ref.node);
      return `project_${safe(ref.node.id)}(${point})`;
    }
    if (ref.node.type === "morphology") {
      this.ensureMorphologyFunction(ref.node);
      return `morph_${safe(ref.node.id)}(${point})`;
    }
    throw new Error(`${ref.node.type} is not a Surface 2D producer`);
  }

  private ensureProjectionFunction(node: GraphNode): void {
    if (this.#surfaceFunctions.has(node.id)) return;
    const fieldRef = this.inputRef(node, "field");
    if (!fieldRef) throw new Error("Linear Isosurface Projection requires a 3D field");
    const fieldName = `field_${safe(node.id)}`;
    const fieldExpression = this.compileField(fieldRef, "fieldPosition", new Map());
    this.#fieldFunctions.set(node.id, `float ${fieldName}(vec3 fieldPosition) { return ${fieldExpression}; }`);
    const slice = this.inputRef(node, "slice") ? this.compileFloat(this.inputRef(node, "slice")) : this.param(node, "slice");
    const functionSource = `
vec4 project_${safe(node.id)}(vec2 inputPoint) {
  vec2 point = inputPoint;
  float viewportHeight = u_resolution.y / u_resolution.x;
  point.y -= (1.0 - ${this.param(node,"verticalOrigin")}) * 0.5 * viewportHeight;
  float sliceZ = ${slice};
  float epsilon = ${this.param(node,"epsilon")};
  float center = ${fieldName}(vec3(point, sliceZ));
  float positive = ${fieldName}(vec3(point, sliceZ + epsilon));
  float negative = ${fieldName}(vec3(point, sliceZ - epsilon));
  float derivative = (positive - negative) / (2.0 * epsilon);
  float derivativeSign = derivative >= 0.0 ? 1.0 : -1.0;
  float safeDerivative = derivativeSign * max(abs(derivative), 0.0001);
  float hitDepth = -center / safeDerivative;
  float positiveFalloff = ${this.param(node,"positiveFalloff")};
  float negativeFalloff = ${this.param(node,"negativeFalloff")};
  float falloff = hitDepth >= 0.0 ? positiveFalloff : negativeFalloff;
  float coverage = smoothstep(falloff, 0.0, abs(hitDepth));
  coverage *= smoothstep(0.0001, 0.008, abs(derivative));
  float positiveT = clamp(abs(hitDepth) / positiveFalloff, 0.0, 1.0);
  float negativeT = clamp(abs(hitDepth) / negativeFalloff, 0.0, 1.0);
  return vec4(coverage, hitDepth, positiveT, negativeT);
}`;
    this.#surfaceFunctions.set(node.id, functionSource);
  }

  private ensureMorphologyFunction(node: GraphNode): void {
    if (this.#surfaceFunctions.has(node.id)) return;
    const input = this.inputRef(node, "surface");
    if (!input) throw new Error("Surface Shrink requires a projected surface");
    const sample = (point: string) => this.compileSurfaceAt(input, point);
    const source = `
vec4 morph_${safe(node.id)}(vec2 point) {
  vec4 base = ${sample("point")};
  float shrink = ${this.param(node,"shrink")};
  if (shrink <= 0.0) return base;
  float epsilon = 0.002;
  float opacityX = (${sample("point + vec2(epsilon, 0.0)")}).x;
  float opacityY = (${sample("point + vec2(0.0, epsilon)")}).x;
  vec2 gradient = vec2(opacityX - base.x, opacityY - base.x) / epsilon;
  float gradientMagnitude = length(gradient);
  vec2 normal = gradient / (gradientMagnitude + 1e-6);
  float distance = shrink * 0.005 * smoothstep(0.0, 0.05, gradientMagnitude);
  float forwardOpacity = (${sample("point + normal * distance")}).x;
  float backwardOpacity = (${sample("point - normal * distance")}).x;
  base.x = min(base.x, min(forwardOpacity, backwardOpacity));
  return base;
}`;
    this.#surfaceFunctions.set(node.id, source);
  }

  private compileScreen(ref: OutputRef): string {
    const key = `${ref.node.id}:${ref.port}`;
    const cached = this.#screenVariables.get(key);
    if (cached) return cached;
    const node = ref.node;
    const variable = `v_${safe(node.id)}_${safe(ref.port)}`;
    let type = "float";
    let expression: string;
    switch (node.type) {
      case "projection":
      case "morphology":
        type = "vec4";
        expression = this.compileSurfaceAt(ref, "screenPoint");
        break;
      case "surfaceInfo": {
        const surface = this.requireScreenInput(node, "surface");
        const component = ref.port === "depth" ? "y" : ref.port === "coverage" ? "x" : ref.port === "positiveT" ? "z" : ref.port === "negativeT" ? "w" : null;
        if (component) expression = `${surface}.${component}`;
        else if (ref.port === "positiveMask") expression = `step(0.0, ${surface}.y)`;
        else expression = `(1.0 - step(0.0, ${surface}.y))`;
        break;
      }
      case "screenCoordinates": type = "vec2"; expression = "screenPoint"; break;
      case "axis2d": {
        const coordinate = this.requireScreenInput(node, "coordinate");
        expression = `${coordinate}.${node.params.axis === "y" ? "y" : "x"}`;
        break;
      }
      case "screenMath": expression = mathExpression(String(node.params.operation), this.screenOrFloatInput(node,"a"), this.screenOrFloatInput(node,"b")); break;
      case "colorRamp": {
        type = "vec4";
        const factor = this.requireScreenInput(node, "value");
        expression = `texture2D(${this.gradient(node,"gradient")}, vec2(clamp(${factor}, 0.0, 1.0), 0.5))`;
        break;
      }
      case "solidColor": {
        type = "vec4";
        const alpha = this.param(node,"alpha");
        const color = this.colorParam(node,"color");
        expression = `vec4(${color} * ${alpha}, ${alpha})`;
        break;
      }
      case "surfaceColorize": {
        type = "vec4";
        const surface = this.requireScreenInput(node,"surface");
        const positiveColor = this.requireScreenInput(node,"positiveColor");
        const negativeColor = this.requireScreenInput(node,"negativeColor");
        const opacity = this.param(node,"opacity");
        const positiveEnabled = this.param(node,"positiveEnabled");
        const negativeEnabled = this.param(node,"negativeEnabled");
        expression = `colorizeSurface(${surface}, ${positiveColor}, ${negativeColor}, ${positiveEnabled}, ${negativeEnabled}, ${opacity})`;
        break;
      }
      case "setAlpha": {
        type = "vec4";
        const color = this.requireScreenInput(node,"color");
        const alpha = this.screenOrFloatInput(node,"alpha");
        expression = `replaceAlpha(${color}, ${alpha})`;
        break;
      }
      case "blend": {
        type = "vec4";
        const bottom = this.requireScreenInput(node,"bottom");
        const top = this.requireScreenInput(node,"top");
        const mode = blendModeIndex(String(node.params.mode));
        expression = `blendColors(${bottom}, ${top}, ${this.param(node,"opacity")}, ${mode})`;
        break;
      }
      case "value":
      case "time":
      case "mathFloat": expression = this.compileFloat(ref); break;
      default: throw new Error(`${node.type} cannot be evaluated in screen space`);
    }
    this.#screenStatements.push(`${type} ${variable} = ${expression};`);
    this.#screenVariables.set(key, variable);
    return variable;
  }

  private requireScreenInput(node: GraphNode, port: string): string {
    const ref = this.inputRef(node, port);
    if (!ref) throw new Error(`${getNodeDefinition(node.type).title} requires ${port}`);
    return this.compileScreen(ref);
  }

  private screenOrFloatInput(node: GraphNode, port: string): string {
    const ref = this.inputRef(node, port);
    if (!ref) {
      const fallback = getNodeDefinition(node.type).inputs.find((input) => input.id === port)?.fallbackParam;
      return fallback ? this.param(node, fallback) : "0.0";
    }
    return ref.type === "float" ? this.compileFloat(ref) : this.compileScreen(ref);
  }

  private inputRef(node: GraphNode, port: string): OutputRef | undefined {
    const edge = this.graph.edges.find((candidate) => candidate.toNode === node.id && candidate.toPort === port);
    if (!edge) return undefined;
    return this.outputRef(edge);
  }

  private outputRef(edge: GraphEdge): OutputRef {
    const node = this.#nodes.get(edge.fromNode);
    if (!node) throw new Error("Connection references a missing source node");
    const output = getNodeDefinition(node.type).outputs.find((port) => port.id === edge.fromPort);
    if (!output) throw new Error("Connection references a missing source socket");
    return { node, port: output.id, type: output.type };
  }

  private param(node: GraphNode, paramId: string): string {
    const name = `u_${safe(node.id)}_${safe(paramId)}`;
    if (!this.#uniforms.has(name)) {
      const value = node.params[paramId];
      this.#uniforms.set(name, { name, nodeId: node.id, paramId, kind: typeof value === "boolean" ? "boolean" : "number" });
    }
    return name;
  }

  private colorParam(node: GraphNode, paramId: string): string {
    const name = `u_${safe(node.id)}_${safe(paramId)}`;
    if (!this.#uniforms.has(name)) this.#uniforms.set(name, { name, nodeId: node.id, paramId, kind: "color" });
    return name;
  }

  private gradient(node: GraphNode, paramId: string): string {
    const name = `u_${safe(node.id)}_${safe(paramId)}`;
    if (!this.#gradients.has(name)) {
      const stops = node.params[paramId];
      if (!Array.isArray(stops)) throw new Error(`${node.type}.${paramId} is not a gradient`);
      this.#gradients.set(name, { name, nodeId: node.id, paramId, stops });
    }
    return name;
  }
}

const safe = (value: string): string => value.replace(/[^a-zA-Z0-9_]/g, "_");

function mathExpression(operation: string, a: string, b: string): string {
  switch (operation) {
    case "add": return `((${a}) + (${b}))`;
    case "subtract": return `((${a}) - (${b}))`;
    case "divide": return `((${a}) / (abs(${b}) < 0.000001 ? (${b} < 0.0 ? -0.000001 : 0.000001) : ${b}))`;
    case "power": return `pow(max(0.0, ${a}), ${b})`;
    case "minimum": return `min(${a}, ${b})`;
    case "maximum": return `max(${a}, ${b})`;
    case "absolute": return `abs(${a})`;
    case "sine": return `sin(${a})`;
    case "cosine": return `cos(${a})`;
    case "clamp01": return `clamp(${a}, 0.0, 1.0)`;
    default: return `((${a}) * (${b}))`;
  }
}

function blendModeIndex(mode: string): number {
  return mode === "add" ? 1 : mode === "screen" ? 2 : mode === "multiply" ? 3 : mode === "maximum" ? 4 : 0;
}

const COMMON_GLSL = `
const float PI = 3.141592653589793;

vec3 rotateCoordinates(vec3 point, vec3 degrees) {
  vec3 r = degrees * (PI / 180.0);
  float cx = cos(r.x), sx = sin(r.x);
  float cy = cos(r.y), sy = sin(r.y);
  float cz = cos(r.z), sz = sin(r.z);
  point = vec3(point.x, cx * point.y - sx * point.z, sx * point.y + cx * point.z);
  point = vec3(cy * point.x + sy * point.z, point.y, -sy * point.x + cy * point.z);
  return vec3(cz * point.x - sz * point.y, sz * point.x + cz * point.y, point.z);
}

vec3 mapCoordinates(vec3 point, vec3 scale, vec3 rotation, vec3 offset) {
  return rotateCoordinates(point * scale, rotation) + offset;
}

vec3 seedOffset(float seed) {
  vec3 base = vec3(143.314159, 217.798182, 389.123123);
  vec3 seeded = sin(vec3(seed * 12.9898, seed * 78.233, seed * 37.719)) * 43.7585453;
  return base + seeded;
}

vec4 colorizeSurface(vec4 surface, vec4 positiveColor, vec4 negativeColor, float positiveEnabled, float negativeEnabled, float opacity) {
  float sideEnabled = surface.y >= 0.0 ? positiveEnabled : negativeEnabled;
  float alpha = surface.x * sideEnabled * opacity;
  vec3 color = surface.y >= 0.0 ? positiveColor.rgb : negativeColor.rgb;
  return vec4(color * alpha, alpha);
}

vec4 replaceAlpha(vec4 color, float alpha) {
  vec3 straight = color.a > 0.000001 ? color.rgb / color.a : color.rgb;
  return vec4(straight * alpha, alpha);
}

vec4 blendColors(vec4 bottom, vec4 top, float opacity, int mode) {
  top *= opacity;
  if (mode == 0) return top + bottom * (1.0 - top.a);
  if (mode == 1) return vec4(bottom.rgb + top.rgb, max(bottom.a, top.a));
  if (mode == 4) return vec4(max(bottom.rgb, top.rgb), max(bottom.a, top.a));
  vec3 cb = bottom.a > 0.000001 ? bottom.rgb / bottom.a : vec3(0.0);
  vec3 ct = top.a > 0.000001 ? top.rgb / top.a : vec3(0.0);
  vec3 blend = mode == 2 ? 1.0 - (1.0 - cb) * (1.0 - ct) : cb * ct;
  float outAlpha = top.a + bottom.a * (1.0 - top.a);
  vec3 outRgb = (1.0 - top.a) * bottom.rgb + (1.0 - bottom.a) * top.rgb + bottom.a * top.a * blend;
  return vec4(outRgb, outAlpha);
}
`;

const SIMPLEX_GLSL = `
vec4 permute(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + 2.0 * C.xxx;
  vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0 / 7.0;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m *= m;
  return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;
