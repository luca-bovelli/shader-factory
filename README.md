# Isosurface Node Studio

A typed node-graph editor and WebGL compiler for the procedural isosurface effect. The included graph decomposes one complete instance of the original shader into reusable coordinate, field, projection, screen-space, color, compositing, and output nodes.

## Run locally

Requires a current Node.js installation.

```bash
npm install
npm run dev
```

For an optimized static build:

```bash
npm run build
```

The generated application is written to `dist/`.

## Editor controls

- Drag the background to pan and scroll to zoom.
- Drag an output socket onto a compatible input socket to connect nodes.
- Double-click a connected input socket to disconnect it.
- Select a node or connection and press Delete/Backspace to remove it.
- Right-click the graph, or use **Add node**, to open the searchable palette.
- Use **Frame all** or Ctrl/Cmd+0 to fit the complete graph.
- Use **Graph JSON** to copy or replace the current version 1 graph.

Socket types are enforced. A `Field 3D` can enter the projection bridge, which creates a `Surface 2D`; no screen-space result can connect back into a 3D input.

## Default graph

The default graph retains the complete effect:

- animated 3D simplex noise with seed and transformable coordinates;
- X pinch envelope, Z depth pinch, Y slope, offsets, flips, rotation, and non-uniform scale;
- the signed local-linear isosurface projection and derivative spark suppression;
- movable vertical origin (`-1` top, `0` center, `1` bottom; default `1`);
- screen-space morphological shrink;
- independent positive/negative falloff, visibility, and color ramps;
- branch opacity, color blend modes, background, and separable Gaussian blur.

To make multiple visual layers, duplicate or build another field→projection→color branch, then combine the resulting `Color 2D` values with **Combine Colors**. Each **Surface Colorize** node provides opacity for its branch.

## Architecture

- `src/graph/` defines the typed schema, node registry, default graph, validation, persistence, and store.
- `src/compiler/` traverses the graph and emits a specialized GLSL fragment shader plus uniform and gradient bindings.
- `src/editor/` implements node rendering, typed connections, selection, pan/zoom, and the node palette.
- `src/renderer/` owns WebGL programs, render targets, uniform updates, cached ramp textures, and post-process blur.
- `src/styles.css` contains the responsive editor and modality color system.

The graph compiler keeps continuous controls as uniforms, so slider changes do not recompile GLSL. Only structural edits and compile-time choices (operations, axes, modes, and enabled field stages) rebuild the shader.

## Projection semantics

Before blur, the renderer is deterministic: for a screen coordinate and time it evaluates the graph to one premultiplied RGBA value. The projection node does not solve an arbitrary curved zero crossing exactly. It samples the 3D scalar field around the selected Z slice, estimates `∂F/∂z` with a central difference, and computes the local-linear root `zHit = -F / (∂F/∂z)`. That approximation is the characteristic projection algorithm preserved from the original shader.

## Verification

```bash
npm test
npm run build
```

Tests cover graph round-tripping and validation, rejection of legacy JSON, range clamping, graph-store change classification, typed one-way domain enforcement, cycle rejection, and compilation of the complete default graph. TypeScript runs in strict mode as part of the production build.
