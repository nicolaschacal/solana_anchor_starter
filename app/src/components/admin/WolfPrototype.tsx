import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Mood = "idle" | "curious" | "happy" | "angry" | "sleepy" | "playful";

const C = {
  fur: 0x3f3d52,
  fur2: 0x4c4860,
  dark: 0x2b2939,
  cream: 0xebdbb8,
  cream2: 0xf8e8c1,
  pink: 0xc65a58,
  gold: 0xeb9728,
  orange: 0xd05c29,
  black: 0x231f25,
  white: 0xfff7e0,
};

function mat(color: number) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.92,
    metalness: 0,
    flatShading: true,
  });
}

function ico(
  material: THREE.Material,
  scale: [number, number, number],
  detail = 0,
) {
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, detail), material);
  mesh.scale.set(...scale);
  return mesh;
}

function pyramid(
  material: THREE.Material,
  width: number,
  height: number,
  depth: number,
) {
  const w = width / 2;
  const h = height / 2;
  const vertices = new Float32Array([
    -w, -h, 0,
     w, -h, 0,
     w,  h, 0,
    -w,  h, 0,
     0,  0, depth,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    0, 4, 1, 1, 4, 2,
    2, 4, 3, 3, 4, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

function earGeometry() {
  const vertices = new Float32Array([
    -0.17, -0.22,  0.06,
     0.17, -0.22,  0.06,
     0.04,  0.36,  0.03,
    -0.13, -0.22, -0.16,
     0.13, -0.22, -0.16,
     0.03,  0.30, -0.10,
  ]);
  const indices = [
    0, 1, 2, 3, 5, 4,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function eyeDisc(material: THREE.Material, rx: number, ry: number, z: number) {
  const n = 8;
  const vertices: number[] = [0, 0, z];
  const indices: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    vertices.push(Math.cos(a) * rx, Math.sin(a) * ry, 0);
  }
  for (let i = 0; i < n; i++) indices.push(0, i + 1, ((i + 1) % n) + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return new THREE.Mesh(g, material);
}

function fangGeometry(material: THREE.Material) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.105, 5), material);
  m.rotation.x = Math.PI;
  return m;
}

function buildFangbit() {
  const materials = {
    fur: mat(C.fur),
    fur2: mat(C.fur2),
    dark: mat(C.dark),
    cream: mat(C.cream),
    cream2: mat(C.cream2),
    pink: mat(C.pink),
    gold: mat(C.gold),
    orange: mat(C.orange),
    black: mat(C.black),
    white: mat(C.white),
  };

  const root = new THREE.Group();
  root.name = "Fangbit";

  const bodyPivot = new THREE.Group();
  bodyPivot.name = "BodyPivot";
  bodyPivot.position.set(0, -0.31, -0.08);
  root.add(bodyPivot);

  const body = ico(materials.fur, [0.62, 0.56, 0.50], 1);
  body.name = "Body";
  bodyPivot.add(body);

  const neck = ico(materials.dark, [0.43, 0.34, 0.37], 0);
  neck.position.set(0, 0.31, 0.18);
  bodyPivot.add(neck);

  const chest = ico(materials.cream, [0.29, 0.30, 0.07], 0);
  chest.position.set(0, -0.02, 0.50);
  bodyPivot.add(chest);
  const chestTip = pyramid(materials.cream, 0.27, 0.19, 0.16);
  chestTip.position.set(0, -0.26, 0.50);
  chestTip.rotation.x = -0.25;
  bodyPivot.add(chestTip);

  const legPivots: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? "L" : "R";
    const front = new THREE.Group();
    front.name = `FrontLeg${side}`;
    front.position.set(0.39 * sx, -0.26, 0.27);
    const frontLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.36, 0.28),
      materials.dark,
    );
    frontLeg.position.y = -0.09;
    front.add(frontLeg);
    const frontPaw = ico(materials.cream2, [0.17, 0.10, 0.19], 0);
    frontPaw.position.set(0, -0.29, 0.13);
    front.add(frontPaw);
    for (const tx of [-0.05, 0.05]) {
      const toe = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.055, 0.025), materials.dark);
      toe.position.set(tx, -0.305, 0.31);
      front.add(toe);
    }
    bodyPivot.add(front);
    legPivots.push(front);

    const rear = new THREE.Group();
    rear.name = `RearLeg${side}`;
    rear.position.set(0.46 * sx, -0.25, -0.20);
    const rearLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.36, 0.32),
      materials.fur2,
    );
    rearLeg.position.y = -0.10;
    rear.add(rearLeg);
    const rearPaw = ico(materials.cream, [0.18, 0.10, 0.21], 0);
    rearPaw.position.set(0, -0.29, 0.18);
    rear.add(rearPaw);
    bodyPivot.add(rear);
    legPivots.push(rear);
  }

  const tailPivot = new THREE.Group();
  tailPivot.name = "TailPivot";
  tailPivot.position.set(0.48, -0.04, -0.46);
  bodyPivot.add(tailPivot);
  const tailBase = ico(materials.dark, [0.16, 0.29, 0.16], 0);
  tailBase.rotation.z = -0.45;
  tailPivot.add(tailBase);
  const tailMid = ico(materials.fur2, [0.20, 0.32, 0.18], 0);
  tailMid.position.set(0.20, 0.28, 0.03);
  tailMid.rotation.z = -0.38;
  tailPivot.add(tailMid);
  const tailTip = ico(materials.cream, [0.18, 0.25, 0.15], 0);
  tailTip.position.set(0.31, 0.56, 0.08);
  tailTip.rotation.z = -0.28;
  tailPivot.add(tailTip);
  const tailPoint = pyramid(materials.cream2, 0.18, 0.18, 0.18);
  tailPoint.position.set(0.34, 0.76, 0.10);
  tailPoint.rotation.z = -0.55;
  tailPivot.add(tailPoint);

  const headPivot = new THREE.Group();
  headPivot.name = "HeadPivot";
  headPivot.position.set(0, 0.47, 0.10);
  root.add(headPivot);

  const head = ico(materials.fur2, [0.72, 0.62, 0.56], 1);
  head.name = "Head";
  headPivot.add(head);

  // Dark cheek/head tufts define the silhouette rather than being painted noise.
  const tuftSpecs: Array<[number, number, number, number, number]> = [
    [-0.62, 0.10, 0.12, -0.33, 0.10],
    [ 0.62, 0.10, 0.12,  0.33, 0.10],
    [-0.60,-0.12, 0.10, -0.30, 0.10],
    [ 0.60,-0.12, 0.10,  0.30, 0.10],
    [-0.41, 0.49,-0.04, -0.20, 0.12],
    [ 0.41, 0.49,-0.04,  0.20, 0.12],
    [ 0.00, 0.55, 0.00,  0.00, 0.14],
  ];
  tuftSpecs.forEach(([x, y, z, rz, size], i) => {
    const tuft = pyramid(materials.dark, size * 2.0, size * 1.7, size * 1.8);
    tuft.name = `HeadTuft${i}`;
    tuft.position.set(x, y, z);
    tuft.rotation.z = rz;
    if (x < 0) tuft.rotation.y = -0.65;
    else if (x > 0) tuft.rotation.y = 0.65;
    headPivot.add(tuft);
  });

  const earPivots: THREE.Group[] = [];
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? "L" : "R";
    const ep = new THREE.Group();
    ep.name = `Ear${side}Pivot`;
    ep.position.set(0.48 * sx, 0.48, -0.06);
    ep.rotation.z = sx * -0.06;
    const outer = new THREE.Mesh(earGeometry(), materials.dark);
    outer.name = `Ear${side}`;
    if (sx < 0) outer.scale.x = -1;
    ep.add(outer);
    const inner = pyramid(materials.pink, 0.17, 0.34, 0.018);
    inner.name = `InnerEar${side}`;
    inner.position.set(0, 0.02, 0.085);
    ep.add(inner);
    headPivot.add(ep);
    earPivots.push(ep);
  }

  const creamTufts: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? "L" : "R";
    const cheek = ico(materials.cream, [0.35, 0.27, 0.095], 0);
    cheek.name = `Cheek${side}`;
    cheek.position.set(0.31 * sx, -0.13, 0.52);
    headPivot.add(cheek);

    const ctuft = pyramid(materials.cream, 0.22, 0.20, 0.20);
    ctuft.name = `CreamTuft${side}`;
    ctuft.position.set(0.53 * sx, -0.14, 0.50);
    ctuft.rotation.y = sx * 0.78;
    ctuft.rotation.z = sx * 0.10;
    headPivot.add(ctuft);
    creamTufts.push(ctuft);
  }

  const blaze = pyramid(materials.cream2, 0.20, 0.48, 0.028);
  blaze.name = "Blaze";
  blaze.position.set(0, 0.18, 0.575);
  blaze.rotation.z = Math.PI / 4;
  blaze.scale.x = 0.66;
  headPivot.add(blaze);

  const eyeGroups: THREE.Group[] = [];
  const brows: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? "L" : "R";
    const eg = new THREE.Group();
    eg.name = `Eye${side}Group`;
    eg.position.set(0.245 * sx, 0.02, 0.59);
    const eye = eyeDisc(materials.black, 0.155, 0.205, 0.012);
    eg.add(eye);
    const iris = eyeDisc(materials.gold, 0.10, 0.135, 0.022);
    iris.position.z = 0.015;
    eg.add(iris);
    const pupil = eyeDisc(materials.black, 0.044, 0.087, 0.032);
    pupil.position.z = 0.03;
    eg.add(pupil);
    const glint = eyeDisc(materials.white, 0.023, 0.030, 0.04);
    glint.position.set(-0.028 * sx, 0.06, 0.044);
    eg.add(glint);
    headPivot.add(eg);
    eyeGroups.push(eg);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.05), materials.dark);
    brow.name = `Brow${side}`;
    brow.position.set(0.25 * sx, 0.22, 0.60);
    brow.rotation.z = sx * -0.18;
    headPivot.add(brow);
    brows.push(brow);

    const muzzle = ico(materials.cream2, [0.22, 0.16, 0.15], 0);
    muzzle.name = `Muzzle${side}`;
    muzzle.position.set(0.125 * sx, -0.27, 0.59);
    headPivot.add(muzzle);

    const fang = fangGeometry(materials.cream2);
    fang.name = `Fang${side}`;
    fang.position.set(0.12 * sx, -0.40, 0.69);
    headPivot.add(fang);
  }

  const nose = pyramid(materials.black, 0.20, 0.14, 0.09);
  nose.name = "Nose";
  nose.position.set(0, -0.21, 0.735);
  nose.rotation.z = Math.PI / 4;
  nose.scale.y = 0.72;
  headPivot.add(nose);

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.024, 0.025), materials.black);
  mouth.name = "Mouth";
  mouth.position.set(0, -0.34, 0.69);
  headPivot.add(mouth);

  root.userData.parts = {
    headPivot,
    bodyPivot,
    tailPivot,
    earPivots,
    eyeGroups,
    brows,
    legPivots,
  };
  root.userData.materials = materials;
  return root;
}

export function FangbitPrototype({ paused = false }: { paused?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const [moodLabel, setMoodLabel] = useState<Mood>("idle");

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    camera.position.set(0, 0.12, 4.0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xfff4e4, 0x202430, 2.1));
    const key = new THREE.DirectionalLight(0xfff1d8, 1.8);
    key.position.set(-3.5, 5, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x8494c9, 0.65);
    rim.position.set(4, 2, -3);
    scene.add(rim);

    const stage = new THREE.Group();
    scene.add(stage);
    const model = buildFangbit();
    stage.add(model);

    model.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.scale.setScalar(1.95 / Math.max(size.x, size.y, size.z));

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.78, 28),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -0.94;
    scene.add(shadow);

    const parts = model.userData.parts as {
      headPivot: THREE.Group;
      bodyPivot: THREE.Group;
      tailPivot: THREE.Group;
      earPivots: THREE.Group[];
      eyeGroups: THREE.Group[];
      brows: THREE.Mesh[];
      legPivots: THREE.Group[];
    };

    const base = {
      headPos: parts.headPivot.position.clone(),
      bodyPos: parts.bodyPivot.position.clone(),
      tailRot: parts.tailPivot.rotation.clone(),
      earRot: parts.earPivots.map((x) => x.rotation.clone()),
      browRot: parts.brows.map((x) => x.rotation.clone()),
      legRot: parts.legPivots.map((x) => x.rotation.clone()),
    };

    let mood: Mood = "idle";
    let moodUntil = 0;
    let lastInteraction = performance.now();
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let downX = 0;
    let downAt = 0;
    let lastTap = 0;
    let targetY = -0.18;
    let zoom = 4.0;
    let raf = 0;
    const clock = new THREE.Clock();

    const setMood = (next: Mood, ms = 1600) => {
      mood = next;
      moodUntil = performance.now() + ms;
      lastInteraction = performance.now();
      setMoodLabel(next);
    };

    const down = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = downX = e.clientX;
      downAt = performance.now();
      renderer.domElement.setPointerCapture(e.pointerId);
      lastInteraction = performance.now();
    };
    const move = (e: PointerEvent) => {
      if (!dragging) return;
      if (Math.abs(e.clientX - downX) > 5) moved = true;
      targetY += (e.clientX - lastX) * 0.008;
      lastX = e.clientX;
    };
    const up = () => {
      const now = performance.now();
      const held = now - downAt;
      dragging = false;
      if (moved) return;
      if (held > 550) {
        setMood("angry", 1500);
        return;
      }
      if (now - lastTap < 330) {
        setMood("happy", 1800);
        lastTap = 0;
      } else {
        setMood("playful", 1300);
        lastTap = now;
      }
    };
    const enter = () => {
      if (!dragging && performance.now() > moodUntil) setMood("curious", 1100);
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      lastInteraction = performance.now();
      zoom = THREE.MathUtils.clamp(zoom + e.deltaY * 0.003, 1.8, 7);
    };

    renderer.domElement.addEventListener("pointerdown", down);
    renderer.domElement.addEventListener("pointermove", move);
    renderer.domElement.addEventListener("pointerup", up);
    renderer.domElement.addEventListener("pointerenter", enter);
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
      const now = performance.now();
      const t = now / 1000;

      if (now > moodUntil && mood !== "idle") {
        mood = now - lastInteraction > 9000 ? "sleepy" : "idle";
        setMoodLabel(mood);
      }
      if (mood === "idle" && now - lastInteraction > 9000) {
        mood = "sleepy";
        setMoodLabel("sleepy");
      }

      stage.rotation.y += (targetY - stage.rotation.y) * 0.12;
      camera.position.z += (zoom - camera.position.z) * 0.15;

      // Deterministic pose from the approved 2D expression sheet.
      parts.headPivot.position.copy(base.headPos);
      parts.bodyPivot.position.copy(base.bodyPos);
      parts.headPivot.rotation.set(0, 0, 0);
      parts.bodyPivot.rotation.set(0, 0, 0);
      parts.tailPivot.rotation.copy(base.tailRot);
      parts.earPivots.forEach((x, i) => x.rotation.copy(base.earRot[i]));
      parts.brows.forEach((x, i) => x.rotation.copy(base.browRot[i]));
      parts.legPivots.forEach((x, i) => x.rotation.copy(base.legRot[i]));
      parts.eyeGroups.forEach((x) => x.scale.set(1, 1, 1));

      if (!paused) {
        const blinkPhase = t % 3.4;
        const blink = blinkPhase < 0.11 ? 0.08 : 1;
        parts.eyeGroups.forEach((x) => x.scale.y = blink);

        if (mood === "idle") {
          model.position.y += Math.sin(t * 2.0) * 0.012;
          parts.headPivot.rotation.z = Math.sin(t * 1.35) * 0.012;
          parts.tailPivot.rotation.z += Math.sin(t * 2.2) * 0.16;
          parts.earPivots[0].rotation.z += Math.sin(t * 1.7) * 0.025;
          parts.earPivots[1].rotation.z -= Math.sin(t * 1.7) * 0.025;
        } else if (mood === "curious") {
          parts.headPivot.rotation.z = 0.18;
          parts.headPivot.rotation.x = -0.05;
          parts.headPivot.position.y += 0.035;
          parts.earPivots[0].rotation.z += 0.09;
          parts.earPivots[1].rotation.z -= 0.04;
          parts.tailPivot.rotation.z += Math.sin(t * 5.2) * 0.10;
        } else if (mood === "happy") {
          const bounce = Math.abs(Math.sin(t * 6.0)) * 0.08;
          parts.bodyPivot.position.y += bounce;
          parts.headPivot.position.y += bounce * 1.25;
          parts.headPivot.rotation.z = Math.sin(t * 5.0) * 0.045;
          parts.tailPivot.rotation.z += Math.sin(t * 8.0) * 0.34;
          parts.eyeGroups.forEach((x) => x.scale.y = 0.45);
        } else if (mood === "angry") {
          parts.headPivot.position.y -= 0.04;
          parts.headPivot.position.z += 0.07;
          parts.headPivot.rotation.x = 0.10;
          parts.brows[0].rotation.z = -0.48;
          parts.brows[1].rotation.z = 0.48;
          parts.tailPivot.rotation.z -= 0.10;
          parts.legPivots[0].rotation.z = -0.05;
          parts.legPivots[1].rotation.z = 0.05;
        } else if (mood === "sleepy") {
          parts.headPivot.position.y -= 0.13;
          parts.headPivot.position.z += 0.025;
          parts.headPivot.rotation.x = 0.24;
          parts.headPivot.rotation.z = -0.035;
          parts.bodyPivot.position.y -= 0.045;
          parts.eyeGroups.forEach((x) => x.scale.y = 0.08);
          parts.tailPivot.rotation.z -= 0.17;
        } else if (mood === "playful") {
          const hop = Math.max(0, Math.sin(t * 7.2)) * 0.10;
          parts.bodyPivot.position.y += hop;
          parts.headPivot.position.y += hop * 1.4;
          parts.headPivot.rotation.z = Math.sin(t * 7.2) * 0.11;
          parts.headPivot.rotation.x = -0.05 + Math.sin(t * 7.2) * 0.045;
          parts.tailPivot.rotation.z += Math.sin(t * 10.5) * 0.42;
          parts.earPivots[0].rotation.z += Math.sin(t * 7) * 0.06;
          parts.earPivots[1].rotation.z -= Math.sin(t * 7) * 0.06;
        }
      }

      renderer.render(scene, camera);
      raf = requestAnimationFrame(draw);
      void dt;
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", down);
      renderer.domElement.removeEventListener("pointermove", move);
      renderer.domElement.removeEventListener("pointerup", up);
      renderer.domElement.removeEventListener("pointerenter", enter);
      renderer.domElement.removeEventListener("wheel", wheel);
      renderer.dispose();
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          const ms = Array.isArray(obj.material) ? obj.material : [obj.material];
          ms.forEach((m) => m.dispose());
        }
      });
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [paused]);

  return (
    <div ref={host} className="wolf-prototype" aria-label={`Fangbit 3D model · ${moodLabel}`}>
      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 10,
          zIndex: 2,
          padding: "5px 8px",
          borderRadius: 6,
          fontSize: 10,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          background: "rgba(12,18,18,.68)",
          border: "1px solid rgba(255,255,255,.08)",
          pointerEvents: "none",
        }}
      >
        {moodLabel}
      </div>
    </div>
  );
}
