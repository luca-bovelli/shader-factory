import { GraphCompiler } from "../compiler/compiler";
import type { CompiledGraph } from "../compiler/types";
import type { GraphChange, GraphDocument, GradientStop } from "../graph/types";
import { blurFragmentShaderSource, copyFragmentShaderSource, vertexShaderSource } from "./shaders";

interface ProgramInfo {
  program: WebGLProgram;
  position: number;
  uniforms: Map<string, WebGLUniformLocation | null>;
}

interface RenderTarget { framebuffer: WebGLFramebuffer; texture: WebGLTexture }
interface GradientResource { texture: WebGLTexture; key: string }

export class GraphRenderer {
  readonly #gl: WebGLRenderingContext;
  readonly #quad: WebGLBuffer;
  readonly #blurProgram: ProgramInfo;
  readonly #copyProgram: ProgramInfo;
  readonly #gradientCanvas = document.createElement("canvas");
  readonly #gradientContext: CanvasRenderingContext2D;
  readonly #gradientResources = new Map<string, GradientResource>();
  #graphProgram: ProgramInfo | null = null;
  #compiled: CompiledGraph | null = null;
  #graph: GraphDocument;
  #sceneTarget: RenderTarget | null = null;
  #blurTarget: RenderTarget | null = null;
  #frame = 0;
  #running = false;
  #startTime = performance.now();
  #lastError = "";

  constructor(
    private readonly canvas: HTMLCanvasElement,
    graph: GraphDocument,
    private readonly onStatus: (message: string, isError: boolean) => void,
  ) {
    const gl = canvas.getContext("webgl", { alpha: false, antialias: false, premultipliedAlpha: false });
    if (!gl) throw new Error("WebGL is not supported by this browser");
    this.#gl = gl;
    this.#graph = graph;
    const quad = gl.createBuffer();
    if (!quad) throw new Error("Unable to create the fullscreen quad");
    this.#quad = quad;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    this.#blurProgram = this.createProgram(vertexShaderSource, blurFragmentShaderSource);
    this.#copyProgram = this.createProgram(vertexShaderSource, copyFragmentShaderSource);
    this.#gradientCanvas.width = 256;
    this.#gradientCanvas.height = 1;
    const context = this.#gradientCanvas.getContext("2d");
    if (!context) throw new Error("Unable to create gradient resources");
    this.#gradientContext = context;
    this.compileGraph();
    this.resize();
    window.addEventListener("resize", this.resize, { passive: true });
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#startTime = performance.now();
    this.#frame = requestAnimationFrame(this.render);
  }

  stop(): void {
    this.#running = false;
    cancelAnimationFrame(this.#frame);
  }

  sync(graph: GraphDocument, change: GraphChange): void {
    this.#graph = graph;
    if (change.type === "structure" || change.type === "replace" || (change.type === "param" && change.compileRequired)) {
      this.compileGraph();
    } else if (change.type === "param") {
      this.syncGradientResources();
    }
  }

  private compileGraph(): void {
    try {
      const compiled = new GraphCompiler(this.#graph).compile();
      const maxTextureUnits = this.#gl.getParameter(this.#gl.MAX_TEXTURE_IMAGE_UNITS) as number;
      if (compiled.gradients.length + 1 > maxTextureUnits) {
        throw new Error(`This device supports at most ${maxTextureUnits - 1} color ramps in one graph`);
      }
      const nextProgram = this.createProgram(vertexShaderSource, compiled.fragmentSource);
      if (this.#graphProgram) this.#gl.deleteProgram(this.#graphProgram.program);
      this.#graphProgram = nextProgram;
      this.#compiled = compiled;
      this.#lastError = "";
      this.syncGradientResources(true);
      this.onStatus("Graph compiled", false);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to compile graph";
      if (message !== this.#lastError) this.onStatus(message, true);
      this.#lastError = message;
    }
  }

  private readonly resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width === width && this.canvas.height === height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    this.deleteTarget(this.#sceneTarget);
    this.deleteTarget(this.#blurTarget);
    this.#sceneTarget = this.createTarget(width, height);
    this.#blurTarget = this.createTarget(width, height);
  };

  private readonly render = (timestamp: number): void => {
    if (!this.#running) return;
    this.resize();
    const gl = this.#gl;
    const compiled = this.#compiled;
    const program = this.#graphProgram;
    const scene = this.#sceneTarget;
    const blur = this.#blurTarget;
    if (!compiled || !program || !scene || !blur) {
      this.#frame = requestAnimationFrame(this.render);
      return;
    }

    const output = this.#graph.nodes.find((node) => node.id === compiled.outputNodeId);
    const background = typeof output?.params.background === "string" ? output.params.background : "#f5f5f7";
    const blurRadius = typeof output?.params.blurRadius === "number" ? output.params.blurRadius : 0;
    const [red, green, blue] = hexToRgb(background);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(red, green, blue, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.framebuffer);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.useProgram(program.program);
    this.bindQuad(program);
    this.uniform2f(program, "u_resolution", this.canvas.width, this.canvas.height);
    this.uniform1f(program, "u_time", (timestamp - this.#startTime) * 0.001);
    this.applyGraphUniforms(program, compiled);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const radiusPixels = Math.min(30, blurRadius * (this.canvas.clientWidth / 1000) * (window.devicePixelRatio || 1));
    if (radiusPixels > 0) {
      gl.useProgram(this.#blurProgram.program);
      this.bindQuad(this.#blurProgram);
      this.uniform2f(this.#blurProgram, "u_resolution", this.canvas.width, this.canvas.height);
      this.uniform1f(this.#blurProgram, "u_radius", radiusPixels);
      this.uniform1i(this.#blurProgram, "u_image", 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.texture);
      gl.bindFramebuffer(gl.FRAMEBUFFER, blur.framebuffer);
      this.uniform2f(this.#blurProgram, "u_direction", 1, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindTexture(gl.TEXTURE_2D, blur.texture);
      this.uniform2f(this.#blurProgram, "u_direction", 0, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(this.#copyProgram.program);
      this.bindQuad(this.#copyProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, scene.texture);
      this.uniform1i(this.#copyProgram, "u_image", 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    this.#frame = requestAnimationFrame(this.render);
  };

  private applyGraphUniforms(program: ProgramInfo, compiled: CompiledGraph): void {
    const gl = this.#gl;
    for (const binding of compiled.uniforms) {
      const node = this.#graph.nodes.find((candidate) => candidate.id === binding.nodeId);
      if (!node) continue;
      const value = node.params[binding.paramId];
      const location = this.location(program, binding.name);
      if (binding.kind === "color" && typeof value === "string") {
        const [r,g,b] = hexToRgb(value);
        gl.uniform3f(location, r, g, b);
      } else if (binding.kind === "boolean") gl.uniform1f(location, value === true ? 1 : 0);
      else if (typeof value === "number") gl.uniform1f(location, value);
    }

    compiled.gradients.forEach((binding, index) => {
      const resource = this.#gradientResources.get(`${binding.nodeId}:${binding.paramId}`);
      if (!resource) return;
      const unit = index + 1;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, resource.texture);
      gl.uniform1i(this.location(program, binding.name), unit);
    });
  }

  private syncGradientResources(force = false): void {
    const compiled = this.#compiled;
    if (!compiled) return;
    const active = new Set(compiled.gradients.map((binding) => `${binding.nodeId}:${binding.paramId}`));
    for (const [key, resource] of this.#gradientResources) {
      if (!active.has(key)) { this.#gl.deleteTexture(resource.texture); this.#gradientResources.delete(key); }
    }
    for (const binding of compiled.gradients) {
      const key = `${binding.nodeId}:${binding.paramId}`;
      const node = this.#graph.nodes.find((candidate) => candidate.id === binding.nodeId);
      const stops = node?.params[binding.paramId];
      if (!Array.isArray(stops)) continue;
      const gradientKey = JSON.stringify(stops);
      let resource = this.#gradientResources.get(key);
      if (!resource) {
        const texture = this.#gl.createTexture();
        if (!texture) throw new Error("Unable to create a color-ramp texture");
        this.configureTexture(texture);
        resource = { texture, key: "" };
        this.#gradientResources.set(key, resource);
      }
      if (force || resource.key !== gradientKey) {
        this.uploadGradient(resource.texture, stops);
        resource.key = gradientKey;
      }
    }
  }

  private uploadGradient(texture: WebGLTexture, stops: GradientStop[]): void {
    const context = this.#gradientContext;
    const sorted = [...stops].sort((a,b) => a.position - b.position);
    context.clearRect(0,0,256,1);
    const gradient = context.createLinearGradient(0,0,256,0);
    if (sorted.length === 1) {
      gradient.addColorStop(0, sorted[0]!.color);
      gradient.addColorStop(1, sorted[0]!.color);
    } else sorted.forEach((stop) => gradient.addColorStop(stop.position, stop.color));
    context.fillStyle = gradient;
    context.fillRect(0,0,256,1);
    this.#gl.bindTexture(this.#gl.TEXTURE_2D, texture);
    this.#gl.texImage2D(this.#gl.TEXTURE_2D, 0, this.#gl.RGBA, this.#gl.RGBA, this.#gl.UNSIGNED_BYTE, this.#gradientCanvas);
  }

  private createProgram(vertexSource: string, fragmentSource: string): ProgramInfo {
    const gl = this.#gl;
    const vertex = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error("Unable to create WebGL program");
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "Unknown WebGL link error";
      gl.deleteProgram(program);
      throw new Error(message);
    }
    const position = gl.getAttribLocation(program, "a_position");
    if (position < 0) throw new Error("Fullscreen position attribute is missing");
    return { program, position, uniforms: new Map() };
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.#gl.createShader(type);
    if (!shader) throw new Error("Unable to create WebGL shader");
    this.#gl.shaderSource(shader, source);
    this.#gl.compileShader(shader);
    if (!this.#gl.getShaderParameter(shader, this.#gl.COMPILE_STATUS)) {
      const message = this.#gl.getShaderInfoLog(shader) || "Unknown WebGL compile error";
      this.#gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  private createTarget(width: number, height: number): RenderTarget {
    const texture = this.#gl.createTexture();
    const framebuffer = this.#gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error("Unable to create render target");
    this.configureTexture(texture);
    this.#gl.texImage2D(this.#gl.TEXTURE_2D, 0, this.#gl.RGBA, width, height, 0, this.#gl.RGBA, this.#gl.UNSIGNED_BYTE, null);
    this.#gl.bindFramebuffer(this.#gl.FRAMEBUFFER, framebuffer);
    this.#gl.framebufferTexture2D(this.#gl.FRAMEBUFFER, this.#gl.COLOR_ATTACHMENT0, this.#gl.TEXTURE_2D, texture, 0);
    if (this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER) !== this.#gl.FRAMEBUFFER_COMPLETE) throw new Error("Framebuffer is incomplete");
    return { framebuffer, texture };
  }

  private configureTexture(texture: WebGLTexture): void {
    const gl = this.#gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  private deleteTarget(target: RenderTarget | null): void {
    if (!target) return;
    this.#gl.deleteFramebuffer(target.framebuffer);
    this.#gl.deleteTexture(target.texture);
  }

  private bindQuad(program: ProgramInfo): void {
    this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, this.#quad);
    this.#gl.enableVertexAttribArray(program.position);
    this.#gl.vertexAttribPointer(program.position, 2, this.#gl.FLOAT, false, 0, 0);
  }

  private location(program: ProgramInfo, name: string): WebGLUniformLocation | null {
    if (program.uniforms.has(name)) return program.uniforms.get(name) ?? null;
    const location = this.#gl.getUniformLocation(program.program, name);
    program.uniforms.set(name, location);
    return location;
  }

  private uniform1f(program: ProgramInfo, name: string, value: number): void { this.#gl.uniform1f(this.location(program,name), value); }
  private uniform1i(program: ProgramInfo, name: string, value: number): void { this.#gl.uniform1i(this.location(program,name), value); }
  private uniform2f(program: ProgramInfo, name: string, x: number, y: number): void { this.#gl.uniform2f(this.location(program,name), x, y); }
}

function hexToRgb(hex: string): readonly [number, number, number] {
  return [Number.parseInt(hex.slice(1,3),16)/255, Number.parseInt(hex.slice(3,5),16)/255, Number.parseInt(hex.slice(5,7),16)/255];
}
