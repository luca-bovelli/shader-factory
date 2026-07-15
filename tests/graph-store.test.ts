import { describe, expect, it, vi } from "vitest";
import { createDefaultGraph } from "../src/graph/defaultGraph";
import { GraphStore } from "../src/graph/store";

describe("GraphStore", () => {
  it("emits focused uniform-only changes for live numeric controls", () => {
    const store = new GraphStore(createDefaultGraph());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setParam("colorize", "opacity", 0.5);

    expect(store.getNode("colorize")!.params.opacity).toBe(0.5);
    expect(listener).toHaveBeenCalledWith(store.snapshot, {
      type: "param", nodeId: "colorize", paramId: "opacity", compileRequired: false,
    }, null);
  });

  it("requires recompilation for choices that alter generated GLSL", () => {
    const store = new GraphStore(createDefaultGraph());
    const listener = vi.fn();
    store.subscribe(listener);

    store.setParam("depth-pinch", "enabled", false);

    expect(listener).toHaveBeenLastCalledWith(store.snapshot, {
      type: "param", nodeId: "depth-pinch", paramId: "enabled", compileRequired: true,
    }, null);
  });

  it("enforces the one-way 3D to 2D type boundary", () => {
    const store = new GraphStore(createDefaultGraph());
    const result = store.connect("colorize", "color", "base-mapping", "coordinate");

    expect(result.ok).toBe(false);
    expect(result.message).toContain("color2d cannot connect");
  });

  it("replaces an occupied input deterministically and rejects cycles", () => {
    const store = new GraphStore(createDefaultGraph());
    const value = store.addNode("value", 0, 0);
    const replacement = store.connect(value.id, "value", "slice-speed", "b");
    const cycle = store.connect("slice-speed", "value", "slice-speed", "a");

    expect(replacement.ok).toBe(true);
    expect(store.getInputEdge("slice-speed", "b")?.fromNode).toBe(value.id);
    expect(cycle.ok).toBe(false);
  });
});
