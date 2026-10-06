import { meadow } from "./meadow";
import { ScenePausedContext } from "./scene-visibility";
import type { WorldPeriod } from "../../hooks/useWorldClock";
import {
  forwardRef,
  useContext,
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
  creatureScale?: number;
  worldTime?: number;
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
    creatureScale = 1,
    worldTime = Date.now(),
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
  const paused = useContext(ScenePausedContext);
  const live = useRef({
    action,
    sleeping,
    paused,
    clips,
    skeleton,
    selectedBone,
    period,
    worldTime,
  });
  live.current = {
    action,
    sleeping,
    paused,
    clips,
    skeleton,
    selectedBone,
    period,
    worldTime,
  };
  const changeAnimation = useRef<() => void>(() => {});
  const changeDebug = useRef<() => void>(() => {});
  const changePeriod = useRef<(next: WorldPeriod) => void>(() => {});
  const changePlayback = useRef<() => void>(() => {});
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
    const mobileRenderer =
      matchMedia("(pointer: coarse)").matches || window.innerWidth <= 700;
    renderer.setPixelRatio(
      mobileRenderer ? 1 : Math.min(window.devicePixelRatio, 1.5),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const ambient = new THREE.HemisphereLight(0xd9efff, 0x384252, 2.3);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    key.position.set(3, 5, -4);
    const fill = new THREE.DirectionalLight(0xb9d9ff, landscape ? 0.45 : 0);
    fill.position.set(-3, 2, 4);
    const moonLight = new THREE.DirectionalLight(0xcfe2ff, 0);
    moonLight.position.set(-4.5, 7, -5);
    const rimLight = new THREE.DirectionalLight(0x91b7ff, 0);
    rimLight.position.set(0, 3.8, -7);
    scene.add(fill, moonLight, rimLight, key);
    const initialPeriod = live.current.period;
    let environment = landscape ? meadow(scene, initialPeriod) : null;
    let environmentPeriod = initialPeriod;
    if (environment) {
      if (environment.lightPosition)
        key.position.copy(environment.lightPosition);
      key.color.setHex(environment.colors.light);
      key.intensity = environment.colors.intensity;
      ambient.intensity =
        environment.colors.ambientIntensity ??
        (initialPeriod === "Night"
          ? 1.05
          : initialPeriod === "Evening"
            ? 1.5
            : 1.9);
      ambient.color.setHex(initialPeriod === "Night" ? 0xa9c7ff : 0xd9efff);
      fill.intensity = environment.colors.fillIntensity ?? 0.45;
      moonLight.intensity = environment.colors.moonIntensity ?? 0;
      rimLight.intensity = environment.colors.rimIntensity ?? 0;
    }
    changePeriod.current = (next) => {
      if (next === environmentPeriod) return;
      environmentPeriod = next;
      environment?.dispose();
      environment = landscape ? meadow(scene, next) : null;
      if (environment) {
        if (environment.lightPosition)
          key.position.copy(environment.lightPosition);
        key.color.setHex(environment.colors.light);
        key.intensity = environment.colors.intensity;
        ambient.intensity =
          environment.colors.ambientIntensity ??
          (next === "Night" ? 1.05 : next === "Evening" ? 1.5 : 1.9);
        ambient.color.setHex(next === "Night" ? 0xa9c7ff : 0xd9efff);
        fill.intensity = environment.colors.fillIntensity ?? 0.45;
        moonLight.intensity = environment.colors.moonIntensity ?? 0;
        rimLight.intensity = environment.colors.rimIntensity ?? 0;
      }
    };
    const creatureMaterials = new Set<THREE.Material>();
    const root = clone(model.scene),
      stage = new THREE.Group();
    // Clone only material state: cached model materials stay untouched in Lab.
    if (landscape)
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        const matte = (source: THREE.Material) => {
          const material = source.clone();
          if (material instanceof THREE.MeshStandardMaterial) {
            material.roughness = Math.max(material.roughness, 0.9);
            material.metalness = 0;
            material.roughnessMap = null;
            material.metalnessMap = null;
          }
          creatureMaterials.add(material);
          return material;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(matte)
          : matte(mesh.material);
      });
    stage.add(root);
    scene.add(stage);
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root),
      size = bounds.getSize(new THREE.Vector3()),
      center = bounds.getCenter(new THREE.Vector3());
    const framingScale = 2 / Math.max(size.x, size.y, size.z, 0.001);
    const scale = framingScale * (landscape ? creatureScale : 1);
    stage.scale.setScalar(scale);
    stage.position.set(
      -center.x * scale,
      -bounds.min.y * scale + (landscape ? (environment?.groundY ?? 0.18) : 0),
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
        camera.position.set(0, 2.2, 4.7);
        controls.target.set(0, 1.6, 0);
      }
      const spherical = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );
      controls.minPolarAngle = spherical.phi;
      controls.maxPolarAngle = spherical.phi;
      controls.minAzimuthAngle = spherical.theta;
      controls.maxAzimuthAngle = spherical.theta;
      controls.enablePan = false;
      controls.enableZoom = false;
      controls.enableRotate = false;
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
    helper.visible = live.current.skeleton;
    scene.add(helper);
    const axes = new THREE.AxesHelper(0.25 / scale);
    changeDebug.current = () => {
      helper.visible = live.current.skeleton;
      axes.removeFromParent();
      const selected = root.getObjectByName(live.current.selectedBone);
      if (selected) selected.add(axes);
    };
    changeDebug.current();
    const mixer = new THREE.AnimationMixer(root);
    let clip: THREE.AnimationClip | undefined;
    let touching = false;
    changeAnimation.current = () => {
      touching = false;
      mixer.stopAllAction();
      clip =
        live.current.clips.find((c) => c.name === live.current.action) ??
        live.current.clips.find((c) => c.name === "idle");
      if (clip) mixer.clipAction(clip).reset().play();
    };
    changeAnimation.current();
    const returnToIdle = () => {
      touching = false;
      mixer.stopAllAction();
      if (clip) mixer.clipAction(clip).reset().play();
    };
    mixer.addEventListener("finished", returnToIdle);
    reactToTouch.current = () => {
      const { sleeping, paused, action, clips } = live.current;
      const touchClip = clips.find((c) => c.name === "touch");
      if (sleeping || paused || action !== "idle" || touching || !touchClip)
        return;
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
          camera.aspect < 1 ? 4.8 : 6.8,
          (size.x * framingScale) /
            (2 *
              Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
              camera.aspect *
              (w <= 700 ? 0.42 : 0.54)),
        );
        // Lower the companion toward Growth in portrait, keeping its feet on the ground.
        const direction = camera.position
          .clone()
          .sub(controls.target)
          .normalize();
        controls.target.y = 1.6 + (camera.aspect < 1 ? 0.7 : 0);
        camera.position
          .copy(controls.target)
          .addScaledVector(direction, distance);
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
      changePlayback.current();
    });
    intersection.observe(host);
    const tick = (now: number) => {
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (
        visible &&
        !document.hidden &&
        !live.current.sleeping &&
        !live.current.paused
      ) {
        mixer.update(delta);
        controls.update();
        environment?.update(now / 1000, live.current.worldTime);
        if (environment) {
          key.color.setHex(environment.colors.light);
          key.intensity = environment.colors.intensity;
          if (environment.lightPosition)
            key.position.copy(environment.lightPosition);
          if (environment.colors.ambientIntensity !== undefined)
            ambient.intensity = environment.colors.ambientIntensity;
          if (environment.colors.fillIntensity !== undefined)
            fill.intensity = environment.colors.fillIntensity;
          moonLight.intensity = environment.colors.moonIntensity ?? 0;
          rimLight.intensity = environment.colors.rimIntensity ?? 0;
        }
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      } else {
        raf = 0;
      }
    };
    changePlayback.current = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = performance.now();
      if (
        visible &&
        !document.hidden &&
        !live.current.sleeping &&
        !live.current.paused
      )
        raf = requestAnimationFrame(tick);
    };
    document.addEventListener("visibilitychange", changePlayback.current);
    changePlayback.current();
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
      document.removeEventListener("visibilitychange", changePlayback.current);
      changePlayback.current = () => {};
      changeAnimation.current = () => {};
      changeDebug.current = () => {};
      changePeriod.current = () => {};
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
      creatureMaterials.forEach((material) => material.dispose());
      ground.geometry.dispose();
      ground.material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [model, landscape, creatureScale]);
  useEffect(() => changeAnimation.current(), [action, clips]);
  useEffect(() => changeDebug.current(), [skeleton, selectedBone]);
  useEffect(() => changePeriod.current(period), [period]);
  useEffect(() => changePlayback.current(), [sleeping, paused]);
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

export function GuestWorld({ period = "Day" }: { period?: WorldPeriod }) {
  const paused = useContext(ScenePausedContext);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const playback = useRef<() => void>(() => {});
  const mount = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    } catch {
      return;
    }
    // Same budget as the creature scene: phones render at 1x to stay smooth and cool.
    const mobileRenderer =
      matchMedia("(pointer: coarse)").matches || window.innerWidth <= 700;
    renderer.setPixelRatio(
      mobileRenderer ? 1 : Math.min(window.devicePixelRatio, 1.5),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const env = meadow(scene, period);
    const hemi = new THREE.HemisphereLight(
      period === "Night" ? 0xa9c7ff : 0xdff5ff,
      0x314536,
      env.colors.ambientIntensity ?? (period === "Night" ? 1.05 : period === "Evening" ? 1.5 : 1.9),
    );
    scene.add(hemi);
    const key = new THREE.DirectionalLight(
      env.colors.light,
      env.colors.intensity,
    );
    key.position.copy(env.lightPosition);
    const fill = new THREE.DirectionalLight(
      0xb9d9ff,
      env.colors.fillIntensity ?? 0.45,
    );
    fill.position.set(-3, 2, 4);
    const moonLight = new THREE.DirectionalLight(
      0xcfe2ff,
      env.colors.moonIntensity ?? 0,
    );
    moonLight.position.set(-4.5, 7, -5);
    const rimLight = new THREE.DirectionalLight(
      0x91b7ff,
      env.colors.rimIntensity ?? 0,
    );
    rimLight.position.set(0, 3.8, -7);
    scene.add(fill, moonLight, rimLight, key);

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(1.95, 2.12, 0.18, 64),
      new THREE.MeshStandardMaterial({
        color: 0x5a6670,
        roughness: 0.94,
        metalness: 0.02,
      }),
    );
    platform.position.set(0, 0.05, 0.3);
    scene.add(platform);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.42, 0.025, 10, 96),
      new THREE.MeshBasicMaterial({
        color: 0x65dcff,
        transparent: true,
        opacity: 0.58,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0, 0.155, 0.3);
    scene.add(ring);
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(0.82, 0.018, 10, 96),
      new THREE.MeshBasicMaterial({
        color: 0x8be8ff,
        transparent: true,
        opacity: 0.32,
      }),
    );
    inner.rotation.x = Math.PI / 2;
    inner.position.set(0, 0.158, 0.3);
    scene.add(inner);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 2.6, 6.7);
    camera.lookAt(0, 1.15, -0.2);
    const resize = () => {
      const w = Math.max(1, host.clientWidth),
        h = Math.max(1, host.clientHeight);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    let raf = 0;
    const clock = new THREE.Clock();
    const render = () => {
      const t = clock.getElapsedTime();
      ring.material.opacity = 0.48 + Math.sin(t * 1.6) * 0.1;
      env.update(t);
      key.color.setHex(env.colors.light);
      key.intensity = env.colors.intensity;
      key.position.copy(env.lightPosition);
      hemi.intensity = env.colors.ambientIntensity ?? hemi.intensity;
      fill.intensity = env.colors.fillIntensity ?? fill.intensity;
      moonLight.intensity = env.colors.moonIntensity ?? 0;
      rimLight.intensity = env.colors.rimIntensity ?? 0;
      if (!pausedRef.current && !document.hidden) {
        renderer.render(scene, camera);
        raf = requestAnimationFrame(render);
      } else raf = 0;
    };
    playback.current = () => {
      cancelAnimationFrame(raf);
      if (!pausedRef.current && !document.hidden) render();
    };
    document.addEventListener("visibilitychange", playback.current);
    playback.current();
    return () => {
      document.removeEventListener("visibilitychange", playback.current);
      playback.current = () => {};
      cancelAnimationFrame(raf);
      ro.disconnect();
      env.dispose();
      platform.geometry.dispose();
      (platform.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      inner.geometry.dispose();
      (inner.material as THREE.Material).dispose();
      renderer.dispose();
      // Release the GPU context right away: leaving the login screen must not
      // leave a second WebGL context alive next to the game scene on phones.
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [period]);
  useEffect(() => playback.current(), [paused]);
  return <div className="guest-world-canvas" ref={mount} aria-hidden="true" />;
}

export function EvolutionModel({
  evolution,
  action = "idle",
  sleeping = false,
  landscape = false,
  period = "Day",
  worldTime,
}: {
  worldTime?: number;
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
          worldTime={worldTime}
          creatureScale={evolution.stage === 0 ? 0.8 : 1}
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
