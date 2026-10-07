import { meadow } from "./meadow";
import { configureHabitatRenderer, configureHabitatShadow } from "./habitat-lighting";
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

const clipAliases: Record<string, string[]> = {
  // Canonical clips are the lowercase action names. The legacy/export aliases
  // stay supported so existing Rebyters keep working while new GLBs can use one
  // strict naming convention.
  idle: ["idle", "Idle_Blinking", "Idle"],
  touch: ["touch", "Touch_Spin", "Bounce_Happy", "Happy"],
  sad: ["sad", "Sad"],
  feed: ["feed", "Feeding"],
  play: ["play", "Play_Happy", "Bounce_Happy", "Happy"],
  train: ["train", "Attack_Slam", "Training", "Train"],
  walk: ["walk", "Walk_Quadruped", "Walk_Bounce"],
  care: ["care", "Care_Happy", "Bounce_Happy", "Happy"],
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
  creatureZOffset?: number;
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
    creatureZOffset = 0,
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
      mobileRenderer
        ? landscape && creatureVisualBoost
          ? Math.min(window.devicePixelRatio, 1.4)
          : 1
        : Math.min(window.devicePixelRatio, 1.5),
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (landscape) configureHabitatRenderer(renderer);
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const ambient = new THREE.HemisphereLight(0xd9efff, 0x3b5c42, 2.3);
    scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 2.5);
    if (landscape) configureHabitatShadow(key, mobileRenderer);
    key.position.set(3, 5, -4);
    const fill = new THREE.DirectionalLight(0xffefd9, landscape ? 0.45 : 0);
    fill.position.set(-3, 2, 4);
    const moonLight = new THREE.DirectionalLight(0xcfe2ff, 0);
    moonLight.position.set(-4.5, 7, -5);
    const rimLight = new THREE.DirectionalLight(0x88dbff, 0);
    rimLight.position.set(0, 3.8, -7);
    let companionRim: THREE.SpotLight | null = null;
    let companionRimTarget: THREE.Object3D | null = null;
    scene.add(fill, moonLight, rimLight, key);
    const initialPeriod = live.current.period;
    const meadowOptions =
      landscape && creatureVisualBoost
        ? { grassExclusions: [{ x: 0, z: creatureZOffset, radius: 1.35 }] }
        : undefined;
    let environment = landscape
      ? meadow(scene, initialPeriod, meadowOptions)
      : null;
    let environmentPeriod = initialPeriod;
    const applyCinematicPeriod = (next: WorldPeriod) => {
      renderer.toneMappingExposure =
        next === "Night" ? 0.98 : next === "Evening" ? 1.01 : next === "Morning" ? 1.07 : 1.05;
      fill.color.setHex(
        next === "Evening" ? 0xffd9b3 : next === "Night" ? 0xaecbff : 0xffefd9,
      );
      moonLight.color.setHex(0xcfe2ff);
      rimLight.color.setHex(
        next === "Evening" ? 0xffd1ad : next === "Night" ? 0x8fcaff : 0xccecff,
      );
      if (companionRim) {
        companionRim.color.setHex(
          next === "Evening"
            ? 0xffd0ac
            : next === "Night"
              ? 0xa9d6ff
              : next === "Morning"
                ? 0xffe1bf
                : 0xd8f2ff,
        );
        companionRim.intensity =
          next === "Night" ? 0.88 : next === "Evening" ? 0.68 : next === "Morning" ? 0.48 : 0.52;
      }
    };
    applyCinematicPeriod(initialPeriod);
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
      applyCinematicPeriod(next);
      environment?.dispose();
      environment = landscape ? meadow(scene, next, meadowOptions) : null;
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
    // Clone material state for the live scene and preserve authored PBR maps.
    // Lighting is global; individual Rebyters should not need hand-tuned
    // roughness/emissive patches just to look correct in the habitat.
    if (landscape)
      root.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.receiveShadow = true;
        mesh.castShadow = true;

        const prepareTexture = (
          texture: THREE.Texture | null,
          colorTexture = false,
        ) => {
          if (!texture) return null;
          const next = texture.clone();
          next.magFilter = THREE.LinearFilter;
          next.minFilter = THREE.LinearMipmapLinearFilter;
          next.anisotropy = Math.min(
            4,
            renderer.capabilities.getMaxAnisotropy(),
          );
          next.generateMipmaps = true;
          if (colorTexture) next.colorSpace = THREE.SRGBColorSpace;
          next.needsUpdate = true;
          return next;
        };

        const prepareMaterial = (source: THREE.Material) => {
          const material = source.clone();
          if (material instanceof THREE.MeshStandardMaterial) {
            material.map = prepareTexture(material.map, true);
            material.roughnessMap = prepareTexture(material.roughnessMap);
            material.metalnessMap = prepareTexture(material.metalnessMap);
            material.normalMap = prepareTexture(material.normalMap);
            material.aoMap = prepareTexture(material.aoMap);
            material.emissiveMap = prepareTexture(material.emissiveMap, true);

            // Preserve the GLB's authored PBR response. A very small emissive
            // lift is only used when the model already authored emissive data.
            if (!material.emissiveMap && material.emissive.getHex() === 0)
              material.emissiveIntensity = 0;
            material.needsUpdate = true;
          }
          creatureMaterials.add(material);
          return material;
        };

        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(prepareMaterial)
          : prepareMaterial(mesh.material);
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
      -center.z * scale + (landscape ? creatureZOffset : 0),
    );



    environment?.setCompanionShadowPosition?.(stage.position.x, stage.position.z);

    // Short-range back/rim light for the companion only visually: positioned
    // directly behind the Rebyter and aimed at its center so the forest does
    // not receive a broad lighting change.
    if (landscape) {
      companionRim = new THREE.SpotLight(
        0xd8f2ff,
        0.52,
        4.8,
        Math.PI / 5,
        0.7,
        2,
      );
      companionRim.position.set(
        stage.position.x - 0.15,
        (environment?.groundY ?? 0.18) + 2.45,
        stage.position.z - 2.15,
      );
      companionRimTarget = new THREE.Object3D();
      companionRimTarget.position.set(
        stage.position.x,
        (environment?.groundY ?? 0.18) + size.y * scale * 0.52,
        stage.position.z,
      );
      scene.add(companionRimTarget);
      companionRim.target = companionRimTarget;
      scene.add(companionRim);
      applyCinematicPeriod(environmentPeriod);
    }

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
    let transientAutoCompleteAt: number | null = null;
    let transientAutoCompleteAction: string | null = null;
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

      // Camera looks from +Z toward the origin, so negative Z is visually
      // "deeper into" the habitat. Drop the rock about three creature-steps
      // behind the companion, then walk there in a straight line.
      const groundY = (environment?.groundY ?? 0.18) + 0.26;
      const trainingDepth = 1.72;
      const walkTargetZ = baseStagePosition.z - trainingDepth;
      trainingRock.position.set(
        baseStagePosition.x + 0.88,
        groundY + 2.8,
        walkTargetZ,
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
      transientAutoCompleteAt = null;
      transientAutoCompleteAction = null;
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
      if (loop) {
        playClip(clip, false);
      } else {
        transientAction = playClip(clip, true);
        // Feeding clips often contain several repeated chewing cycles. Show the
        // readable first part, then blend back to idle instead of waiting for
        // the full authored clip or cutting it abruptly.
        if (live.current.action === "feed" && clip) {
          transientAutoCompleteAction = "feed";
          transientAutoCompleteAt =
            performance.now() / 1000 + Math.min(2.2, Math.max(1.55, clip.duration * 0.58));
        }
      }
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
        // Moving the companion deeper into the world naturally makes it climb
        // in screen space. Aim slightly higher in portrait so it stays visually
        // low near the HUD without lifting it off the terrain.
        controls.target.y =
          1.6 +
          (camera.aspect < 1
            ? 0.7 + Math.max(0, -creatureZOffset) * 0.22
            : 0);
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
          const dropEnd = 0.68;
          const faceBackEnd = 1.0;
          const walkEnd = 2.75;
          const faceRockEnd = 3.1;
          const attackEnd = faceRockEnd + powerTraining.attackDuration;
          const recoverEnd = attackEnd + 0.28;
          const faceHomeEnd = recoverEnd + 0.34;
          const returnEnd = faceHomeEnd + 1.7;
          const settleEnd = returnEnd + 0.28;

          const groundY = (environment?.groundY ?? 0.18) + 0.26;
          const trainingDepth = 1.72;
          const approach = baseStagePosition
            .clone()
            .add(new THREE.Vector3(0, 0, -trainingDepth));
          const rockBaseX = baseStagePosition.x + 0.88;

          if (elapsed < dropEnd) {
            const u = THREE.MathUtils.clamp(elapsed / dropEnd, 0, 1);
            const eased = 1 - Math.pow(1 - u, 3);
            trainingRock.position.y =
              THREE.MathUtils.lerp(groundY + 2.8, groundY, eased) +
              (u > 0.88 ? Math.sin((u - 0.88) * 38) * 0.045 * (1 - u) : 0);
          } else {
            trainingRock.position.y = groundY;
          }

          if (elapsed >= dropEnd && elapsed < faceBackEnd) {
            if (powerTraining.phase < 1) {
              powerTraining.phase = 1;
              playClip(findActionClip(live.current.clips, "idle"), false);
            }
            const u = THREE.MathUtils.smoothstep(
              (elapsed - dropEnd) / (faceBackEnd - dropEnd),
              0,
              1,
            );
            stage.position.copy(baseStagePosition);
            stage.rotation.y = THREE.MathUtils.lerp(
              baseStageRotationY,
              baseStageRotationY + Math.PI,
              u,
            );
          } else if (elapsed >= faceBackEnd && elapsed < walkEnd) {
            if (powerTraining.phase < 2) {
              powerTraining.phase = 2;
              playClip(findActionClip(live.current.clips, "walk"), false);
            }
            const u = THREE.MathUtils.smoothstep(
              (elapsed - faceBackEnd) / (walkEnd - faceBackEnd),
              0,
              1,
            );
            // Only move along Z: the Rebyter walks straight back into the world,
            // roughly three visible steps, without drifting sideways.
            stage.position.x = baseStagePosition.x;
            stage.position.y = baseStagePosition.y;
            stage.position.z = THREE.MathUtils.lerp(
              baseStagePosition.z,
              approach.z,
              u,
            );
            stage.rotation.y = baseStageRotationY + Math.PI;
          } else if (elapsed >= walkEnd && elapsed < faceRockEnd) {
            if (powerTraining.phase < 3) {
              powerTraining.phase = 3;
              playClip(findActionClip(live.current.clips, "idle"), false);
            }
            stage.position.copy(approach);
            const u = THREE.MathUtils.smoothstep(
              (elapsed - walkEnd) / (faceRockEnd - walkEnd),
              0,
              1,
            );
            // Rock is to his right at the end of the walk. Turn from facing
            // into the scene to a clean side profile facing +X.
            stage.rotation.y = THREE.MathUtils.lerp(
              baseStageRotationY + Math.PI,
              baseStageRotationY + Math.PI / 2,
              u,
            );
          } else if (elapsed >= faceRockEnd && elapsed < attackEnd) {
            if (powerTraining.phase < 4) {
              powerTraining.phase = 4;
              playClip(findActionClip(live.current.clips, "train"), true, 0.1);
            }
            stage.position.copy(approach);
            stage.rotation.y = baseStageRotationY + Math.PI / 2;
            const attackU =
              (elapsed - faceRockEnd) / powerTraining.attackDuration;
            if (attackU > 0.52) {
              const impact = THREE.MathUtils.clamp(
                (attackU - 0.52) / 0.18,
                0,
                1,
              );
              trainingRock.position.x = rockBaseX + impact * 0.18;
              trainingRock.rotation.z = -0.12 - impact * 0.28;
            }
          } else if (elapsed >= attackEnd && elapsed < recoverEnd) {
            if (powerTraining.phase < 5) {
              powerTraining.phase = 5;
              playClip(findActionClip(live.current.clips, "idle"), false);
            }
            stage.position.copy(approach);
            stage.rotation.y = baseStageRotationY + Math.PI / 2;
          } else if (elapsed >= recoverEnd && elapsed < faceHomeEnd) {
            if (powerTraining.phase < 6) {
              powerTraining.phase = 6;
              playClip(findActionClip(live.current.clips, "idle"), false);
            }
            stage.position.copy(approach);
            const u = THREE.MathUtils.smoothstep(
              (elapsed - recoverEnd) / (faceHomeEnd - recoverEnd),
              0,
              1,
            );
            stage.rotation.y = THREE.MathUtils.lerp(
              baseStageRotationY + Math.PI / 2,
              baseStageRotationY,
              u,
            );
          } else if (elapsed >= faceHomeEnd && elapsed < returnEnd) {
            if (powerTraining.phase < 7) {
              powerTraining.phase = 7;
              playClip(findActionClip(live.current.clips, "walk"), false);
            }
            const u = THREE.MathUtils.smoothstep(
              (elapsed - faceHomeEnd) / (returnEnd - faceHomeEnd),
              0,
              1,
            );
            stage.position.x = baseStagePosition.x;
            stage.position.y = baseStagePosition.y;
            stage.position.z = THREE.MathUtils.lerp(
              approach.z,
              baseStagePosition.z,
              u,
            );
            stage.rotation.y = baseStageRotationY;
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

        if (
          transientAutoCompleteAt !== null &&
          now / 1000 >= transientAutoCompleteAt
        ) {
          const completedAction = transientAutoCompleteAction;
          transientAutoCompleteAt = null;
          transientAutoCompleteAction = null;
          transientAction = null;
          playClip(findActionClip(live.current.clips, "idle"), false, 0.22);
          if (completedAction)
            live.current.onActionComplete?.(completedAction);
        }

        mixer.update(delta);
        environment?.setCompanionShadowPosition?.(
          stage.position.x,
          stage.position.z,
        );
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
          if (environment.consumeShadowUpdate?.())
            renderer.shadowMap.needsUpdate = true;
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
      key.shadow.dispose();
      creatureMaterials.forEach((material) => material.dispose());
      ground.geometry.dispose();
      ground.material.dispose();
      trainingRockGeometry.dispose();
      trainingRockMaterial.dispose();
      companionRim?.removeFromParent();
      companionRimTarget?.removeFromParent();
      companionRim?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [model, landscape, creatureScale, creatureYOffset, creatureZOffset, creatureVisualBoost]);
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
    configureHabitatRenderer(renderer);
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
    configureHabitatShadow(key, mobileRenderer);
    key.position.copy(env.lightPosition);
    const fill = new THREE.DirectionalLight(
      0xffefd9,
      env.colors.fillIntensity ?? 0.45,
    );
    fill.position.set(-3, 2, 4);
    const moonLight = new THREE.DirectionalLight(
      0xcfe2ff,
      env.colors.moonIntensity ?? 0,
    );
    moonLight.position.set(-4.5, 7, -5);
    const rimLight = new THREE.DirectionalLight(
      0x88dbff,
      env.colors.rimIntensity ?? 0,
    );
    rimLight.position.set(0, 3.8, -7);
    scene.add(fill, moonLight, rimLight, key);

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
      env.update(t);
      key.color.setHex(env.colors.light);
      key.intensity = env.colors.intensity;
      key.position.copy(env.lightPosition);
      hemi.intensity = env.colors.ambientIntensity ?? hemi.intensity;
      fill.intensity = env.colors.fillIntensity ?? fill.intensity;
      moonLight.intensity = env.colors.moonIntensity ?? 0;
      rimLight.intensity = env.colors.rimIntensity ?? 0;
      if (env.consumeShadowUpdate()) renderer.shadowMap.needsUpdate = true;
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
      key.shadow.dispose();
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
          creatureScale={evolution.stage === 0 ? 0.9 : 1}
          creatureYOffset={0}
          creatureZOffset={landscape ? -2.97 : 0}
          creatureVisualBoost={landscape}
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
