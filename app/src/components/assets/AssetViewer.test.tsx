// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AssetViewer } from "./AssetViewer";
import { ScenePausedContext } from "./scene-visibility";
import type { AssetModel } from "../../lib/assets/rig";
import type { WorldPeriod } from "../../hooks/useWorldClock";

vi.mock("../../lib/assets/rig", () => ({
  disposeModel: vi.fn(),
  loader: vi.fn(),
  inspectModel: vi.fn(),
}));
const state = vi.hoisted(() => ({
  created: 0,
  disposed: 0,
  renders: 0,
  environmentDisposals: 0,
}));
vi.mock("three", async (original) => {
  const actual = await original<typeof import("three")>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement("canvas");
      shadowMap = { enabled: false, autoUpdate: true, needsUpdate: false };
      constructor() {
        state.created++;
      }
      setPixelRatio() {}
      setSize() {}
      render() {
        state.renders++;
      }
      dispose() {
        state.disposed++;
      }
      forceContextLoss() {}
    },
  };
});
vi.mock("three/addons/controls/OrbitControls.js", () => ({
  OrbitControls: class {
    target = new THREE.Vector3();
    update() {}
    dispose() {}
  },
}));
vi.mock("./meadow", () => ({
  meadow: () => ({
    colors: { light: 0xffffff, intensity: 2 },
    update: vi.fn(),
    dispose() {
      state.environmentDisposals++;
    },
  }),
}));
let host: HTMLDivElement, root: Root, model: AssetModel;
let sequence: number, frames: Map<number, FrameRequestCallback>;
beforeEach(() => {
  Object.assign(state, {
    created: 0,
    disposed: 0,
    renders: 0,
    environmentDisposals: 0,
  });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  frames = new Map();
  sequence = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(800);
  const scene = new THREE.Group();
  scene.add(
    new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()),
  );
  model = {
    scene,
    clips: [
      new THREE.AnimationClip("idle", 1, []),
      new THREE.AnimationClip("play", 1, []),
    ],
  } as AssetModel;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(
  action = "idle",
  sleeping = false,
  paused = false,
  period: WorldPeriod = "Day",
) {
  await act(async () =>
    root.render(
      <ScenePausedContext.Provider value={paused}>
        <AssetViewer
          model={model}
          landscape
          action={action}
          sleeping={sleeping}
          period={period}
        />
      </ScenePausedContext.Provider>,
    ),
  );
}
it("keeps the same renderer and canvas through actions, rest, panels and clock changes; stops and resumes frames", async () => {
  await render();
  const canvas = host.querySelector("canvas");
  expect(state.created).toBe(1);
  expect(frames.size).toBe(1);
  await render("play");
  expect(host.querySelector("canvas")).toBe(canvas);
  await render("idle", true);
  expect(frames.size).toBe(0);
  await render("idle", false, true);
  expect(frames.size).toBe(0);
  await render("idle", false, true, "Night");
  expect(state.created).toBe(1);
  expect(state.disposed).toBe(0);
  expect(state.environmentDisposals).toBe(1);
  await render("idle", false, false, "Night");
  expect(frames.size).toBe(1);
  const [id, callback] = [...frames.entries()][0];
  frames.delete(id);
  callback(performance.now());
  expect(state.renders).toBe(1);
  expect(host.querySelector("canvas")).toBe(canvas);
  await act(async () => root.unmount());
  expect(state.disposed).toBe(1);
  expect(frames.size).toBe(0);
});
