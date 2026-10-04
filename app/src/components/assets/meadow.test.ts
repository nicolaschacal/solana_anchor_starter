import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
const parsed = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("three/addons/loaders/GLTFLoader.js", () => ({
  GLTFLoader: class {
    setMeshoptDecoder() {
      return this;
    }
    parseAsync() {
      return parsed.load();
    }
  },
}));
beforeEach(() => {
  vi.resetModules();
  parsed.load.mockReset();
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({
        createRadialGradient: () => ({ addColorStop: () => undefined }),
        fillRect: () => undefined,
      }),
    }),
  });
});
afterEach(() => vi.unstubAllGlobals());
function model() {
  const scene = new THREE.Group(),
    geometry = new THREE.BoxGeometry(),
    texture = new THREE.Texture(),
    material = new THREE.MeshStandardMaterial({ map: texture });
  scene.add(new THREE.Mesh(geometry, material));
  return { scene, geometry, material, texture };
}
describe("CC0 environment lifecycle", () => {
  it("shares the download while keeping each view’s GPU resources independent", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(20),
      });
    vi.stubGlobal("fetch", fetch);
    const first = model(),
      second = model();
    parsed.load.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { meadow } = await import("./meadow");
    const a = meadow(new THREE.Scene(), "Day"),
      b = meadow(new THREE.Scene(), "Night");
    expect(await a.ready).toBe(true);
    expect(await b.ready).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const dispose = vi.spyOn(second.geometry, "dispose"),
      textureDispose = vi.spyOn(second.texture, "dispose");
    a.dispose();
    expect(dispose).not.toHaveBeenCalled();
    expect(textureDispose).not.toHaveBeenCalled();
    b.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
  it("disposes a late load rather than attaching it to an unmounted viewer", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(20),
        }),
    );
    const loaded = model(),
      dispose = vi.spyOn(loaded.geometry, "dispose"),
      textureDispose = vi.spyOn(loaded.texture, "dispose");
    let finish!: (value: typeof loaded) => void;
    parsed.load.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { meadow } = await import("./meadow");
    const scene = new THREE.Scene(),
      env = meadow(scene, "Day");
    await vi.waitFor(() => expect(parsed.load).toHaveBeenCalled());
    env.dispose();
    finish(loaded);
    expect(await env.ready).toBe(false);
    expect(scene.children).toHaveLength(0);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(textureDispose).toHaveBeenCalledTimes(1);
  });
  it("keeps the clearing and permits another download after a network failure", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(Error("offline"))
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(20),
      });
    vi.stubGlobal("fetch", fetch);
    parsed.load.mockResolvedValue(model());
    const { meadow } = await import("./meadow");
    const first = meadow(new THREE.Scene(), "Morning");
    expect(await first.ready).toBe(false);
    const second = meadow(new THREE.Scene(), "Evening");
    expect(await second.ready).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    first.dispose();
    second.dispose();
  });
});
