import { meadow } from "./meadow";
import type { WorldPeriod } from "../../hooks/useWorldClock";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import {
  disposeModel,
  loader,
  inspectModel,
  type AssetModel,
} from "../../lib/assets/rig";
import { modelUriFor } from "../../lib/assets/catalog";
import type { Evolution } from "../../lib/rebyters/types";
import { CreatureSprite } from "../admin/CreatureSprite";
import "./assets.css";

export type ViewerHandle = { thumbnail: () => Promise<Blob> };
type Props = {
  landscape?: boolean;
  period?: WorldPeriod;
  model: AssetModel;
  clips?: THREE.AnimationClip[];
  action?: string;
  skeleton?: boolean;
  selectedBone?: string;
  sleeping?: boolean;
};
export const AssetViewer = forwardRef<ViewerHandle, Props>(function AssetViewer(
  {
    model,
    landscape = false,
    period = "Day",
    clips = model.clips,
    action = "idle",
    skeleton = false,
    selectedBone = "",
    sleeping = false,
  },
  ref,
) {
  const mount = useRef<HTMLDivElement>(null),
    capture = useRef<() => Promise<Blob>>(() =>
      Promise.reject(new Error("Viewer not ready")),
    );
  const [error, setError] = useState("");
  const reactToTouch = useRef<() => void>(() => {});
  const viewState = useRef<{
    position: THREE.Vector3;
    target: THREE.Vector3;
  } | null>(null);
  useImperativeHandle(ref, () => ({ thumbnail: () => capture.current() }), []);
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError("WebGL is unavailable on this device.");
      return;
    }
    setError("");
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd9efff, 0x384252, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(3, 5, 4);
    scene.add(key);
    const environment = landscape ? meadow(scene, period) : null;
    if (environment) {
      key.color.setHex(environment.colors.light);
      key.intensity = environment.colors.intensity;
    }
    const root = clone(model.scene),
      stage = new THREE.Group();
    stage.add(root);
    scene.add(stage);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    const scale = 2 / Math.max(size.x, size.y, size.z, 0.001);
    stage.scale.setScalar(scale);
    stage.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    const target = new THREE.Vector3(0, size.y * scale * 0.48, 0),
      camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(3, 2.3, 4);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.copy(target);
    if (viewState.current) {
      camera.position.copy(viewState.current.position);
      controls.target.copy(viewState.current.target);
    }
    if (landscape) {
      if (!viewState.current) {
        camera.position.set(0, 1.5, 4.7);
        controls.target.set(0, 0.9, 0);
      }
      const polar = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      ).phi;
      controls.minPolarAngle = polar;
      controls.maxPolarAngle = polar;
      controls.enablePan = false;
      controls.enableZoom = false;
    }
    controls.enableDamping = true;
    controls.minDistance = 1;
    controls.maxDistance = 12;
    controls.update();
    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.72, 0.16, 40),
      new THREE.MeshStandardMaterial({ color: 0x172e54, roughness: 1 }),
    );
    ground.position.y = -0.09;
    if (!landscape) scene.add(ground);
    const helper = new THREE.SkeletonHelper(root);
    helper.visible = skeleton;
    scene.add(helper);
    const axes = new THREE.AxesHelper(0.25 / scale);
    const selected = root.getObjectByName(selectedBone);
    if (selected) selected.add(axes);
    const mixer = new THREE.AnimationMixer(root);
    const clip =
      clips.find((c) => c.name === action) ??
      clips.find((c) => c.name === "idle");
    if (clip) mixer.clipAction(clip).play();
    let touching = false;
    const touchClip = clips.find((c) => c.name === "touch");
    const returnToIdle = () => {
      touching = false;
      mixer.stopAllAction();
      if (clip) mixer.clipAction(clip).reset().play();
    };
    mixer.addEventListener("finished", returnToIdle);
    reactToTouch.current = () => {
      if (sleeping || action !== "idle" || touching || !touchClip) return;
      touching = true;
      mixer.stopAllAction();
      const reaction = mixer.clipAction(touchClip);
      reaction.reset().setLoop(THREE.LoopOnce, 1);
      reaction.clampWhenFinished = true;
      reaction.play();
    };
    let pointer: {
      id: number;
      x: number;
      y: number;
      time: number;
      moved: boolean;
    } | null = null;
    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0) {
        pointer = null;
        return;
      }
      pointer = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        time: performance.now(),
        moved: false,
      };
    };
    const move = (e: PointerEvent) => {
      if (
        pointer &&
        Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 8
      )
        pointer.moved = true;
    };
    const up = (e: PointerEvent) => {
      const start = pointer;
      pointer = null;
      if (
        !start ||
        start.id !== e.pointerId ||
        start.moved ||
        performance.now() - start.time > 600
      )
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      root.updateMatrixWorld(true);
      // Animated skinned bounds must be refreshed before hit testing.
      root.traverse((n) => {
        if ((n as THREE.SkinnedMesh).isSkinnedMesh)
          (n as THREE.SkinnedMesh).computeBoundingSphere();
      });
      if (
        ray
          .intersectObject(root, true)
          .some((hit) => (hit.object as THREE.Mesh).isMesh)
      )
        reactToTouch.current();
    };
    const cancel = () => {
      pointer = null;
    };
    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointercancel", cancel);
    const resize = () => {
      const w = host.clientWidth,
        h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      if (landscape) {
        const distance = Math.max(
          4.8,
          (size.x * scale) /
            (2 *
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
              camera.aspect *
              0.7),
        );
        const direction = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(direction,distance);
        controls.maxDistance = Math.max(12, distance);
        controls.update();
      }
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    let visible = true,
      last = performance.now(),
      raf = 0;
    const intersection = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    });
    intersection.observe(host);
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (visible && !document.hidden && !sleeping) {
        mixer.update(delta);
        controls.update();
        renderer.render(scene, camera);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    capture.current = async () => {
      const original = renderer.getSize(new THREE.Vector2()),
        aspect = camera.aspect,
        pixelRatio = renderer.getPixelRatio();
      const helperVisible = helper.visible,
        axesVisible = axes.visible;
      helper.visible = false;
      axes.visible = false;
      touching = false;
      // Thumbnail uses rest pose and exactly the same camera orientation as the viewport.
      mixer.stopAllAction();
      renderer.setPixelRatio(1);
      renderer.setSize(512, 512, false);
      camera.aspect = 1;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      const canvas = document.createElement("canvas");
      canvas.width = 512;
      canvas.height = 512;
      canvas.getContext("2d")!.drawImage(renderer.domElement, 0, 0);
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(original.x, original.y);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      helper.visible = helperVisible;
      axes.visible = axesVisible;
      if (clip) mixer.clipAction(clip).reset().play();
      return new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Thumbnail failed"))),
          "image/png",
        ),
      );
    };
    return () => {
      viewState.current = {
        position: camera.position.clone(),
        target: controls.target.clone(),
      };
      capture.current = () => Promise.reject(new Error("Viewer not ready"));
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      reactToTouch.current = () => {};
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointercancel", cancel);
      mixer.removeEventListener("finished", returnToIdle);
      controls.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      helper.dispose();
      axes.dispose();
      root.traverse((n) => {
        if ((n as THREE.SkinnedMesh).isSkinnedMesh)
          (n as THREE.SkinnedMesh).skeleton.dispose();
      });
      environment?.dispose();
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [
    model,
    clips,
    action,
    skeleton,
    selectedBone,
    sleeping,
    landscape,
    period,
  ]);
  return (
    <div className="asset-viewport">
      <div ref={mount} className="asset-canvas" />
      {!sleeping &&
        action === "idle" &&
        clips.some((c) => c.name === "touch") && (
          <button
            className="asset-touch asset-touch-accessible"
            onClick={() => reactToTouch.current()}
            aria-label="Pet your Rebyter"
          >
            Pet your Rebyter
          </button>
        )}
      {error && <div className="asset-viewer-message">{error}</div>}
      {sleeping && (
        <div className="asset-sleep" role="status">
          <span>☾</span>
          <strong>Resting</strong>
          <small>Lights out. Time to recharge.</small>
          <i>z z Z</i>
        </div>
      )}
    </div>
  );
});

export function EvolutionModel({
  evolution,
  action = "idle",
  sleeping = false,
  landscape = false,
  period = "Day",
}: {
  landscape?: boolean;
  period?: WorldPeriod;
  evolution: Evolution;
  action?: string;
  sleeping?: boolean;
}) {
  const uri = modelUriFor(evolution);
  const [loaded, setLoaded] = useState<{
      uri: string;
      model: AssetModel;
    } | null>(null),
    [failed, setFailed] = useState("");
  useEffect(() => {
    if (!uri) return;
    let cancelled = false,
      resource: AssetModel | undefined;
    const l = loader();
    const url = uri.startsWith("ipfs://")
      ? `https://ipfs.io/ipfs/${uri.slice(7)}`
      : uri;
    l.gltf
      .loadAsync(url)
      .then((g) => {
        resource = inspectModel(g);
        if (cancelled) disposeModel(resource);
        else setLoaded({ uri, model: resource });
      })
      .catch(() => {
        if (!cancelled) setFailed(uri);
      });
    return () => {
      cancelled = true;
      l.dispose();
      if (resource) disposeModel(resource);
    };
  }, [uri]);
  if (!uri || failed === uri)
    return (
      <>
        <CreatureSprite evolution={evolution} />
        {sleeping && (
          <div className="asset-sleep">
            <span>☾</span>
            <strong>Resting</strong>
            <i>z z Z</i>
          </div>
        )}
      </>
    );
  return (
    <div className="evolution-model">
      {loaded?.uri === uri ? (
        <AssetViewer
          landscape={landscape}
          period={period}
          model={loaded.model}
          action={action}
          sleeping={sleeping}
        />
      ) : (
        <div className="asset-viewer-message">Loading companion…</div>
      )}
    </div>
  );
}
