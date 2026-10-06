import * as THREE from "three";
import { disposeModel, parseModel } from "./rig";

const PREVIEW_SIZE = 768;

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode preview PNG."))),
      "image/png",
    );
  });
}

export async function renderEvolutionPreview(
  glb: ArrayBuffer,
): Promise<Blob> {
  const model = await parseModel(glb.slice(0));
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });

  try {
    renderer.setPixelRatio(1);
    renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;

    const root = model.scene;
    scene.add(root);
    root.updateMatrixWorld(true);

    let bounds = new THREE.Box3().setFromObject(root);
    const originalSize = bounds.getSize(new THREE.Vector3());
    if (
      !Number.isFinite(originalSize.x) ||
      !Number.isFinite(originalSize.y) ||
      !Number.isFinite(originalSize.z) ||
      originalSize.y <= 0
    ) {
      throw new Error("Could not frame the uploaded GLB.");
    }

    // Normalize every Rebyter to one portrait scale while preserving its
    // authored front direction. Rebyters face the +Z camera in the game.
    const normalizedHeight = 2.25;
    const scale = normalizedHeight / originalSize.y;
    root.scale.multiplyScalar(scale);
    root.updateMatrixWorld(true);

    bounds = new THREE.Box3().setFromObject(root);
    const center = bounds.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.y -= bounds.min.y;
    root.position.z -= center.z;
    root.updateMatrixWorld(true);

    bounds = new THREE.Box3().setFromObject(root);
    const size = bounds.getSize(new THREE.Vector3());
    const height = size.y;
    const width = Math.max(size.x, size.z * 0.65);

    const camera = new THREE.PerspectiveCamera(31, 1, 0.01, 100);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const fitHeightDistance = height / (2 * Math.tan(verticalFov / 2));
    const fitWidthDistance = width / (2 * Math.tan(verticalFov / 2));
    const distance = Math.max(fitHeightDistance, fitWidthDistance) * 1.22;
    const lookY = height * 0.49;
    camera.position.set(0, lookY + height * 0.04, distance);
    camera.lookAt(0, lookY, 0);

    // Studio-style lighting: bright face, soft fill, and restrained rim.
    scene.add(new THREE.HemisphereLight(0xf1f8ff, 0x53606b, 1.25));

    const key = new THREE.DirectionalLight(0xfff4df, 2.15);
    key.position.set(3.2, 4.4, 4.8);
    scene.add(key);

    const fill = new THREE.DirectionalLight(0xc9e8ff, 0.72);
    fill.position.set(-3.4, 2.1, 3.2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0xc7e9ff, 0.9);
    rim.position.set(0.5, 3.2, -4.2);
    scene.add(rim);

    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material]) {
        const standard = material as THREE.MeshStandardMaterial;
        if (standard.map) {
          standard.map.colorSpace = THREE.SRGBColorSpace;
          standard.map.anisotropy = Math.min(
            4,
            renderer.capabilities.getMaxAnisotropy(),
          );
          standard.map.needsUpdate = true;
        }
        if ("roughness" in standard)
          standard.roughness = Math.max(standard.roughness ?? 0.7, 0.72);
        material.needsUpdate = true;
      }
    });

    renderer.render(scene, camera);

    // Composite the transparent render over a consistent thumbnail background.
    const output = document.createElement("canvas");
    output.width = PREVIEW_SIZE;
    output.height = PREVIEW_SIZE;
    const context = output.getContext("2d");
    if (!context) throw new Error("Canvas 2D is unavailable.");

    const gradient = context.createLinearGradient(0, 0, 0, PREVIEW_SIZE);
    gradient.addColorStop(0, "#8fcdf4");
    gradient.addColorStop(0.56, "#bfe4f8");
    gradient.addColorStop(1, "#e8f5fb");
    context.fillStyle = gradient;
    context.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);

    context.save();
    context.translate(PREVIEW_SIZE / 2, PREVIEW_SIZE * 0.78);
    context.scale(1, 0.26);
    const shadow = context.createRadialGradient(0, 0, 8, 0, 0, PREVIEW_SIZE * 0.25);
    shadow.addColorStop(0, "rgba(26,54,72,.30)");
    shadow.addColorStop(1, "rgba(26,54,72,0)");
    context.fillStyle = shadow;
    context.beginPath();
    context.arc(0, 0, PREVIEW_SIZE * 0.25, 0, Math.PI * 2);
    context.fill();
    context.restore();

    context.drawImage(renderer.domElement, 0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
    return await canvasBlob(output);
  } finally {
    renderer.dispose();
    disposeModel(model);
  }
}
