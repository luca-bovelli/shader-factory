import "./styles.css";
import { parseGraph, serializeGraph } from "./graph/codec";
import { createDefaultGraph } from "./graph/defaultGraph";
import { GraphStore } from "./graph/store";
import { GraphEditor } from "./editor/editor";
import { NodePalette } from "./editor/palette";
import { GraphRenderer } from "./renderer/renderer";

const element = <T extends Element>(selector: string): T => {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing element ${selector}`);
  return value;
};

const recoveryKey = "isosurface-node-studio:recovery";
let initialGraph = createDefaultGraph();
const recovered = sessionStorage.getItem(recoveryKey);
sessionStorage.removeItem(recoveryKey);
if (recovered) {
  try { initialGraph = parseGraph(recovered); }
  catch { /* Invalid recovery state should not prevent startup. */ }
}

const store = new GraphStore(initialGraph);
const toast = element<HTMLElement>("#toast");
const compileStatus = element<HTMLElement>("#compile-status");
const previewError = element<HTMLElement>("#preview-error");
let toastTimer = 0;

const showToast = (message: string, error = false): void => {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("is-error", error);
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2800);
};

const setCompileStatus = (message: string, isError: boolean): void => {
  compileStatus.classList.toggle("is-error", isError);
  element<HTMLElement>("#compile-status span").textContent = message;
  previewError.hidden = !isError;
  previewError.textContent = message;
};

const editor = new GraphEditor(store, {
  viewport: element("#graph-viewport"),
  world: element("#graph-world"),
  nodeLayer: element("#node-layer"),
  connectionLayer: element("#connection-layer"),
  zoomReadout: element("#zoom-readout"),
  onMessage: showToast,
});

const palette = new NodePalette(store, editor, {
  root: element("#node-palette"),
  list: element("#palette-list"),
  search: element("#node-search"),
  close: element("#close-palette"),
  onMessage: showToast,
});
editor.setPaletteOpener((clientX, clientY, graphX, graphY) => palette.open(clientX, clientY, graphX, graphY));

const renderer = new GraphRenderer(element("#preview-canvas"), store.snapshot, setCompileStatus);
store.subscribe((graph, change, selection) => {
  renderer.sync(graph, change);
  element<HTMLButtonElement>("#delete-selection").disabled = !selection;
});
renderer.start();
requestAnimationFrame(() => editor.frameAll(false));

element<HTMLButtonElement>("#add-node").addEventListener("click", (event) => {
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();
  const center = editor.viewportCenterInGraph();
  palette.open(rect.left, rect.bottom + 8, center.x, center.y);
});
element<HTMLButtonElement>("#frame-graph").addEventListener("click", () => editor.frameAll(true));
element<HTMLButtonElement>("#delete-selection").addEventListener("click", () => store.removeSelection());

const configDialog = element<HTMLDialogElement>("#config-dialog");
const configText = element<HTMLTextAreaElement>("#config-text");
element<HTMLButtonElement>("#open-config").addEventListener("click", () => {
  configText.value = serializeGraph(store.snapshot);
  configDialog.showModal();
});
element<HTMLButtonElement>("#copy-config").addEventListener("click", async () => {
  const text = serializeGraph(store.snapshot);
  configText.value = text;
  try { await navigator.clipboard.writeText(text); showToast("Graph copied"); }
  catch { configText.select(); document.execCommand("copy"); showToast("Graph selected and copied"); }
});
element<HTMLButtonElement>("#import-config").addEventListener("click", () => {
  try {
    store.replace(parseGraph(configText.value));
    configDialog.close();
    requestAnimationFrame(() => editor.frameAll(false));
    showToast("Graph loaded");
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to import graph", true);
  }
});

const previewPane = element<HTMLElement>("#preview-pane");
element<HTMLButtonElement>("#toggle-preview").addEventListener("click", (event) => {
  previewPane.classList.toggle("is-mobile-visible");
  (event.currentTarget as HTMLButtonElement).textContent = previewPane.classList.contains("is-mobile-visible") ? "Graph" : "Preview";
});

window.addEventListener("beforeunload", () => {
  sessionStorage.setItem(recoveryKey, serializeGraph(store.snapshot));
});
