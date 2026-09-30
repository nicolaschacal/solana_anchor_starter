import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const FANGBIT_MODEL_URL = "/models/fangbit.glb";

/**
 * Final asset pipeline viewer.
 * Character modeling no longer happens in React/Three.js. Design Lab only
 * loads, presents and animates an authored GLB (mesh + UV + texture + rig).
 */
export function FangbitPrototype({ paused = false }: { paused?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing">("loading");

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.15, 4.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff5e8, 0x252b31, 2.1));
    const key = new THREE.DirectionalLight(0xfff4df, 1.7);
    key.position.set(-3, 5, 5);
    scene.add(key);

    const stage = new THREE.Group();
    scene.add(stage);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.13, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -1.02;
    scene.add(shadow);

    let model: THREE.Object3D | null = null;
    let mixer: THREE.AnimationMixer | null = null;
    let targetY = -0.18;
    let zoom = 4.2;
    let dragging = false;
    let lastX = 0;
    let raf = 0;
    const clock = new THREE.Clock();

    new GLTFLoader().load(
      FANGBIT_MODEL_URL,
      (gltf) => {
        model = gltf.scene;
        const box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const max = Math.max(size.x, size.y, size.z) || 1;
        model.position.sub(center);
        model.scale.setScalar(1.8 / max);
        stage.add(model);

        model.traverse((obj) => {
          if (obj instanceof THREE.Mesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (const material of materials) {
              if ("map" in material && material.map) {
                material.map.colorSpace = THREE.SRGBColorSpace;
                material.map.needsUpdate = true;
              }
            }
          }
        });

        if (gltf.animations.length) {
          mixer = new THREE.AnimationMixer(model);
          const idle = gltf.animations.find((clip) => /idle/i.test(clip.name)) ?? gltf.animations[0];
          mixer.clipAction(idle).play();
        }
        setStatus("ready");
      },
      undefined,
      () => setStatus("missing"),
    );

    const down = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      renderer.domElement.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      targetY += (e.clientX - lastX) * 0.008;
      lastX = e.clientX;
    };
    const up = () => { dragging = false; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.003, 1.8, 7);
    };

    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("wheel", wheel, { passive: false });

    const resize = () => {
      const r = el.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      camera.aspect = r.width / Math.max(1, r.height);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    const draw = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      stage.rotation.y += (targetY - stage.rotation.y) * 0.12;
      camera.position.z += (zoom - camera.position.z) * 0.15;
      if (!paused) mixer?.update(dt);
      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mixer?.stopAllAction();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [paused]);

  return (
    <div ref={host} className="wolf-prototype" aria-label="Fangbit GLB viewer">
      {status !== "ready" && (
        <div className="model-asset-status">
          {status === "loading"
            ? "Loading Fangbit GLB…"
            : "Fangbit GLB slot ready · /public/models/fangbit.glb"}
        </div>
      )}
    </div>
  );
}
