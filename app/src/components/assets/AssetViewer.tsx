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
import { isMammalPilot, modelUriFor } from "../../lib/assets/catalog";
import type { Evolution } from "../../lib/rebyters/types";
import { CreatureSprite } from "../admin/CreatureSprite";
import "./assets.css";

const clipAliases: Record<string, string[]> = {
  idle: ["idle", "Idle_Blinking", "Idle"],
  touch: ["touch", "Bounce_Happy", "Happy"],
  sad: ["sad", "Sad"],
  feed: ["feed", "Feeding"],
  play: ["play", "Bounce_Happy"],
  train: ["train", "Attack_Slam"],
  walk: ["walk", "Walk_Bounce"],
  care: ["care", "Bounce_Happy"],
};

function normalizeClipName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findActionClip(clips: THREE.AnimationClip[], action: string) {
  const names = clipAliases[action] ?? [action];
  const normalized = new Set(names.map(normalizeClipName));
  return clips.find((clip) => normalized.has(normalizeClipName(clip.name)));
}

export type ViewerHandle = { thumbnail: () => Promise<Blob> };
type Props = {
  landscape?: boolean;
  creatureScale?: number;
  creatureYOffset?: number;
  creatureVisualBoost?: boolean;
  worldTime?: number;
  period?: WorldPeriod;
  model: AssetModel;
  clips?: THREE.AnimationClip[];
  action?: string;
  skeleton?: boolean;
  selectedBone?: string;
  sleeping?: boolean;
  onActionComplete?: (action: string) => void;
};
export const AssetViewer = forwardRef<ViewerHandle, Props>(function AssetViewer(
  {
    model,
    landscape = false,
    creatureScale = 1,
    creatureYOffset = 0,
    creatureVisualBoost = false,
    worldTime = Date.now(),
    period = "Day",
    clips = model.clips,
    action = "idle",
    skeleton = false,
    selectedBone = "",
    sleeping = false,
    onActionComplete,
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
    onActionComplete,
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
    onActionComplete,
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
            material.metalness = 0;
            material.metalnessMap = null;

            if (creatureVisualBoost) {
              // The mobile-optimized Mammal textures are intentionally tiny.
              // Keep more specular response and add a very small texture-backed
              // emissive lift so the creature does not look washed out in the
              // habitat, especially at night.
              material.roughness = Math.min(material.roughness || 0.75, 0.68);
              if (material.map) {
                material.emissive.set(0xffffff);
                material.emissiveMap = material.map;
                material.emissiveIntensity = 0.20;
              } else {
                material.emissive.copy(material.color);
                material.emissiveIntensity = 0.10;
              }
            } else {
              material.roughness = Math.max(material.roughness, 0.9);
              material.roughnessMap = null;
            }
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
      -bounds.min.y * scale +
        (landscape ? (environment?.groundY ?? 0.18) + creatureYOffset : 0),
      -center.z * scale,
    );
    const baseStagePosition = stage.position.clone();
    const baseStageRotationY = stage.rotation.y;
    const trainingRockGeometry = new THREE.DodecahedronGeometry(0.34, 0);
    const trainingRockMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b6255,
      roughness: 1,
      metalness: 0,
    });
    const trainingRock = new THREE.Mesh(
      trainingRockGeometry,
      trainingRockMaterial,
    );
    trainingRock.scale.set(1.22, 0.88, 1);
    trainingRock.visible = false;
    scene.add(trainingRock);
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
    let currentMixerAction: THREE.AnimationAction | null = null;
    let transientAction: THREE.AnimationAction | null = null;
    let touchAction: THREE.AnimationAction | null = null;
    let touching = false;
    let powerTraining: {
      startedAt: number;
      phase: number;
      attackDuration: number;
    } | null = null;

    const playClip = (
      nextClip: THREE.AnimationClip | undefined,
      once = false,
      fade = 0.14,
    ) => {
      if (!nextClip) return null;
      const next = mixer.clipAction(nextClip);
      if (currentMixerAction && currentMixerAction !== next)
        currentMixerAction.fadeOut(fade);
      next
        .reset()
        .setEffectiveTimeScale(1)
        .setEffectiveWeight(1)
        .setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
      next.clampWhenFinished = false;
      next.fadeIn(fade).play();
      currentMixerAction = next;
      clip = nextClip;
      return next;
    };

    const playBaseAnimation = () => {
      transientAction = null;
      const base =
        findActionClip(
          live.current.clips,
          live.current.action === "sad" ? "sad" : "idle",
        ) ?? findActionClip(live.current.clips, "idle");
      playClip(base, false);
    };

    const resetPowerTraining = () => {
      powerTraining = null;
      trainingRock.visible = false;
      stage.position.copy(baseStagePosition);
      stage.rotation.y = baseStageRotationY;
    };

    const startPowerTraining = () => {
      const walkClip = findActionClip(live.current.clips, "walk");
      const slamClip = findActionClip(live.current.clips, "train");
      if (!walkClip || !slamClip || !landscape) {
        transientAction = playClip(slamClip, true);
        return;
      }
      touching = false;
      transientAction = null;
      stage.position.copy(baseStagePosition);
      stage.rotation.y = baseStageRotationY;
      const groundY = (environment?.groundY ?? 0.18) + 0.26;
      trainingRock.position.set(
        baseStagePosition.x + 0.95,
        groundY + 2.8,
        baseStagePosition.z - 0.6,
      );
      trainingRock.rotation.set(0.18, 0.4, -0.12);
      trainingRock.visible = true;
      powerTraining = {
        startedAt: performance.now() / 1000,
        phase: 0,
        attackDuration: Math.max(0.8, slamClip.duration || 2),
      };
      playClip(findActionClip(live.current.clips, "idle"), false);
    };

    changeAnimation.current = () => {
      touching = false;
      touchAction = null;
      transientAction = null;
      if (live.current.action !== "train-power") resetPowerTraining();

      if (live.current.action === "train-power") {
        startPowerTraining();
        return;
      }

      clip =
        findActionClip(live.current.clips, live.current.action) ??
        findActionClip(live.current.clips, "idle");
      const loop =
        live.current.action === "idle" || live.current.action === "sad";
      if (loop) playClip(clip, false);
      else transientAction = playClip(clip, true);
    };
    changeAnimation.current();

    const onFinished = (event: any) => {
      if (touchAction && event.action === touchAction) {
        touching = false;
        touchAction = null;
        playBaseAnimation();
        return;
      }
      if (transientAction && event.action === transientAction) {
        const completedAction = live.current.action;
        transientAction = null;
        live.current.onActionComplete?.(completedAction);
      }
    };
    mixer.addEventListener("finished", onFinished);

    reactToTouch.current = () => {
      const { sleeping, paused, action, clips } = live.current;
      const touchClip = findActionClip(clips, "touch");
      // Negative care states are persistent: touching an injured, sick,
      // hungry or overfed Rebyter must not override the Sad animation.
      if (sleeping || paused || action !== "idle" || touching || !touchClip)
        return;
      touching = true;
      touchAction = playClip(touchClip, true);
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
        if (powerTraining) {
          const elapsed = now / 1000 - powerTraining.startedAt;
          const dropEnd = 0.65;
          const walkEnd = 2.15;
          const turnEnd = 2.5;
          const attackEnd = turnEnd + powerTraining.attackDuration;
          const holdEnd = attackEnd + 0.28;
          const returnEnd = holdEnd + 1.35;
          const settleEnd = returnEnd + 0.3;
          const groundY = (environment?.groundY ?? 0.18) + 0.26;
          const approach = baseStagePosition
            .clone()
            .add(new THREE.Vector3(-0.08, 0, -0.48));

          if (elapsed < dropEnd) {
            const u = THREE.MathUtils.clamp(elapsed / dropEnd, 0, 1);
            const eased = 1 - Math.pow(1 - u, 3);
            trainingRock.position.y =
              THREE.MathUtils.lerp(groundY + 2.8, groundY, eased) +
              (u > 0.88 ? Math.sin((u - 0.88) * 38) * 0.045 * (1 - u) : 0);
          } else {
            trainingRock.position.y = groundY;
          }

          if (elapsed >= dropEnd && elapsed < walkEnd) {
            if (powerTraining.phase < 1) {
              powerTraining.phase = 1;
              playClip(findActionClip(live.current.clips, "walk"), false);
            }
            const u = THREE.MathUtils.smoothstep(
              (elapsed - dropEnd) / (walkEnd - dropEnd),
              0,
              1,
            );
            stage.position.lerpVectors(baseStagePosition, approach, u);
          } else if (elapsed >= walkEnd && elapsed < turnEnd) {
            if (powerTraining.phase < 2) {
              powerTraining.phase = 2;
              playClip(findActionClip(live.current.clips, "idle"), false);
            }
            stage.position.copy(approach);
            const u = THREE.MathUtils.smoothstep(
              (elapsed - walkEnd) / (turnEnd - walkEnd),
              0,
              1,
            );
            stage.rotation.y = THREE.MathUtils.lerp(
              baseStageRotationY,
              baseStageRotationY + Math.PI / 2,
              u,
            );
          } else if (elapsed >= turnEnd && elapsed < attackEnd) {
            if (powerTraining.phase < 3) {
              powerTraining.phase = 3;
              playClip(findActionClip(live.current.clips, "train"), true, 0.1);
            }
            stage.position.copy(approach);
            stage.rotation.y = baseStageRotationY + Math.PI / 2;
            const attackU = (elapsed - turnEnd) / powerTraining.attackDuration;
            if (attackU > 0.52) {
              const impact = THREE.MathUtils.clamp((attackU - 0.52) / 0.18, 0, 1);
              trainingRock.position.x =
                baseStagePosition.x + 0.95 + impact * 0.18;
              trainingRock.rotation.z = -0.12 - impact * 0.28;
            }
          } else if (elapsed >= attackEnd && elapsed < holdEnd) {
            if (powerTraining.phase < 4) {
              powerTraining.phase = 4;
              playClip(findActionClip(live.current.clips, "idle"), false);
            }
          } else if (elapsed >= holdEnd && elapsed < returnEnd) {
            if (powerTraining.phase < 5) {
              powerTraining.phase = 5;
              playClip(findActionClip(live.current.clips, "walk"), false);
            }
            const u = THREE.MathUtils.smoothstep(
              (elapsed - holdEnd) / (returnEnd - holdEnd),
              0,
              1,
            );
            stage.position.lerpVectors(approach, baseStagePosition, u);
            stage.rotation.y = THREE.MathUtils.lerp(
              baseStageRotationY - Math.PI / 2,
              baseStageRotationY,
              u,
            );
          } else if (elapsed >= returnEnd && elapsed < settleEnd) {
            stage.position.copy(baseStagePosition);
            stage.rotation.y = baseStageRotationY;
          } else if (elapsed >= settleEnd) {
            const completedAction = live.current.action;
            resetPowerTraining();
            playClip(findActionClip(live.current.clips, "idle"), false);
            live.current.onActionComplete?.(completedAction);
          }
        }

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
      mixer.removeEventListener("finished", onFinished);
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
      trainingRockGeometry.dispose();
      trainingRockMaterial.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [model, landscape, creatureScale, creatureYOffset, creatureVisualBoost]);
  useEffect(() => changeAnimation.current(), [action, clips]);
  useEffect(() => changeDebug.current(), [skeleton, selectedBone]);
  useEffect(() => changePeriod.current(period), [period]);
  useEffect(() => changePlayback.current(), [sleeping, paused]);
  return (
    <div className="asset-viewport">
      <div ref={mount} className="asset-canvas" />
      {!sleeping &&
        action === "idle" &&
        !!findActionClip(clips, "touch") && (
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
  onActionComplete,
}: {
  worldTime?: number;
  landscape?: boolean;
  period?: WorldPeriod;
  evolution: Evolution;
  action?: string;
  sleeping?: boolean;
  onActionComplete?: (action: string) => void;
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
          creatureYOffset={landscape && isMammalPilot(evolution) ? 0.80 : 0}
          creatureVisualBoost={landscape && isMammalPilot(evolution)}
          model={loaded.model}
          action={action}
          sleeping={sleeping}
          onActionComplete={onActionComplete}
        />
      ) : (
        <div className="asset-viewer-message">Loading companion…</div>
      )}
    </div>
  );
}
