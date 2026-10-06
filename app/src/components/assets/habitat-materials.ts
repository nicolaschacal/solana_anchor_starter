import * as THREE from "three";

type Disposable = { dispose(): void };
type Track = <T extends Disposable>(resource: T) => T;
type Wind = { time: { value: number }; gain: { value: number } };

// Small painted textures are shared across guest/player scenes and clock changes.
// No network images, async decoders, render targets or per-frame canvas painting.
const textures = new Map<string, THREE.CanvasTexture>();
function texture(key: string, width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  let result = textures.get(key);
  if (result) return result;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D is unavailable");
  paint(ctx);
  result = new THREE.CanvasTexture(canvas);
  result.colorSpace = THREE.SRGBColorSpace;
  textures.set(key, result);
  return result;
}

function random(seed: number) {
  return () => {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

export function meadowTexture() {
  const map = texture("meadow-ground", 512, 512, (ctx) => {
    const rand = random(7419);
    ctx.fillStyle = "#638c48";
    ctx.fillRect(0, 0, 512, 512);
    // Draw wrapped copies at edges, including the corners, for a seamless tile.
    const wrapped = (x: number, y: number, draw: () => void) => {
      for (const dx of [-512, 0, 512])
        for (const dy of [-512, 0, 512]) {
          ctx.save();
          ctx.translate(x + dx, y + dy);
          draw();
          ctx.restore();
        }
    };
    for (let i = 0; i < 58; i++) {
      const x = rand() * 512, y = rand() * 512, radius = 20 + rand() * 48;
      const tint = i % 2 ? "99,139,61" : "33,84,55";
      wrapped(x, y, () => {
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
        gradient.addColorStop(0, "rgba(" + tint + ",0.32)");
        gradient.addColorStop(1, "rgba(" + tint + ",0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
      });
    }
    // Fine overlapping brush strokes, never large polygons or grid-shaped dirt.
    const shades = ["#769d54", "#87a760", "#557e43", "#416f45", "#9caf70"];
    ctx.lineCap = "round";
    for (let i = 0; i < 2700; i++) {
      const x = rand() * 512, y = rand() * 512;
      const length = 3 + rand() * 9, lean = (rand() - 0.5) * 7;
      const shade = shades[Math.floor(rand() * shades.length)];
      const angle = rand() * Math.PI * 2;
      wrapped(x, y, () => {
        ctx.rotate(angle);
        ctx.strokeStyle = shade;
        ctx.lineWidth = 0.7 + (i % 3) * 0.45;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(lean * 0.25, -length * 0.55, lean, -length);
        ctx.stroke();
      });
    }
  });
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(40, 40); // 3m per tile on the 120m ground.
  map.anisotropy = 4;
  return map;
}

function grassTexture() {
  return texture("meadow-grass", 128, 128, (ctx) => {
    const rand = random(381);
    for (let i = 0; i < 21; i++) {
      const x = 8 + rand() * 110;
      const top = 22 + rand() * 68;
      const lean = (rand() - 0.5) * 25;
      const width = 2.3 + rand() * 2.8;
      const paint = ctx.createLinearGradient(0, 126, 0, top);
      paint.addColorStop(0, "#466e39");
      paint.addColorStop(0.5, i % 2 ? "#729747" : "#6c914c");
      paint.addColorStop(1, "#acc480");
      ctx.fillStyle = paint;
      ctx.beginPath();
      ctx.moveTo(x - width, 128);
      ctx.quadraticCurveTo(x - width, top + 21, x + lean, top);
      ctx.quadraticCurveTo(x + width * 0.3, top + 31, x + width, 128);
      ctx.fill();
    }
  });
}

export function grassCarpet(\n  mobile: boolean,\n  wind: Wind,\n  track: Track,\n  exclusions: { x: number; z: number; radius: number }[] = [],\n) {
  // Two crossed, alpha-cutout cards per tuft: the texture supplies soft, curved
  // leaf silhouettes. There are no cone, wedge or pyramid-shaped grass meshes.
  const geometry = track(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.31, 0, 0, 0.31, 0, 0, 0.31, 0.29, 0, -0.31, 0.29, 0,
    0, 0, -0.31, 0, 0, 0.31, 0, 0.29, 0.31, 0, 0.29, -0.31,
  ], 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([
    0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1,
  ], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  geometry.computeVertexNormals();
  const material = track(new THREE.MeshStandardMaterial({
    map: grassTexture(),
    color: 0xffffff,
    alphaTest: 0.4,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 1,
  }));
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGrassTime = wind.time;
    shader.uniforms.uGrassGain = wind.gain;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uGrassTime; uniform float uGrassGain;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vec2 origin = instanceMatrix[3].xz;
float height = clamp(position.y / 0.29, 0.0, 1.0);
float breeze = sin(uGrassTime * 1.15 + origin.x * 1.2 + origin.y * 0.7);
transformed.x += breeze * height * height * 0.045 * uGrassGain;
transformed.z += cos(uGrassTime * 0.8 + origin.y) * height * 0.018 * uGrassGain;`);
    // Upward shading blends the cards into the terrain from every viewing angle.
    // It avoids the dark checkerboard effect of crossed vertical planes.
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_begin>",
      "#include <normal_fragment_begin>\nnormal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0));",
    );
  };
  material.customProgramCacheKey = () => "rebyters-grass-cards-v1";
  const count = mobile ? 950 : 1800;
  const mesh = track(new THREE.InstancedMesh(geometry, material, count));
  const rand = random(8163), transform = new THREE.Object3D();
  const flowers: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    let x = 0, z = 0;
    let valid = false;
    for (let attempt = 0; attempt < 32; attempt++) {
      const farBank = i > count * 0.88;
      x = (rand() - 0.5) * (farBank ? 23 : 17);
      z = farBank ? -18 - rand() * 7 : -8.8 + rand() * 13;
      // Keep the companion's face/feet readable, leave the winding trail open,
      // and never grow grass through a solid pedestal.
      const nearCompanion = Math.abs(x) < 1.1 && z > -0.8 && z < 1.3;
      const pathCenter = 2.1 + (-z - 2) * 0.3;
      const onTrail = z < -2 && z > -10 && Math.abs(x - pathCenter) < 0.65;
      const insidePedestal = exclusions.some(
        (area) => Math.hypot(x - area.x, z - area.z) < area.radius,
      );
      if (!nearCompanion && !onTrail && !insidePedestal) {
        valid = true;
        break;
      }
    }
    const scale = valid ? 0.7 + rand() * 0.65 : 0;
    transform.position.set(x, 0.012, z);
    transform.rotation.set(0, rand() * Math.PI, 0);
    transform.scale.set(scale, scale * (z < -17 ? 0.8 : 1), scale);
    transform.updateMatrix();
    mesh.setMatrixAt(i, transform.matrix);
    mesh.setColorAt(i, new THREE.Color().setRGB(
      0.84 + rand() * 0.16, 0.9 + rand() * 0.1, 0.84 + rand() * 0.16,
    ));
    if (i % 31 === 0 && Math.abs(x) > 1.5 && Math.abs(x) < 5 && z > -7)
      flowers.push(new THREE.Vector3(x, 0.16 + rand() * 0.09, z));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return { mesh, flowers };
}

export function cloudGroup(own: Disposable[], color: number, variant: number) {
  const map = texture("meadow-cloud-" + variant, 256, 128, (ctx) => {
    const rand = random(2301 + variant * 753);
    // Soft painted cumulus with distinct irregular lobes and a lit upper edge.
    for (let i = 0; i < 14; i++) {
      const x = 30 + i * 14 + (rand() - 0.5) * 8;
      const y = 77 - Math.sin(i / 13 * Math.PI) * (25 + rand() * 17);
      const r = 18 + rand() * 12;
      const grad = ctx.createRadialGradient(x - 4, y - 8, 2, x, y, r);
      grad.addColorStop(0, "rgba(250,252,255,0.92)");
      grad.addColorStop(0.56, "rgba(218,233,249,0.85)");
      grad.addColorStop(0.84, "rgba(172,193,226,0.55)");
      grad.addColorStop(1, "rgba(151,177,216,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
  const material = new THREE.SpriteMaterial({
    map, color, transparent: true, depthWrite: false, depthTest: true,
    fog: false, toneMapped: false,
  });
  own.push(material); // The cached map belongs to the page, not this scene.
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.6, 1.8, 1);
  const group = new THREE.Group();
  group.add(sprite);
  return group;
}

export function moonTexture() {
  return texture("meadow-moon", 128, 128, (ctx) => {
    const rand = random(711);
    ctx.fillStyle = "#e5efff";
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 30; i++) {
      const x = rand() * 128, y = rand() * 128, r = 3 + rand() * 12;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, "rgba(111,142,188,0.22)");
      grad.addColorStop(1, "rgba(111,142,188,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

export function lakeMaterial(wind: Wind, sky: number, light: number) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      uTime: wind.time,
      uDeep: { value: new THREE.Color(0x167f96) },
      uSky: { value: new THREE.Color(sky) },
      uGlint: { value: new THREE.Color(light) },
      uNight: { value: 0 },
      uLightDirection: { value: new THREE.Vector3(0.35, 0.7, -0.6).normalize() },
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    },
    vertexShader: `varying vec3 vWaterWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWaterWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `uniform float uTime; uniform float uNight;
      uniform vec3 uDeep; uniform vec3 uSky; uniform vec3 uGlint;
      uniform vec3 uLightDirection;
      varying vec3 vWaterWorld;
      #include <fog_pars_fragment>
      void main() {
        vec2 p = vWaterWorld.xz;
        float a = dot(p, vec2(1.8, 2.9)) + uTime * 0.9;
        float b = dot(p, vec2(-3.8, 2.2)) - uTime * 0.7;
        float c = dot(p, vec2(7.1, 4.6)) + uTime * 1.3;
        vec2 slope = vec2(1.8, 2.9) * cos(a) * 0.032
          + vec2(-3.8, 2.2) * cos(b) * 0.018
          + vec2(7.1, 4.6) * cos(c) * 0.007;
        vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));
        vec3 view = normalize(cameraPosition - vWaterWorld);
        float fresnel = pow(1.0 - max(dot(normal, view), 0.0), 3.0);
        float wave = sin(a) * 0.5 + sin(b) * 0.3 + sin(c) * 0.2;
        vec3 color = mix(uDeep * (0.93 + wave * 0.13), uSky, 0.15 + fresnel * 0.38);
        vec3 halfDirection = normalize(view + uLightDirection);
        float specular = pow(max(dot(normal, halfDirection), 0.0), 72.0);
        // Broken horizontal glimmers form a moon path instead of parallel neon lines.
        float depth = clamp((-p.y - 9.5) / 7.0, 0.0, 1.0);
        float axis = mix(1.25, 2.7, depth) + sin(p.y * 1.7 + uTime * 0.45) * 0.18;
        float width = mix(1.5, 0.45, depth);
        float corridor = exp(-pow((p.x - axis) / width, 2.0));
        float crest = pow(0.5 + 0.5 * sin(p.y * 21.0 + sin(p.x * 7.0 + uTime * 0.4) + uTime * 1.4), 12.0);
        float breakup = smoothstep(-0.35, 0.8, sin(p.x * 13.0 - p.y * 5.0 + uTime * 0.55));
        color += uGlint * (specular * 0.22 + corridor * crest * breakup * mix(0.2, 0.65, uNight));
        gl_FragColor = vec4(color, 1.0);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
