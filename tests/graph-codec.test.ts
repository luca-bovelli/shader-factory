import { describe, expect, it } from "vitest";
import { GraphCompiler } from "../src/compiler/compiler";
import { parseGraph, serializeGraph } from "../src/graph/codec";
import { createDefaultGraph } from "../src/graph/defaultGraph";

describe("node graph document", () => {
  it("round-trips every node, edge, parameter, and editor position", () => {
    const graph = createDefaultGraph();
    graph.nodes.find((node) => node.id === "projection")!.params.verticalOrigin = -0.25;
    graph.nodes.find((node) => node.id === "colorize")!.params.opacity = 0.42;

    expect(parseGraph(serializeGraph(graph))).toEqual(graph);
  });

  it("rejects the legacy layer schema", () => {
    expect(() => parseGraph('{"global":{},"layers":[]}')).toThrow("version 1");
  });

  it("clamps imported numeric parameters to their declared ranges", () => {
    const graph = createDefaultGraph();
    graph.nodes.find((node) => node.id === "projection")!.params.verticalOrigin = -4;
    graph.nodes.find((node) => node.id === "colorize")!.params.opacity = 2;
    graph.nodes.find((node) => node.id === "output")!.params.blurRadius = 100;

    const parsed = parseGraph(serializeGraph(graph));
    expect(parsed.nodes.find((node) => node.id === "projection")!.params.verticalOrigin).toBe(-1);
    expect(parsed.nodes.find((node) => node.id === "colorize")!.params.opacity).toBe(1);
    expect(parsed.nodes.find((node) => node.id === "output")!.params.blurRadius).toBe(30);
  });

  it("rejects invalid ramps before they reach Canvas or WebGL", () => {
    const graph = createDefaultGraph();
    graph.nodes.find((node) => node.id === "negative-ramp")!.params.gradient = [];
    expect(() => parseGraph(serializeGraph(graph))).toThrow("1–16 stops");
  });

  it("compiles the decomposed default graph into its field, bridge, and screen stages", () => {
    const compiled = new GraphCompiler(createDefaultGraph()).compile();
    expect(compiled.fragmentSource).toContain("float field_projection");
    expect(compiled.fragmentSource).toContain("vec4 project_projection");
    expect(compiled.fragmentSource).toContain("vec4 morph_shrink");
    expect(compiled.fragmentSource).toContain("colorizeSurface");
    expect(compiled.gradients).toHaveLength(2);
  });
});
