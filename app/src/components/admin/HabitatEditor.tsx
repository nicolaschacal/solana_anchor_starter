import {
  Box,
  Download,
  FileJson,
  Grid3X3,
  MousePointer2,
  Monitor,
  Smartphone,
  Move3D,
  Rotate3D,
  Save,
  Scale3D,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { MeshoptDecoder } from "meshoptimizer";
import { MAMMAL_PILOT } from "../../lib/assets/catalog";

type TransformMode = "translate" | "rotate" | "scale";
type PreviewMode = "web" | "mobile";

type HabitatObject = {
  id: string;
  name: string;
  asset: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};

type HabitatManifest = {
  schema: "rebyters-habitat-v1";
  id: string;
  name: string;
  ground: {
    width: number;
    depth: number;
    material: "grass";
  };
  objects: HabitatObject[];
};

const BUILTIN_ASSETS = [
  { name: "Pine tree", asset: "/assets/environment/pine-tree.glb" },
  { name: "Deciduous tree", asset: "/assets/environment/deciduous-tree.glb" },
  { name: "Berry bush", asset: "/assets/environment/berry-bush.glb" },
  { name: "Mossy rocks", asset: "/assets/environment/mossy-rocks.glb" },
  { name: "Tree stump", asset: "/assets/environment/tree-stump.glb" },
  { name: "Hollow log", asset: "/assets/environment/hollow-log.glb" },
  { name: "Red mushrooms", asset: "/assets/environment/red-mushrooms.glb" },
];

const STORAGE_KEY = "rebyters:habitat-editor:draft";

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function toManifest(
  name: string,
  width: number,
  depth: number,
  objects: HabitatObject[],
): HabitatManifest {
  const id =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "untitled-habitat";
  return {
    schema: "rebyters-habitat-v1",
    id,
    name: name.trim() || "Untitled Habitat",
    ground: { width, depth, material: "grass" },
    objects,
  };
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

export function HabitatEditor() {
  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const objectRootRef = useRef<THREE.Group | null>(null);
  const groundRef = useRef<THREE.Mesh | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const selectedRef = useRef<THREE.Object3D | null>(null);
  const loaderRef = useRef(new GLTFLoader().setMeshoptDecoder(MeshoptDecoder));
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const importedUrls = useRef<string[]>([]);
  const [name, setName] = useState("My Habitat");
  const [groundWidth, setGroundWidth] = useState(24);
  const [groundDepth, setGroundDepth] = useState(24);
  const [objects, setObjects] = useState<HabitatObject[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [mode, setMode] = useState<TransformMode>("translate");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("web");
  const [status, setStatus] = useState("Build a modular habitat. Sky, clouds and stars stay game-side.");

  const syncObjects = () => {
    const root = objectRootRef.current;
    if (!root) return;
    setObjects(root.children.map(objectToRecord));
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

    const hemi = new THREE.HemisphereLight(0xffffff, 0x49634b, 2.2);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 10, 5);
    sun.castShadow = true;
    scene.add(sun);

    const grid = new THREE.GridHelper(40, 40, 0x6f9278, 0x9eb6a5);
    grid.position.y = 0.006;
    scene.add(grid);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundWidth, groundDepth),
      new THREE.MeshStandardMaterial({
        color: 0x6f9448,
        roughness: 1,
        metalness: 0,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    groundRef.current = ground;

    const objectRoot = new THREE.Group();
    objectRoot.name = "HabitatObjects";
    scene.add(objectRoot);
    objectRootRef.current = objectRoot;

    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode(mode);
    transform.addEventListener("objectChange", syncObjects);
    scene.add(transform.getHelper());
    transformRef.current = transform;

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      if ((transform as any).dragging) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(objectRoot.children, true);
      if (!hits.length) {
        selectedRef.current = null;
        transform.detach();
        setSelectedId("");
        return;
      }
      let object: THREE.Object3D | null = hits[0].object;
      while (object && object.parent !== objectRoot) object = object.parent;
      if (!object) return;
      selectedRef.current = object;
      transform.attach(object);
      setSelectedId(object.userData.habitatId);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);

    const frameCamera = () => {
      const w = Math.max(1, host.clientWidth);
      const h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      const portrait = camera.aspect < 0.8;
      const target = new THREE.Vector3(0, portrait ? 1.15 : 1.05, -1.25);
      camera.position.set(0, portrait ? 2.1 : 2.35, portrait ? 6.25 : 5.85);
      camera.lookAt(target);
      camera.updateProjectionMatrix();
    };
    const resize = frameCamera;
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let referenceCreature: THREE.Object3D | null = null;
    void loaderRef.current.loadAsync(MAMMAL_PILOT.modelUri).then((gltf) => {
      const root = gltf.scene;
      root.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(root);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = (2 / Math.max(size.x, size.y, size.z, 0.001)) * 0.8;
      root.scale.setScalar(scale);
      root.position.set(
        -center.x * scale,
        -bounds.min.y * scale + 0.04,
        -center.z * scale - 1.25,
      );
      root.userData.habitatReference = true;
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        const material = mesh.material as THREE.MeshStandardMaterial;
        if (material?.isMeshStandardMaterial) {
          material.roughness = Math.max(material.roughness || 0.75, 0.78);
          if (material.map) {
            material.emissive.set(0xffffff);
            material.emissiveMap = material.map;
            material.emissiveIntensity = 0.07;
          }
        }
      });
      referenceCreature = root;
      scene.add(root);
    }).catch(() => {
      setStatus("Environment assets work, but the reference Rebyter could not be loaded.");
    });

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
      transform.dispose();
      referenceCreature?.removeFromParent();
      cameraRef.current = null;
      ground.geometry.dispose();
      (ground.material as THREE.Material).dispose();
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
    const ground = groundRef.current;
    if (!ground) return;
    ground.geometry.dispose();
    ground.geometry = new THREE.PlaneGeometry(groundWidth, groundDepth);
  }, [groundWidth, groundDepth]);

  async function addAsset(asset: string, displayName: string) {
    try {
      setStatus(`Loading ${displayName}…`);
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
      const normalized = Math.min(2.4 / extent, 1.6);
      root.scale.setScalar(normalized);
      root.position.set(-center.x * normalized, -box.min.y * normalized, -center.z * normalized);
      objectRootRef.current?.add(root);
      selectedRef.current = root;
      transformRef.current?.attach(root);
      setSelectedId(root.userData.habitatId);
      syncObjects();
      setStatus(`${displayName} added. Move, rotate or scale it in the viewport.`);
    } catch {
      setStatus(`Could not load ${displayName}. Check the GLB decoder or asset file.`);
    }
  }

  function deleteSelected() {
    const selected = selectedRef.current;
    if (!selected) return;
    transformRef.current?.detach();
    selected.removeFromParent();
    selectedRef.current = null;
    setSelectedId("");
    syncObjects();
  }

  function saveDraft() {
    const manifest = toManifest(name, groundWidth, groundDepth, objects);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(manifest));
    setStatus("Habitat draft saved in this browser.");
  }

  async function restoreDraft() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setStatus("No saved habitat draft found.");
      return;
    }
    try {
      const manifest = JSON.parse(raw) as HabitatManifest;
      setName(manifest.name);
      setGroundWidth(manifest.ground.width);
      setGroundDepth(manifest.ground.depth);
      const root = objectRootRef.current;
      if (!root) return;
      transformRef.current?.detach();
      root.clear();
      for (const item of manifest.objects) {
        const gltf = await loaderRef.current.loadAsync(item.asset);
        const object = gltf.scene;
        object.userData.habitatId = item.id;
        object.userData.habitatName = item.name;
        object.userData.asset = item.asset;
        object.position.fromArray(item.position);
        object.rotation.fromArray([...item.rotation, "XYZ"] as any);
        object.scale.fromArray(item.scale);
        object.traverse((node) => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
          }
        });
        root.add(object);
      }
      selectedRef.current = null;
      setSelectedId("");
      syncObjects();
      setStatus("Saved habitat restored.");
    } catch {
      setStatus("Saved habitat could not be restored.");
    }
  }

  function exportManifest() {
    const manifest = toManifest(name, groundWidth, groundDepth, objects);
    download(
      new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }),
      `${manifest.id}.habitat.json`,
    );
    setStatus("JSON manifest exported.");
  }

  async function exportGlb() {
    const scene = new THREE.Scene();
    scene.name = "RebytersHabitat";
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundWidth, groundDepth),
      new THREE.MeshStandardMaterial({ color: 0x6f9448, roughness: 1 }),
    );
    ground.name = "HabitatGround";
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const root = objectRootRef.current;
    if (root) root.children.forEach((object) => scene.add(object.clone(true)));
    const exporter = new GLTFExporter();
    const data = await exporter.parseAsync(scene, { binary: true });
    const manifest = toManifest(name, groundWidth, groundDepth, objects);
    download(new Blob([data as ArrayBuffer], { type: "model/gltf-binary" }), `${manifest.id}.glb`);
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    setStatus("Self-contained GLB exported.");
  }

  function importCustom(file: File) {
    const url = URL.createObjectURL(file);
    importedUrls.current.push(url);
    void addAsset(url, file.name.replace(/\.glb$/i, ""));
  }

  return (
    <section className="habitat-editor">
      <header className="habitat-editor-heading">
        <div>
          <span className="eyebrow">REBYTERS / WORLD BUILDING</span>
          <h1>Habitat Editor</h1>
          <p>
            Build modular dioramas while the game keeps ownership of sky, clouds,
            stars, time and global lighting.
          </p>
        </div>
        <div className="habitat-heading-actions">
          <button onClick={() => void restoreDraft()}>Restore</button>
          <button onClick={saveDraft}><Save size={15}/>Save draft</button>
        </div>
      </header>

      <div className="habitat-toolbar">
        <div className="habitat-toolset" aria-label="Transform tools">
          <button className={mode === "translate" ? "active" : ""} onClick={() => setMode("translate")}><Move3D size={16}/>Move</button>
          <button className={mode === "rotate" ? "active" : ""} onClick={() => setMode("rotate")}><Rotate3D size={16}/>Rotate</button>
          <button className={mode === "scale" ? "active" : ""} onClick={() => setMode("scale")}><Scale3D size={16}/>Scale</button>
          <button disabled={!selectedId} onClick={deleteSelected}><Trash2 size={16}/>Delete</button>
        </div>
        <div className="habitat-preview-switch" aria-label="Game preview size">
          <button className={previewMode === "web" ? "active" : ""} onClick={() => setPreviewMode("web")}><Monitor size={15}/>Web</button>
          <button className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}><Smartphone size={15}/>Mobile</button>
        </div>
        <span>{status}</span>
      </div>

      <div className="habitat-layout">
        <aside className="habitat-library">
          <div>
            <span className="eyebrow">ASSET LIBRARY</span>
            <h2>Environment</h2>
            <p>Click an asset to place it at the habitat origin, then position it in the viewport.</p>
          </div>
          <div className="habitat-assets">
            {BUILTIN_ASSETS.map((item) => (
              <button key={item.asset} onClick={() => void addAsset(item.asset, item.name)}>
                <Box size={18}/>
                <span>{item.name}</span>
              </button>
            ))}
          </div>
          <label className="habitat-import">
            <Upload size={16}/>Import custom GLB
            <input
              type="file"
              accept=".glb,model/gltf-binary"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) importCustom(file);
              }}
            />
          </label>
        </aside>

        <div className={`habitat-stage preview-${previewMode}`}>
          <div className="habitat-preview-frame">
            <div ref={mount} className="habitat-canvas" />
            <div className="habitat-safe habitat-safe-top"><span>TOP GUI SAFE AREA</span></div>
            <div className="habitat-safe habitat-safe-bottom"><span>ACTIONS + NAV SAFE AREA</span></div>
            <div className="habitat-companion-guide"><span>REBYTER ZONE</span></div>
          </div>
          <div className="habitat-stage-hint"><MousePointer2 size={14}/>Fixed player camera · select assets to transform them</div>
        </div>

        <aside className="habitat-inspector">
          <div>
            <span className="eyebrow">HABITAT</span>
            <h2>Scene settings</h2>
          </div>
          <label>
            Habitat name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="habitat-ground-grid">
            <label>
              Width
              <input type="number" min={4} max={100} value={groundWidth} onChange={(e) => setGroundWidth(Number(e.target.value) || 4)} />
            </label>
            <label>
              Depth
              <input type="number" min={4} max={100} value={groundDepth} onChange={(e) => setGroundDepth(Number(e.target.value) || 4)} />
            </label>
          </div>
          <div className="habitat-summary">
            <Grid3X3 size={17}/>
            <div>
              <strong>{objects.length} placed assets</strong>
              <small>{groundWidth} × {groundDepth} world units</small>
            </div>
          </div>
          <div className="habitat-selected">
            <small>SELECTED OBJECT</small>
            <strong>{objects.find((item) => item.id === selectedId)?.name ?? "Nothing selected"}</strong>
          </div>
        </aside>
      </div>

      <section className="habitat-export">
        <div>
          <span className="eyebrow">DELIVERY</span>
          <h2>Choose the habitat format later</h2>
          <p>
            Both exports are generated from the same editor scene. JSON keeps assets modular;
            GLB packages the current habitat as a self-contained 3D asset.
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
