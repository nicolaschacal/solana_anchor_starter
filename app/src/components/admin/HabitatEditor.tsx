import {
  Box,
  Download,
  Droplets,
  FileJson,
  Grid3X3,
  Layers3,
  Monitor,
  Move3D,
  Paintbrush,
  Rotate3D,
  Save,
  Scale3D,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { MeshoptDecoder } from "meshoptimizer";
import { modelUriFor } from "../../lib/assets/catalog";
import { useEvolutionTree } from "../../hooks/useEvolutionTree";
import type { Registry } from "../../lib/rebyters/types";

type TransformMode = "translate" | "rotate" | "scale";
type PreviewMode = "web" | "mobile";
type EditorTool = "objects" | "raise" | "lower" | "smooth" | "flatten" | "paint";
type PaintMaterial = "grass" | "dirt" | "rock";

type HabitatObject = {
  id: string;
  name: string;
  asset: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

type WaterArea = {
  id: string;
  position: [number, number, number];
  size: [number, number];
};

type HabitatManifest = {
  schema: "rebyters-habitat-v2";
  id: string;
  name: string;
  terrain: {
    width: number;
    depth: number;
    segments: number;
    heights: number[];
    colors: number[];
  };
  objects: HabitatObject[];
  water: WaterArea[];
};

type HabitatAssetDefinition = {
  name: string;
  asset: string;
  category: "Terrain" | "Water" | "Nature" | "Background";
  targetExtent: number;
};

const TERRAIN_SEGMENTS = 36;
const LOCAL_REFERENCE_MODEL = "/assets/rebyters/mammal-current/companion.glb";
const STORAGE_KEY = "rebyters:habitat-editor:draft-v2";

const TERRAIN_COLORS: Record<PaintMaterial, THREE.Color> = {
  grass: new THREE.Color(0x6f9448),
  dirt: new THREE.Color(0x8e6b3d),
  rock: new THREE.Color(0x6f756e),
};

const BUILTIN_ASSETS: HabitatAssetDefinition[] = [
  { name: "Mountain ridge", asset: "/assets/environment/mountain_ridge_mobile.glb", category: "Background", targetExtent: 20 },
  { name: "Production mountains", asset: "/assets/environment/distant-mountains.glb", category: "Background", targetExtent: 12 },
  { name: "Distant mountains", asset: "/assets/environment/distant-mountains.glb", category: "Background", targetExtent: 13 },
  { name: "Hero tree", asset: "/assets/environment/hero_tree_mobile.glb", category: "Nature", targetExtent: 4.8 },
  { name: "Pine tree", asset: "/assets/environment/pine-tree.glb", category: "Nature", targetExtent: 2.8 },
  { name: "Deciduous tree", asset: "/assets/environment/deciduous-tree.glb", category: "Nature", targetExtent: 3.2 },
  { name: "Berry bush", asset: "/assets/environment/berry-bush.glb", category: "Nature", targetExtent: 1.7 },
  { name: "Mossy rocks", asset: "/assets/environment/mossy-rocks.glb", category: "Nature", targetExtent: 1.6 },
  { name: "Shore rocks", asset: "/assets/environment/shore_rocks_strip_mobile.glb", category: "Nature", targetExtent: 3.4 },
  { name: "Tree stump", asset: "/assets/environment/tree-stump.glb", category: "Nature", targetExtent: 1.4 },
  { name: "Hollow log", asset: "/assets/environment/hollow-log.glb", category: "Nature", targetExtent: 1.8 },
  { name: "Red mushrooms", asset: "/assets/environment/red-mushrooms.glb", category: "Nature", targetExtent: 1.1 },
  { name: "Grass clump", asset: "/assets/environment/grass_clump_mobile.glb", category: "Nature", targetExtent: 0.8 },
  { name: "Water reeds", asset: "/assets/environment/water_reeds_mobile.glb", category: "Nature", targetExtent: 1.35 },
  { name: "Wildflowers", asset: "/assets/environment/wildflowers_mobile.glb", category: "Nature", targetExtent: 1.15 },
  { name: "Enchanted lantern", asset: "/assets/environment/enchanted_lantern_mobile.glb", category: "Nature", targetExtent: 1.1 },
  { name: "Grass tile", asset: "/assets/environment/grass-tile.glb", category: "Terrain", targetExtent: 7 },
  { name: "Dirt transition", asset: "/assets/environment/dirt-transition.glb", category: "Terrain", targetExtent: 7 },
  { name: "Water tile", asset: "/assets/environment/water-center.glb", category: "Water", targetExtent: 8 },
  { name: "Water shore", asset: "/assets/environment/water-shore-straight.glb", category: "Water", targetExtent: 8 },
];

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled-habitat"
  );
}

function objectToRecord(object: THREE.Object3D): HabitatObject {
  return {
    id: object.userData.habitatId,
    name: object.userData.habitatName,
    asset: object.userData.asset,
    position: [object.position.x, object.position.y, object.position.z],
    rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
    scale: [object.scale.x, object.scale.y, object.scale.z],
  };
}

function buildTerrain(width: number, depth: number) {
  const geometry = new THREE.PlaneGeometry(
    width,
    depth,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const count = geometry.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = TERRAIN_COLORS.grass.r;
    colors[i * 3 + 1] = TERRAIN_COLORS.grass.g;
    colors[i * 3 + 2] = TERRAIN_COLORS.grass.b;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function waterMaterial() {
  return new THREE.MeshStandardMaterial({
    color: 0x2a9bb0,
    roughness: 0.18,
    metalness: 0.05,
    transparent: true,
    opacity: 0.82,
  });
}

export function HabitatEditor({ registry }: { registry: Registry }) {
  const atlas = useEvolutionTree(0, registry.activeVersions[0] ?? 0, false);
  const mammalExe = atlas.tree?.evolutions.find(
    (e) => e.key === "mammal.exe" || e.name.toLowerCase() === "mammal.exe",
  );
  const referenceModelUri = mammalExe ? modelUriFor(mammalExe) : "";

  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const objectRootRef = useRef<THREE.Group | null>(null);
  const waterRootRef = useRef<THREE.Group | null>(null);
  const terrainRef = useRef<THREE.Mesh | null>(null);
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const selectedRef = useRef<THREE.Object3D | null>(null);
  const loaderRef = useRef(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const referenceSizeRef = useRef(new THREE.Vector3(1, 1, 1));
  const resizePreviewRef = useRef<() => void>(() => {});
  const importedUrls = useRef<string[]>([]);
  const brushDown = useRef(false);
  const flattenHeight = useRef(0);
  const toolRef = useRef<EditorTool>("objects");
  const paintMaterialRef = useRef<PaintMaterial>("grass");
  const brushSizeRef = useRef(2.4);
  const brushStrengthRef = useRef(0.18);

  const [name, setName] = useState("My Habitat");
  const [groundWidth, setGroundWidth] = useState(24);
  const [groundDepth, setGroundDepth] = useState(24);
  const [objects, setObjects] = useState<HabitatObject[]>([]);
  const [waterAreas, setWaterAreas] = useState<WaterArea[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<TransformMode>("translate");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("web");
  const [tool, setTool] = useState<EditorTool>("objects");
  const [paintMaterial, setPaintMaterial] = useState<PaintMaterial>("grass");
  const [brushSize, setBrushSize] = useState(2.4);
  const [brushStrength, setBrushStrength] = useState(0.18);
  const [status, setStatus] = useState(
    "Build a habitat with editable terrain, water and modular props.",
  );

  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { paintMaterialRef.current = paintMaterial; }, [paintMaterial]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { brushStrengthRef.current = brushStrength; }, [brushStrength]);

  const syncObjects = () => {
    const root = objectRootRef.current;
    if (!root) return;
    setObjects(root.children.map(objectToRecord));
  };

  const syncWater = () => {
    const root = waterRootRef.current;
    if (!root) return;
    setWaterAreas(
      root.children.map((object) => ({
        id: object.userData.waterId,
        position: [object.position.x, object.position.y, object.position.z],
        size: [object.scale.x, object.scale.y],
      })),
    );
  };

  const serializeTerrain = () => {
    const terrain = terrainRef.current;
    if (!terrain) return { heights: [], colors: [] };
    const position = terrain.geometry.attributes.position as THREE.BufferAttribute;
    const color = terrain.geometry.attributes.color as THREE.BufferAttribute;
    return {
      heights: Array.from({ length: position.count }, (_, i) =>
        Number(position.getY(i).toFixed(4)),
      ),
      colors: Array.from(color.array as ArrayLike<number>, (n) =>
        Number(Number(n).toFixed(4)),
      ),
    };
  };

  const buildManifest = (): HabitatManifest => {
    const terrain = serializeTerrain();
    return {
      schema: "rebyters-habitat-v2",
      id: slug(name),
      name: name.trim() || "Untitled Habitat",
      terrain: {
        width: groundWidth,
        depth: groundDepth,
        segments: TERRAIN_SEGMENTS,
        ...terrain,
      },
      objects: objectRootRef.current?.children.map(objectToRecord) ?? objects,
      water:
        waterRootRef.current?.children.map((object) => ({
          id: object.userData.waterId,
          position: [object.position.x, object.position.y, object.position.z],
          size: [object.scale.x, object.scale.y],
        })) ?? waterAreas,
    };
  };

  useEffect(() => {
    const host = mount.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x9bcbe7);
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
    cameraRef.current = camera;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x49634b, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 10, 5);
    sun.castShadow = true;
    scene.add(sun);

    const terrain = new THREE.Mesh(
      buildTerrain(groundWidth, groundDepth),
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.96,
        metalness: 0,
      }),
    );
    terrain.receiveShadow = true;
    terrain.name = "HabitatTerrain";
    scene.add(terrain);
    terrainRef.current = terrain;

    // Keep the editor grid exactly aligned with the editable terrain.
    // A unit grid scaled to Width/Depth avoids the old 40x40 grid extending
    // beyond a smaller terrain and looking like the ground was cut in half.
    const grid = new THREE.GridHelper(1, TERRAIN_SEGMENTS, 0x6f9278, 0xb5c8ba);
    grid.scale.set(groundWidth, 1, groundDepth);
    grid.position.y = 0.015;
    scene.add(grid);
    gridRef.current = grid;

    const objectRoot = new THREE.Group();
    objectRoot.name = "HabitatObjects";
    scene.add(objectRoot);
    objectRootRef.current = objectRoot;

    const waterRoot = new THREE.Group();
    waterRoot.name = "HabitatWater";
    scene.add(waterRoot);
    waterRootRef.current = waterRoot;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode(mode);
    transform.addEventListener("objectChange", () => {
      syncObjects();
      syncWater();
    });
    scene.add(transform.getHelper());
    transformRef.current = transform;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const terrainHit = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return raycaster.intersectObject(terrain, false)[0] ?? null;
    };

    const applyBrush = (event: PointerEvent, initial = false) => {
      const hit = terrainHit(event);
      if (!hit) return;
      const geometry = terrain.geometry;
      const position = geometry.attributes.position as THREE.BufferAttribute;
      const color = geometry.attributes.color as THREE.BufferAttribute;
      const local = terrain.worldToLocal(hit.point.clone());

      if (initial && toolRef.current === "flatten") flattenHeight.current = local.y;

      const nextHeights = new Float32Array(position.count);
      for (let i = 0; i < position.count; i++) nextHeights[i] = position.getY(i);

      for (let i = 0; i < position.count; i++) {
        const dx = position.getX(i) - local.x;
        const dz = position.getZ(i) - local.z;
        const distance = Math.hypot(dx, dz);
        if (distance > brushSizeRef.current) continue;
        const falloff = Math.pow(1 - distance / brushSizeRef.current, 2);
        const amount = brushStrengthRef.current * falloff;

        if (toolRef.current === "raise") nextHeights[i] += amount;
        if (toolRef.current === "lower") nextHeights[i] -= amount;
        if (toolRef.current === "flatten")
          nextHeights[i] = THREE.MathUtils.lerp(
            nextHeights[i],
            flattenHeight.current,
            Math.min(1, amount * 2.5),
          );

        if (toolRef.current === "paint") {
          const target = TERRAIN_COLORS[paintMaterialRef.current];
          color.setXYZ(
            i,
            THREE.MathUtils.lerp(color.getX(i), target.r, Math.min(1, amount * 3)),
            THREE.MathUtils.lerp(color.getY(i), target.g, Math.min(1, amount * 3)),
            THREE.MathUtils.lerp(color.getZ(i), target.b, Math.min(1, amount * 3)),
          );
        }
      }

      if (toolRef.current === "smooth") {
        const cols = TERRAIN_SEGMENTS + 1;
        for (let i = 0; i < position.count; i++) {
          const x = position.getX(i) - local.x;
          const z = position.getZ(i) - local.z;
          const distance = Math.hypot(x, z);
          if (distance > brushSizeRef.current) continue;
          const row = Math.floor(i / cols);
          const col = i % cols;
          let sum = 0;
          let count = 0;
          for (let rr = -1; rr <= 1; rr++) {
            for (let cc = -1; cc <= 1; cc++) {
              const r = row + rr;
              const c = col + cc;
              if (r < 0 || r >= cols || c < 0 || c >= cols) continue;
              sum += position.getY(r * cols + c);
              count++;
            }
          }
          const falloff = Math.pow(1 - distance / brushSizeRef.current, 2);
          nextHeights[i] = THREE.MathUtils.lerp(
            position.getY(i),
            sum / Math.max(1, count),
            Math.min(1, brushStrengthRef.current * falloff * 4),
          );
        }
      }

      if (toolRef.current !== "paint") {
        for (let i = 0; i < position.count; i++) position.setY(i, nextHeights[i]);
        position.needsUpdate = true;
        geometry.computeVertexNormals();
      } else {
        color.needsUpdate = true;
      }
    };

    const onPointerDown = (event: PointerEvent) => {
      if ((transform as any).dragging) return;

      if (toolRef.current !== "objects") {
        brushDown.current = true;
        applyBrush(event, true);
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const candidates = [
        ...(objectRootRef.current?.children ?? []),
        ...(waterRootRef.current?.children ?? []),
      ];
      const hits = raycaster.intersectObjects(candidates, true);
      if (!hits.length) {
        selectedRef.current = null;
        transform.detach();
        setSelectedId("");
        return;
      }

      let object: THREE.Object3D | null = hits[0].object;
      while (
        object &&
        object.parent !== objectRootRef.current &&
        object.parent !== waterRootRef.current
      )
        object = object.parent;

      if (!object) return;
      selectedRef.current = object;
      transform.attach(object);
      setSelectedId(object.userData.habitatId ?? object.userData.waterId ?? "");
    };

    const onPointerMove = (event: PointerEvent) => {
      if (brushDown.current && toolRef.current !== "objects") applyBrush(event, false);
    };
    const onPointerUp = () => {
      brushDown.current = false;
    };

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    const frameCamera = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;

      const sourceSize = referenceSizeRef.current;
      const framingScale =
        2 / Math.max(sourceSize.x, sourceSize.y, sourceSize.z, 0.001);
      const distance = Math.max(
        camera.aspect < 1 ? 4.8 : 6.8,
        (sourceSize.x * framingScale) /
          (2 *
            Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
            camera.aspect *
            (w <= 700 ? 0.42 : 0.54)),
      );
      const direction = new THREE.Vector3(0, 2.2, 4.7)
        .sub(new THREE.Vector3(0, 1.6, 0))
        .normalize();
      const target = new THREE.Vector3(
        0,
        1.6 + (camera.aspect < 1 ? 0.7 + 1.25 * 0.22 : 0),
        0,
      );
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    resizePreviewRef.current = frameCamera;

    const observer = new ResizeObserver(frameCamera);
    observer.observe(host);
    frameCamera();

    let raf = 0;
    const render = () => {
      renderer.render(scene, camera);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      transform.dispose();
      resizePreviewRef.current = () => {};
      cameraRef.current = null;
      terrain.geometry.dispose();
      (terrain.material as THREE.Material).dispose();
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      gridRef.current = null;
      waterRoot.children.forEach((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material)?.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      importedUrls.current.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    transformRef.current?.setMode(mode);
  }, [mode]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || !referenceModelUri) return;
    let cancelled = false;
    let loaded: THREE.Object3D | null = null;

    const loadReference = async () => {
      try {
        return await loaderRef.current.loadAsync(LOCAL_REFERENCE_MODEL);
      } catch {
        return loaderRef.current.loadAsync(referenceModelUri);
      }
    };

    void loadReference()
      .then((gltf) => {
        if (cancelled) return;
        const root = gltf.scene;
        root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(root);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        referenceSizeRef.current.copy(size);
        const framingScale =
          2 / Math.max(size.x, size.y, size.z, 0.001);
        const scale = framingScale * 0.8;
        root.scale.setScalar(scale);
        root.position.set(
          -center.x * scale,
          -bounds.min.y * scale + 0.04,
          -center.z * scale - 2.97,
        );
        root.userData.habitatReference = true;
        root.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        });
        loaded = root;
        scene.add(root);
        resizePreviewRef.current();
        setStatus("mammal.exe loaded for habitat preview.");
      })
      .catch(() =>
        setStatus(
          "mammal.exe preview missing. Add companion.glb to /public/assets/rebyters/mammal-current/ or check the Atlas URI.",
        ),
      );

    return () => {
      cancelled = true;
      loaded?.removeFromParent();
    };
  }, [referenceModelUri]);

  useEffect(() => {
    const terrain = terrainRef.current;
    if (!terrain) return;
    const old = terrain.geometry;
    const next = buildTerrain(groundWidth, groundDepth);
    const oldPosition = old.attributes.position as THREE.BufferAttribute;
    const oldColor = old.attributes.color as THREE.BufferAttribute;
    const nextPosition = next.attributes.position as THREE.BufferAttribute;
    const nextColor = next.attributes.color as THREE.BufferAttribute;

    if (oldPosition.count === nextPosition.count) {
      for (let i = 0; i < nextPosition.count; i++) {
        nextPosition.setY(i, oldPosition.getY(i));
        nextColor.setXYZ(i, oldColor.getX(i), oldColor.getY(i), oldColor.getZ(i));
      }
      nextPosition.needsUpdate = true;
      nextColor.needsUpdate = true;
      next.computeVertexNormals();
    }
    terrain.geometry = next;
    old.dispose();
    gridRef.current?.scale.set(groundWidth, 1, groundDepth);
  }, [groundWidth, groundDepth]);

  async function loadHabitatAsset(asset: string, displayName: string) {
    const gltf = await loaderRef.current.loadAsync(asset);
    const root = gltf.scene;
    root.userData.habitatId = crypto.randomUUID();
    root.userData.habitatName = displayName;
    root.userData.asset = asset;
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 0.001);
    const definition = BUILTIN_ASSETS.find((item) => item.asset === asset);
    const targetExtent = definition?.targetExtent ?? 2.4;
    const normalized = Math.min(targetExtent / extent, definition ? 3.5 : 1.6);
    root.scale.setScalar(normalized);
    root.position.set(
      -center.x * normalized,
      -box.min.y * normalized,
      -center.z * normalized,
    );
    return root;
  }

  async function loadProductionAsset(asset: string, displayName: string, height: number) {
    const gltf = await loaderRef.current.loadAsync(asset);
    const source = gltf.scene;
    source.userData.habitatId = crypto.randomUUID();
    source.userData.habitatName = displayName;
    source.userData.asset = asset;
    source.updateMatrixWorld(true);

    const bounds = new THREE.Box3().setFromObject(source);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = height / Math.max(size.y, 0.001);

    const pivot = new THREE.Group();
    pivot.userData.habitatId = source.userData.habitatId;
    pivot.userData.habitatName = displayName;
    pivot.userData.asset = asset;
    source.scale.multiplyScalar(scale);
    source.position.multiplyScalar(scale);
    source.position.add(
      new THREE.Vector3(-center.x, -bounds.min.y, -center.z).multiplyScalar(scale),
    );
    source.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    pivot.add(source);
    return pivot;
  }

  async function addAsset(asset: string, displayName: string) {
    try {
      setTool("objects");
      const root = await loadHabitatAsset(asset, displayName);
      objectRootRef.current?.add(root);
      selectedRef.current = root;
      transformRef.current?.attach(root);
      setSelectedId(root.userData.habitatId);
      syncObjects();
      setStatus(`${displayName} added.`);
    } catch {
      setStatus(`Could not load ${displayName}.`);
    }
  }

  function addWater() {
    const root = waterRootRef.current;
    if (!root) return;
    setTool("objects");
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), waterMaterial());
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0.06, -4);
    mesh.scale.set(6, 3.5, 1);
    mesh.userData.waterId = crypto.randomUUID();
    root.add(mesh);
    selectedRef.current = mesh;
    transformRef.current?.attach(mesh);
    setSelectedId(mesh.userData.waterId);
    syncWater();
    setStatus("Water surface added. Move and scale it like any other object.");
  }

  async function loadExampleHabitat() {
    const root = objectRootRef.current;
    const waterRoot = waterRootRef.current;
    const terrain = terrainRef.current;
    if (!root || !waterRoot || !terrain) return;

    if (
      (root.children.length || waterRoot.children.length) &&
      !window.confirm("Replace current scene with the exact production meadow layout?")
    )
      return;

    setStatus("Loading the production Rebyters meadow…");
    setTool("objects");
    transformRef.current?.detach();
    selectedRef.current = null;
    setSelectedId("");
    root.clear();
    waterRoot.clear();

    // Production uses a 120x120 world. Keep the editor in the same coordinate system.
    setGroundWidth(120);
    setGroundDepth(120);
    gridRef.current?.scale.set(120, 1, 120);

    const oldGeometry = terrain.geometry;
    const geometry = buildTerrain(120, 120);
    const position = geometry.attributes.position as THREE.BufferAttribute;
    const color = geometry.attributes.color as THREE.BufferAttribute;

    // Same production terrain rule: flat playable clearing, gentle relief only far away.
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i);
      const z = position.getZ(i);
      const distance = Math.hypot(x, z);
      const relief =
        distance <= 28
          ? 0
          : (Math.sin(x * 0.14) + Math.cos(z * 0.12)) *
            Math.min(0.7, (distance - 28) * 0.018);
      position.setY(i, relief);
      color.setXYZ(
        i,
        TERRAIN_COLORS.grass.r,
        TERRAIN_COLORS.grass.g,
        TERRAIN_COLORS.grass.b,
      );
    }
    position.needsUpdate = true;
    color.needsUpdate = true;
    geometry.computeVertexNormals();
    terrain.geometry = geometry;
    oldGeometry.dispose();

    // Exact irregular lake silhouette from meadow.ts.
    const lakeShape = new THREE.Shape();
    lakeShape.moveTo(-7, -2.6);
    lakeShape.bezierCurveTo(-8, -0.5, -4, 2.4, -1.4, 2.7);
    lakeShape.bezierCurveTo(2.5, 3.5, 8, 2.6, 8.8, 0.3);
    lakeShape.bezierCurveTo(9.5, -2.7, 3, -3.1, -0.6, -2.6);
    lakeShape.bezierCurveTo(-3.5, -3.6, -6, -3.4, -7, -2.6);
    const lakeGeometry = new THREE.ShapeGeometry(lakeShape, 28);

    const bank = new THREE.Mesh(
      lakeGeometry.clone(),
      new THREE.MeshStandardMaterial({ color: 0x64805b, roughness: 1 }),
    );
    bank.rotation.x = -Math.PI / 2;
    bank.position.set(1, 0.035, -13);
    bank.scale.set(1.035, 1.045, 1);
    bank.userData.waterId = crypto.randomUUID();
    waterRoot.add(bank);

    const lake = new THREE.Mesh(lakeGeometry, waterMaterial());
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(1, 0.05, -13);
    lake.userData.waterId = crypto.randomUUID();
    waterRoot.add(lake);

    // Exact production trail shape and placement.
    const trail = new THREE.Shape();
    trail.moveTo(1.1, 2);
    trail.bezierCurveTo(2.9, 4, 1.6, 5.4, 3.1, 7.4);
    trail.bezierCurveTo(4.5, 8.7, 4.5, 9.2, 4.7, 10);
    trail.lineTo(5.1, 10);
    trail.bezierCurveTo(5, 8.7, 5.3, 8.4, 3.8, 7.1);
    trail.bezierCurveTo(2.5, 5.3, 4.4, 3.5, 2.3, 2);
    trail.closePath();
    const pathMesh = new THREE.Mesh(
      new THREE.ShapeGeometry(trail, 24),
      new THREE.MeshStandardMaterial({ color: 0xb6a777, roughness: 1 }),
    );
    pathMesh.rotation.x = -Math.PI / 2;
    pathMesh.position.y = 0.018;
    pathMesh.userData.habitatId = crypto.randomUUID();
    pathMesh.userData.habitatName = "Production trail";
    pathMesh.userData.asset = "__production_trail__";
    root.add(pathMesh);

    const byName = (name: string) =>
      BUILTIN_ASSETS.find((item) => item.name === name)!;

    const plant = async (
      name: string,
      x: number,
      z: number,
      h: number,
      r = 0,
    ) => {
      const def = byName(name);
      if (!def) return null;
      try {
        const object = await loadProductionAsset(def.asset, def.name, h);
        object.position.x += x;
        object.position.z += z;
        object.rotation.y = r;
        root.add(object);
        return object;
      } catch {
        return null;
      }
    };

    // Same deterministic random sequence used by production.
    let seed = 12345;
    const rand = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Production mountain placement. This intentionally uses the current production
    // mountain asset, not the experimental replacement, so the editor is a true baseline.
    for (const [x, z, h, r] of [
      [-8, -32, 10, 0.25],
      [7, -28, 8.5, 2.6],
      [0, -43, 12, 0.1],
    ] as const) {
      const mountain = await plant("Production mountains", x, z, h, r);
      if (mountain) {
        mountain.updateMatrixWorld(true);
        const extent = new THREE.Box3()
          .setFromObject(mountain)
          .getSize(new THREE.Vector3());
        mountain.scale.x = 25 / Math.max(extent.x, 0.001);
        mountain.scale.z = 5 / Math.max(extent.z, 0.001);
      }
    }

    // Same far woodland distribution. Use desktop density because the editor is
    // intended to show the full production composition; mobile can still preview its crop.
    const forest = 18;
    for (let i = 0; i < forest; i++) {
      const x = -13 + (i * 26) / (forest - 1);
      await plant(
        i % 3 === 0 ? "Deciduous tree" : "Pine tree",
        x,
        -19 - rand() * 5,
        2.8 + rand() * 2.8,
        rand() * 6,
      );
    }

    // Exact middle-ground and outer-wing landmarks.
    await plant("Deciduous tree", -3.0, -5.8, 6.6, 0.28);
    await plant("Pine tree", 3.3, -7.6, 6.0, -0.35);
    await plant("Deciduous tree", -6.8, -11, 5.0, 0.7);
    await plant("Pine tree", 7.8, -13.5, 4.9, 0.5);
    await plant("Pine tree", -3.8, -15.8, 3.6, 0.2);
    await plant("Deciduous tree", 5.8, -18, 3.4, 2.4);
    await plant("Deciduous tree", -10, -5, 7.8, -0.3);
    await plant("Pine tree", 10.7, -7, 7.0, 0.4);

    for (const [x, z, h] of [
      [-2.9, -3.2, 1.0],
      [3.2, -4.2, 1.2],
      [-4.8, -7, 1.2],
      [5.2, -8, 0.9],
      [-1.95, 1.5, 0.65],
      [2.05, 1.0, 0.7],
      [-7, 0, 1.5],
      [7.3, -1, 1.3],
    ] as const) {
      await plant("Berry bush", x, z, h, rand() * 6);
    }

    await plant("Mossy rocks", 2.5, -2.7, 0.6, -0.4);
    await plant("Mossy rocks", -2.2, 1.4, 0.43, 0.6);
    await plant("Mossy rocks", 3.4, -9.7, 0.7, 0.4);
    await plant("Tree stump", -2.6, -1.6, 0.65, 0.3);
    await plant("Hollow log", 3.4, -5.2, 0.65, -0.8);
    await plant("Red mushrooms", -1.75, -0.7, 0.28, 0.2);
    await plant("Red mushrooms", 2.25, 0.5, 0.22, -0.3);

    syncObjects();
    syncWater();
    setStatus("Production meadow loaded exactly from meadow.ts layout.");
  }

  function deleteSelected() {
    const selected = selectedRef.current;
    if (!selected) return;
    transformRef.current?.detach();
    selected.removeFromParent();
    selectedRef.current = null;
    setSelectedId("");
    syncObjects();
    syncWater();
  }

  function saveDraft() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildManifest()));
    setStatus("Habitat draft saved in this browser.");
  }

  async function restoreDraft() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setStatus("No saved habitat draft found.");
      return;
    }
    try {
      const saved = JSON.parse(raw) as HabitatManifest;
      setName(saved.name);
      setGroundWidth(saved.terrain.width);
      setGroundDepth(saved.terrain.depth);

      const terrain = terrainRef.current;
      if (terrain && saved.terrain.heights.length) {
        const position = terrain.geometry.attributes.position as THREE.BufferAttribute;
        const color = terrain.geometry.attributes.color as THREE.BufferAttribute;
        saved.terrain.heights.forEach((height, i) => {
          if (i < position.count) position.setY(i, height);
        });
        saved.terrain.colors.forEach((value, i) => {
          if (i < color.array.length) color.array[i] = value;
        });
        position.needsUpdate = true;
        color.needsUpdate = true;
        terrain.geometry.computeVertexNormals();
      }

      objectRootRef.current?.clear();
      for (const item of saved.objects) {
        const object = await loadHabitatAsset(item.asset, item.name);
        object.userData.habitatId = item.id;
        object.position.fromArray(item.position);
        object.rotation.set(...item.rotation);
        object.scale.fromArray(item.scale);
        objectRootRef.current?.add(object);
      }

      waterRootRef.current?.clear();
      for (const area of saved.water) {
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), waterMaterial());
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.fromArray(area.position);
        mesh.scale.set(area.size[0], area.size[1], 1);
        mesh.userData.waterId = area.id;
        waterRootRef.current?.add(mesh);
      }

      syncObjects();
      syncWater();
      setStatus("Saved habitat restored.");
    } catch {
      setStatus("Saved habitat could not be restored.");
    }
  }

  function exportManifest() {
    download(
      new Blob([JSON.stringify(buildManifest(), null, 2)], { type: "application/json" }),
      `${buildManifest().id}.habitat.json`,
    );
  }

  async function exportGlb() {
    const scene = new THREE.Scene();
    scene.name = "RebytersHabitat";

    if (terrainRef.current) {
      const terrain = terrainRef.current.clone();
      terrain.geometry = terrainRef.current.geometry.clone();
      terrain.material = (terrainRef.current.material as THREE.Material).clone();
      scene.add(terrain);
    }

    objectRootRef.current?.children.forEach((object) =>
      scene.add(object.clone(true)),
    );
    waterRootRef.current?.children.forEach((object) =>
      scene.add(object.clone(true)),
    );

    const exporter = new GLTFExporter();
    const data = await exporter.parseAsync(scene, { binary: true });
    download(
      new Blob([data as ArrayBuffer], { type: "model/gltf-binary" }),
      `${buildManifest().id}.glb`,
    );
  }

  function importCustom(file: File) {
    const url = URL.createObjectURL(file);
    importedUrls.current.push(url);
    void addAsset(url, file.name.replace(/\.glb$/i, ""));
  }

  const selectedName =
    objects.find((item) => item.id === selectedId)?.name ??
    (waterAreas.some((item) => item.id === selectedId) ? "Water" : "Nothing selected");

  return (
    <section className="habitat-editor">
      <header className="habitat-editor-heading">
        <div>
          <span className="eyebrow">REBYTERS / WORLD BUILDING</span>
          <h1>Habitat Editor</h1>
          <p>
            Sculpt terrain, paint surfaces, add water and compose modular scenery
            around the fixed Rebyter camera.
          </p>
        </div>
        <div className="habitat-heading-actions">
          <button onClick={() => void restoreDraft()}>Restore</button>
          <button onClick={saveDraft}><Save size={15}/>Save draft</button>
        </div>
      </header>

      <div className="habitat-toolbar habitat-toolbar-multiline">
        <div className="habitat-toolset">
          <button className={tool === "objects" ? "active" : ""} onClick={() => setTool("objects")}><Move3D size={16}/>Objects</button>
          <button className={tool === "raise" ? "active" : ""} onClick={() => setTool("raise")}><Layers3 size={16}/>Raise</button>
          <button className={tool === "lower" ? "active" : ""} onClick={() => setTool("lower")}><Layers3 size={16}/>Lower</button>
          <button className={tool === "smooth" ? "active" : ""} onClick={() => setTool("smooth")}><Waves size={16}/>Smooth</button>
          <button className={tool === "flatten" ? "active" : ""} onClick={() => setTool("flatten")}><Grid3X3 size={16}/>Flatten</button>
          <button className={tool === "paint" ? "active" : ""} onClick={() => setTool("paint")}><Paintbrush size={16}/>Paint</button>
          <button onClick={addWater}><Droplets size={16}/>Add water</button>
        </div>

        <div className="habitat-preview-switch">
          <button className={previewMode === "web" ? "active" : ""} onClick={() => setPreviewMode("web")}><Monitor size={15}/>Web</button>
          <button className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}><Smartphone size={15}/>Mobile</button>
        </div>

        <span>{status}</span>
      </div>

      {tool !== "objects" && (
        <div className="terrain-controls">
          <strong>Terrain brush</strong>
          <label>Size <input type="range" min="0.6" max="5" step="0.1" value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))}/><span>{brushSize.toFixed(1)}</span></label>
          <label>Strength <input type="range" min="0.03" max="0.5" step="0.01" value={brushStrength} onChange={(e) => setBrushStrength(Number(e.target.value))}/><span>{brushStrength.toFixed(2)}</span></label>
          {tool === "paint" && (
            <div className="terrain-paints">
              {(["grass", "dirt", "rock"] as PaintMaterial[]).map((item) => (
                <button key={item} className={paintMaterial === item ? "active" : ""} onClick={() => setPaintMaterial(item)}>{item}</button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="habitat-layout">
        <aside className="habitat-library">
          <div>
            <span className="eyebrow">ASSET LIBRARY</span>
            <h2>Environment</h2>
            <p>Use sculpt + paint for the ground. Props stay modular.</p>
            <button className="habitat-randomize" onClick={() => void loadExampleHabitat()}><Sparkles size={16}/>Load example habitat</button>
          </div>

          <div className="habitat-assets">
            {(["Background", "Nature", "Terrain", "Water"] as const).map((category) => (
              <div className="habitat-asset-group" key={category}>
                <small>{category}</small>
                {BUILTIN_ASSETS.filter((item) => item.category === category).map((item) => (
                  <button key={item.asset} onClick={() => void addAsset(item.asset, item.name)}>
                    <Box size={18}/><span>{item.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <label className="habitat-import">
            <Upload size={16}/>Import custom GLB
            <input type="file" accept=".glb,model/gltf-binary" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) importCustom(file);
            }}/>
          </label>
        </aside>

        <div className={`habitat-stage preview-${previewMode}`}>
          <div className="habitat-preview-frame">
            <div ref={mount} className="habitat-canvas" />
            <div className="habitat-safe habitat-safe-top"><span>TOP GUI SAFE AREA</span></div>
            <div className="habitat-safe habitat-safe-bottom"><span>ACTIONS + NAV SAFE AREA</span></div>
            <div className="habitat-companion-guide"><span>REBYTER ZONE</span></div>
          </div>
          <div className="habitat-stage-hint">
            {tool === "objects"
              ? "Fixed player camera · select props to transform"
              : "Drag directly over the terrain to edit it"}
          </div>
        </div>

        <aside className="habitat-inspector">
          <div>
            <span className="eyebrow">HABITAT</span>
            <h2>Scene settings</h2>
          </div>

          <label>Habitat name<input value={name} onChange={(e) => setName(e.target.value)}/></label>

          <div className="habitat-ground-grid">
            <label>Width<input type="number" min={4} max={100} value={groundWidth} onChange={(e) => setGroundWidth(Number(e.target.value) || 4)}/></label>
            <label>Depth<input type="number" min={4} max={100} value={groundDepth} onChange={(e) => setGroundDepth(Number(e.target.value) || 4)}/></label>
          </div>

          <div className="habitat-summary">
            <Grid3X3 size={17}/>
            <div>
              <strong>{objects.length} props · {waterAreas.length} water</strong>
              <small>{TERRAIN_SEGMENTS}×{TERRAIN_SEGMENTS} editable terrain</small>
            </div>
          </div>

          <div className="habitat-selected">
            <small>SELECTED OBJECT</small>
            <strong>{selectedName}</strong>
          </div>

          {tool === "objects" && (
            <>
              <div className="habitat-inspector-tools">
                <button className={mode === "translate" ? "active" : ""} onClick={() => setMode("translate")}><Move3D size={15}/>Move</button>
                <button className={mode === "rotate" ? "active" : ""} onClick={() => setMode("rotate")}><Rotate3D size={15}/>Rotate</button>
                <button className={mode === "scale" ? "active" : ""} onClick={() => setMode("scale")}><Scale3D size={15}/>Scale</button>
              </div>
              <button disabled={!selectedId} onClick={deleteSelected}><Trash2 size={15}/>Delete selected</button>
            </>
          )}
        </aside>
      </div>

      <section className="habitat-export">
        <div>
          <span className="eyebrow">DELIVERY</span>
          <h2>JSON or GLB</h2>
          <p>
            JSON preserves editable terrain heights, painted surface colors, water
            areas and prop transforms. GLB bakes the current terrain geometry and scene.
          </p>
        </div>
        <div className="habitat-export-actions">
          <button onClick={exportManifest}><FileJson size={16}/>Export JSON Manifest</button>
          <button className="primary" onClick={() => void exportGlb()}><Download size={16}/>Export GLB</button>
        </div>
      </section>
    </section>
  );
}
