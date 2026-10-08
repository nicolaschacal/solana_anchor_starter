import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";

/**
 * The 3D evolution sequence. The creature's real model is dissolved into
 * particles, which pair up bottom-to-top with the next form's surface, braid
 * into a double helix, collapse to a point, flash, and are reprinted as the
 * new model.
 *
 * Time is owned by `EvolutionClock`, which holds at the helix while the
 * evolve transaction is still pending.
 */

/** Seconds. The clock holds at `hold` until the transaction settles. */
export const TIMELINE = {
  dissolve: 0.55,
  form: 0.7,
  hold: 1.75,
  collapse: 1.75,
  flash: 2.2,
  reprint: 2.25,
  reprintEnd: 3.05,
  reveal: 3.15,
  settle: 3.5,
  /** `skip` jumps here once the transaction has settled. */
  skipTo: 3.7,
  hit: 0.07,
  // Reduced motion: a plain cross-fade once the transaction settles.
  reducedFade: 0.7,
  reducedReveal: 1.1,
} as const;

const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t), 3);

export class EvolutionClock {
  time = 0;
  /** Helix rotation. Keeps running while the clock holds, so the wait still moves. */
  spin = 0;
  /** True from the instant of the flash. */
  flashed = false;
  /** The flash happened during the last `advance`. */
  justFlashed = false;
  /** Frozen on the flash for a few frames. */
  private hitLeft = 0;

  get waiting() {
    return !this.flashed && this.time >= TIMELINE.hold;
  }

  advance(dt: number, settled: boolean) {
    this.justFlashed = false;
    if (this.hitLeft > 0) {
      this.hitLeft -= dt;
      return;
    }
    const holding = !settled && this.time >= TIMELINE.hold && !this.flashed;
    this.spin +=
      dt *
      (2.2 +
        3.2 * smooth(0, TIMELINE.hold, this.time) +
        (this.time > TIMELINE.collapse ? 8 * smooth(TIMELINE.collapse, TIMELINE.flash, this.time) : 0));
    if (holding) {
      this.time = TIMELINE.hold;
      return;
    }
    this.time += dt;
    if (!this.flashed && this.time >= TIMELINE.flash) {
      this.flashed = true;
      this.justFlashed = true;
      this.hitLeft = TIMELINE.hit;
    }
  }

  skip(settled: boolean) {
    if (settled) {
      this.time = Math.max(this.time, TIMELINE.skipTo);
      this.flashed = true;
    } else if (this.time < TIMELINE.hold) {
      this.time = TIMELINE.hold;
    }
  }
}

export type FxAsset = { scene: THREE.Object3D; clips?: THREE.AnimationClip[] };
export type FxOptions = { fromStage: number; toStage: number; reducedMotion?: boolean };
export type FxUi = { reveal: number; stageReached: boolean; waiting: boolean };

type DissolveUniforms = {
  uD: { value: number };
  uDir: { value: number };
  uH: { value: number };
  uEdge: { value: THREE.Color };
  uAm: { value: number };
};
type Prepared = {
  holder: THREE.Group;
  root: THREE.Object3D;
  u: DissolveUniforms;
  mixer?: THREE.AnimationMixer;
};
type Samples = { pos: Float32Array; col: Float32Array };

const N = 14000;
const CYAN = new THREE.Color("#52f0d8");
const AMBER = new THREE.Color("#ffc968");
const WHITE = new THREE.Color("#ffffff");
const VOID = "#030a18";
const SSR = "#define SSR(a,b,x) (1.-smoothstep(b,a,x))\n";
const PASS_VERT = "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}";

/** Scale to the target height without exceeding the target width, stand on the floor, centre. */
function prepare(asset: FxAsset, height: number, width: number): Prepared {
  const root = asset.scene;
  const holder = new THREE.Group();
  holder.add(root);
  holder.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(holder);
  const size = box.getSize(new THREE.Vector3());
  const scale = Math.min(height / Math.max(size.y, 1e-6), width / Math.max(size.x, size.z, 1e-6));
  root.scale.multiplyScalar(scale);
  holder.updateWorldMatrix(true, true);
  const fit = new THREE.Box3().setFromObject(holder);
  root.position.x -= (fit.min.x + fit.max.x) / 2;
  root.position.z -= (fit.min.z + fit.max.z) / 2;
  root.position.y -= fit.min.y;
  holder.updateWorldMatrix(true, true);
  const finalBox = new THREE.Box3().setFromObject(holder);
  const u: DissolveUniforms = {
    uD: { value: 0 },
    uDir: { value: 1 },
    uH: { value: Math.max(finalBox.max.y, 0.01) },
    uEdge: { value: CYAN.clone().multiplyScalar(2.6) },
    uAm: { value: 0 },
  };
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.frustumCulled = false;
    // Degenerate normals turn into NaN pixels, which the bloom would smear over the screen.
    const normals = mesh.geometry.getAttribute("normal");
    let bad = !normals;
    for (let i = 0; normals && i < normals.count && !bad; i++)
      if (!(normals.getX(i) ** 2 + normals.getY(i) ** 2 + normals.getZ(i) ** 2 > 1e-6)) bad = true;
    if (bad && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.geometry.computeVertexNormals();
    const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((source) => {
      const material = source.clone();
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, u);
        shader.vertexShader = shader.vertexShader
          .replace("void main() {", "varying vec3 vDW;\nvoid main() {")
          .replace("#include <project_vertex>", "#include <project_vertex>\nvDW=(modelMatrix*vec4(transformed,1.)).xyz;");
        shader.fragmentShader = shader.fragmentShader
          .replace(
            "void main() {",
            `${SSR}uniform float uD,uDir,uH,uAm;uniform vec3 uEdge;varying vec3 vDW;
float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vn(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main() {
 float yy=clamp(vDW.y/uH,0.,1.);
 float nz=vn(vDW*9.)*.5+vn(vDW*21.)*.25;
 float key=mix(1.-yy,yy,step(0.,uDir))*.55+nz*.6;
 if(uD>0.&&key<uD*1.15-.08)discard;`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
 {float e=SSR(.1,0.,key-(uD*1.15-.08))*step(.001,uD)*step(uD,.999);totalEmissiveRadiance+=uEdge*e*3.;totalEmissiveRadiance+=uEdge*uAm;}`,
          );
      };
      material.needsUpdate = true;
      return material;
    });
    mesh.material = Array.isArray(mesh.material) ? own : own[0];
  });
  let mixer: THREE.AnimationMixer | undefined;
  if (asset.clips?.length) {
    mixer = new THREE.AnimationMixer(root);
    const clip = asset.clips.find((c) => /idle/i.test(c.name)) ?? asset.clips[0];
    mixer.clipAction(clip).play();
  }
  return { holder, root, u, mixer };
}

/** N coloured points on the model's surface, in world space. */
function sample(model: Prepared): Samples {
  model.holder.updateWorldMatrix(true, true);
  const meshes: { mesh: THREE.Mesh; area: number }[] = [];
  let total = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  model.root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    const pos = mesh.isMesh ? mesh.geometry.getAttribute("position") : undefined;
    if (!pos) return;
    const index = mesh.geometry.index;
    const tris = index ? index.count / 3 : pos.count / 3;
    let area = 0;
    for (let t = 0; t < tris; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0);
      b.fromBufferAttribute(pos, i1);
      c.fromBufferAttribute(pos, i2);
      area += b.sub(a).cross(c.sub(a)).length() / 2;
    }
    const scale = mesh.matrixWorld.getMaxScaleOnAxis();
    area *= scale * scale;
    if (area > 0) {
      meshes.push({ mesh, area });
      total += area;
    }
  });
  if (!meshes.length) throw new Error("The model has no surface to sample");

  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const vertexColor = new THREE.Color();
  const uv = new THREE.Vector2();
  const texel = new THREE.Color();
  let n = 0;
  meshes.forEach(({ mesh, area }, mi) => {
    const count = mi === meshes.length - 1 ? N - n : Math.round((N * area) / total);
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    const standard = material as THREE.MeshStandardMaterial;
    const base = standard.color ? standard.color.clone() : new THREE.Color("#cccccc");
    const map = standard.map;
    let pixels: ImageData | null = null;
    const image = map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
    if (image && image.width) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(image, 0, 0);
          pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        }
      } catch {
        pixels = null; // tainted or unreadable texture: fall back to the material colour
      }
    }
    const hasVertexColor = !!mesh.geometry.getAttribute("color");
    const sampler = new MeshSurfaceSampler(mesh).build();
    for (let i = 0; i < count && n < N; i++, n++) {
      let r = base.r;
      let g = base.g;
      let bl = base.b;
      let tries = 0;
      for (;;) {
        sampler.sample(point, normal, vertexColor, uv);
        if (!pixels || !map) break;
        const u = uv.x - Math.floor(uv.x);
        const v = uv.y - Math.floor(uv.y);
        const px = Math.min(pixels.width - 1, Math.floor(u * pixels.width));
        const py = Math.min(pixels.height - 1, Math.floor((map.flipY ? 1 - v : v) * pixels.height));
        const k = (py * pixels.width + px) * 4;
        // Transparent texels (sprite fallbacks) are skipped.
        if (pixels.data[k + 3] < 80 && ++tries < 12) continue;
        texel.setRGB(pixels.data[k] / 255, pixels.data[k + 1] / 255, pixels.data[k + 2] / 255, THREE.SRGBColorSpace);
        r *= texel.r;
        g *= texel.g;
        bl *= texel.b;
        break;
      }
      if (hasVertexColor) {
        r *= vertexColor.r;
        g *= vertexColor.g;
        bl *= vertexColor.b;
      }
      point.applyMatrix4(mesh.matrixWorld);
      pos.set([point.x, point.y, point.z], n * 3);
      col.set([r, g, bl], n * 3);
    }
  });
  return { pos, col };
}

/** Sort by height so old and new pair bottom to bottom. */
function sortByHeight(s: Samples): Samples {
  const order = Array.from({ length: N }, (_, i) => i).sort((p, q) => s.pos[p * 3 + 1] - s.pos[q * 3 + 1]);
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  order.forEach((k, i) => {
    pos.set(s.pos.subarray(k * 3, k * 3 + 3), i * 3);
    col.set(s.col.subarray(k * 3, k * 3 + 3), i * 3);
  });
  return { pos, col };
}

export class EvolutionFx {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 80);
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private post: ShaderPass;
  private clock = new EvolutionClock();
  private from: Prepared;
  private to: Prepared;
  private points: THREE.Points;
  private morph: THREE.ShaderMaterial;
  private floor: THREE.ShaderMaterial;
  private column: THREE.Mesh;
  private columnMat: THREE.ShaderMaterial;
  private embers: THREE.ShaderMaterial;
  private rings: THREE.Mesh[] = [];
  private shell: THREE.Mesh;
  private shellMat: THREE.ShaderMaterial;
  private wave: THREE.Mesh;
  private waveMat: THREE.MeshBasicMaterial;
  private rimA: THREE.PointLight;
  private rimB: THREE.PointLight;
  private core: THREE.PointLight;
  private target = new THREE.Vector3(0, 1.15, 0);
  private wall = 0;
  private shake = 0;
  private flashLevel = 0;
  private reducedTime = 0;
  private lastSettled = false;
  private readonly reduced: boolean;
  private size = { w: 0, h: 0 };

  constructor(
    private canvas: HTMLCanvasElement,
    assets: { from: FxAsset; to: FxAsset },
    options: FxOptions,
  ) {
    this.reduced = !!options.reducedMotion;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color(VOID);
    this.scene.fog = new THREE.FogExp2(VOID, 0.045);

    // Lights
    this.scene.add(new THREE.HemisphereLight("#9fd8ff", "#16102a", 1.05));
    const key = new THREE.DirectionalLight("#ffffff", 2.4);
    key.position.set(3, 6, 4);
    this.scene.add(key);
    this.rimA = new THREE.PointLight("#52f0d8", 18, 14, 2);
    this.rimA.position.set(-3.2, 2.2, -2.4);
    this.rimB = new THREE.PointLight("#ffc968", 5, 14, 2);
    this.rimB.position.set(3.4, 1.2, -2.8);
    this.core = new THREE.PointLight("#bffcf2", 0, 9, 2);
    this.core.position.set(0, 1.2, 0);
    this.scene.add(this.rimA, this.rimB, this.core);

    // Post: scene → NaN guard → bloom → chromatic split / vignette / flash → tone map
    const composer = new EffectComposer(renderer);
    this.composer = composer;
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: PASS_VERT,
        fragmentShader:
          "uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);if(any(isnan(c))||any(isinf(c)))c=vec4(0.);gl_FragColor=vec4(clamp(c.rgb,0.,24.),c.a);}",
      }),
    );
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.4, 0.55, 0.9);
    composer.addPass(this.bloom);
    this.post = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uCA: { value: 0 }, uVig: { value: 0.55 }, uFlash: { value: 0 } },
      vertexShader: PASS_VERT,
      fragmentShader: `uniform sampler2D tDiffuse;uniform float uCA,uVig,uFlash;varying vec2 vUv;
 void main(){vec2 d=vUv-.5;float r=length(d);vec2 o=normalize(d+1e-5)*uCA*(.2+r*1.6);
  vec3 c=vec3(texture2D(tDiffuse,vUv+o).r,texture2D(tDiffuse,vUv).g,texture2D(tDiffuse,vUv-o).b);
  c*=1.-uVig*smoothstep(.35,.95,r*1.25);
  c+=vec3(uFlash);
  gl_FragColor=vec4(c,1.);}`,
    });
    composer.addPass(this.post);
    composer.addPass(new OutputPass());

    // Stage dressing
    this.floor = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uPower: { value: 0 }, uCol: { value: CYAN.clone() } },
      vertexShader: "varying vec2 vP;void main(){vP=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `${SSR}uniform float uT,uPower;uniform vec3 uCol;varying vec2 vP;
 void main(){float r=length(vP);
  float rings=SSR(.03,0.,abs(fract(r*1.6-uT*.12)-.5)-.47)*.18;
  float main=SSR(.05,0.,abs(r-1.45))*(.55+uPower*2.4);
  float inner=SSR(.04,0.,abs(r-.85-.1*sin(uT*2.)))*.25*(1.+uPower);
  float spokes=SSR(.02,0.,abs(sin(atan(vP.y,vP.x)*12.+uT*.4))-.985)*SSR(3.,1.4,r)*smoothstep(1.2,1.5,r)*.5;
  float glow=exp(-r*r*.5)*(.10+uPower*.55);
  float fade=SSR(6.5,2.,r);
  gl_FragColor=vec4(uCol*(rings+main+inner+spokes+glow)*fade*.55,1.);}`,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(7, 96), this.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.002;
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(12, 64),
      new THREE.MeshStandardMaterial({ color: "#06101f", roughness: 0.95, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(floor, ground);

    this.columnMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uA: { value: 0 }, uCol: { value: CYAN.clone() }, uT: { value: 0 } },
      vertexShader: "varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `uniform float uA,uT;uniform vec3 uCol;varying vec2 vUv;
 void main(){float s=.5+.5*sin(vUv.x*60.+vUv.y*8.-uT*3.);float a=pow(1.-vUv.y,1.6)*smoothstep(0.,.08,vUv.y)*(.35+.65*s)*uA;
  gl_FragColor=vec4(uCol*a*.5,1.);}`,
    });
    this.column = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.15, 7, 64, 1, true), this.columnMat);
    this.column.position.y = 3.5;
    this.scene.add(this.column);

    for (let i = 0; i < 6; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: CYAN.clone().multiplyScalar(2.2),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 8, 128), material);
      ring.rotation.x = Math.PI / 2;
      ring.visible = false;
      this.scene.add(ring);
      this.rings.push(ring);
    }
    this.shellMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: { uA: { value: 0 } },
      vertexShader:
        "varying vec3 vN;varying vec3 vV;void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=-mv.xyz;gl_Position=projectionMatrix*mv;}",
      fragmentShader:
        "uniform float uA;varying vec3 vN;varying vec3 vV;void main(){float f=pow(1.-abs(dot(normalize(vN),normalize(vV))),2.2);gl_FragColor=vec4(vec3(.7,1.,.95)*f*uA*2.5,1.);}",
    });
    this.shell = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), this.shellMat);
    this.shell.visible = false;
    this.shell.position.y = 1.1;
    this.waveMat = new THREE.MeshBasicMaterial({
      toneMapped: false,
      color: new THREE.Color("#ffffff").multiplyScalar(1.6),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.wave = new THREE.Mesh(new THREE.TorusGeometry(1, 0.015, 8, 160), this.waveMat);
    this.wave.rotation.x = Math.PI / 2;
    this.wave.position.y = 0.05;
    this.wave.visible = false;
    this.scene.add(this.shell, this.wave);

    const EM = 700;
    const emPos = new Float32Array(EM * 3);
    const emSeed = new Float32Array(EM);
    for (let i = 0; i < EM; i++) {
      const ang = Math.random() * 6.28;
      const rad = Math.pow(Math.random(), 0.6) * 6;
      emPos.set([Math.cos(ang) * rad, Math.random() * 5, Math.sin(ang) * rad], i * 3);
      emSeed[i] = Math.random();
    }
    const emGeo = new THREE.BufferGeometry();
    emGeo.setAttribute("position", new THREE.BufferAttribute(emPos, 3));
    emGeo.setAttribute("aSeed", new THREE.BufferAttribute(emSeed, 1));
    this.embers = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uT: { value: 0 }, uBoost: { value: 0 }, uPx: { value: 1 } },
      vertexShader: `attribute float aSeed;uniform float uT,uBoost,uPx;varying float vA;
 void main(){vec3 p=position;p.y=mod(p.y+uT*(.12+aSeed*.3+uBoost*.9),5.);p.x+=sin(uT*.5+aSeed*30.)*.2;
  vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=uPx*(2.+aSeed*3.+uBoost*3.)*(7./-mv.z);
  vA=(.25+.75*sin(uT*2.+aSeed*40.)*.5+.375)*(.4+uBoost);}`,
      fragmentShader: `${SSR}varying float vA;void main(){float d=length(gl_PointCoord-.5);float a=SSR(.5,0.,d);gl_FragColor=vec4(vec3(.5,1.,.9)*a*vA,1.);}`,
    });
    this.scene.add(new THREE.Points(emGeo, this.embers));

    // The two creatures
    const growth = clamp(1 + 0.07 * (options.toStage - options.fromStage), 1, 1.2);
    this.from = prepare(assets.from, 1.9, 2.4);
    this.to = prepare(assets.to, 1.9 * growth, 2.4 * growth);
    this.from.u.uDir.value = 0;
    this.to.u.uD.value = 1;
    this.to.holder.visible = false;
    this.scene.add(this.from.holder, this.to.holder);

    const a = sortByHeight(sample(this.from));
    const b = sortByHeight(sample(this.to));
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(a.pos, 3));
    geometry.setAttribute("aB", new THREE.BufferAttribute(b.pos, 3));
    geometry.setAttribute("aCa", new THREE.BufferAttribute(a.col, 3));
    geometry.setAttribute("aCb", new THREE.BufferAttribute(b.col, 3));
    const random = new Float32Array(N * 4);
    for (let i = 0; i < random.length; i++) random[i] = Math.random();
    geometry.setAttribute("aR", new THREE.BufferAttribute(random, 4));
    this.morph = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uForm: { value: 0 },
        uCollapse: { value: 0 },
        uMorph: { value: 0 },
        uSpin: { value: 0 },
        uT: { value: 0 },
        uPx: { value: 1 },
        uAlpha: { value: 1 },
        uGlow: { value: 0 },
        uBurst: { value: 1 },
        uCy: { value: CYAN.clone() },
        uAm: { value: AMBER.clone() },
      },
      vertexShader: `attribute vec3 aB;attribute vec3 aCa;attribute vec3 aCb;attribute vec4 aR;
 uniform float uForm,uCollapse,uMorph,uSpin,uT,uPx,uGlow,uBurst;uniform vec3 uCy,uAm;
 varying vec3 vC;varying float vA;
 float e3(float x){x=clamp(x,0.,1.);return x*x*(3.-2.*x);}
 void main(){
  float rank=float(gl_VertexID)/${N}.;
  vec3 A=position;
  float strand=step(.5,aR.x)*3.14159;
  float hy=.05+rank*2.5;
  float ang=hy*5.2+strand+uSpin;
  float rad=.78+.1*sin(hy*3.+uT*2.);
  rad*=1.-uCollapse*.97;
  hy=mix(hy,1.15,uCollapse);
  vec3 H=vec3(cos(ang)*rad,hy,sin(ang)*rad);
  float f=e3(uForm*1.6-(1.-A.y/2.4)*.6-aR.y*.2);
  vec3 swirl=vec3(sin(uT*3.+aR.z*20.),cos(uT*2.+aR.w*20.)*.5,cos(uT*3.+aR.z*20.))*.22*sin(f*3.14159);
  vec3 P=mix(A,H,f)+swirl;
  float m=e3(uMorph*1.7-rank*.7);
  vec3 dir=normalize(vec3(aR.x-.5,aR.y-.35,aR.z-.5)+1e-4);
  vec3 arc=dir*sin(m*3.14159)*(.9+aR.w*1.4)*uBurst;
  P=mix(P,aB,m)+arc;
  float glow=mix(uGlow,0.,m);
  vec3 energy=mix(uCy,uAm,aR.w*.6)*1.4;
  vC=mix(mix(aCa,aCb,m),energy,clamp(f*.75*(1.-m)+glow*(1.-m*.5),0.,1.));
  vC*=1.+glow*2.;
  vec4 mv=modelViewMatrix*vec4(P,1.);
  gl_Position=projectionMatrix*mv;
  float live=step(.0001,uForm)*(1.-step(.9999,m));
  gl_PointSize=uPx*(4.6+aR.w*3.+f*(1.-m)*2.4+glow*2.)*(1.-.55*uCollapse)*(1.-.45*sin(m*3.14159))*(6./-mv.z);
  vA=live*(1.-.55*uCollapse)*(1.-.35*sin(m*3.14159));
 }`,
      fragmentShader: `${SSR}uniform float uAlpha;varying vec3 vC;varying float vA;void main(){float d=length(gl_PointCoord-.5);float a=SSR(.5,.05,d);gl_FragColor=vec4(vC*a*vA*uAlpha,1.);}`,
    });
    this.points = new THREE.Points(geometry, this.morph);
    this.points.frustumCulled = false;
    this.points.visible = !this.reduced;
    this.scene.add(this.points);

    this.resize();
    this.render();
  }

  /** Match the canvas to its on-screen size. */
  resize() {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const px = (Math.min(window.devicePixelRatio || 1, 2) * h) / 900;
    this.morph.uniforms.uPx.value = px;
    this.embers.uniforms.uPx.value = px;
  }

  advance(dt: number, settled: boolean) {
    this.wall += dt;
    this.lastSettled = settled;
    this.from.mixer?.update(dt);
    this.to.mixer?.update(dt);
    if (this.reduced) {
      if (settled) this.reducedTime += dt;
      return;
    }
    this.clock.advance(dt, settled);
    if (this.clock.justFlashed) {
      this.shake = 1;
      this.flashLevel = 0.4;
    }
    this.shake *= Math.pow(0.02, dt);
    this.flashLevel *= Math.pow(0.001, dt);
  }

  skip(settled: boolean) {
    if (this.reduced) {
      if (settled) this.reducedTime = Math.max(this.reducedTime, TIMELINE.reducedReveal);
      return;
    }
    this.clock.skip(settled);
  }

  get ui(): FxUi {
    if (this.reduced)
      return {
        reveal: smooth(TIMELINE.reducedFade, TIMELINE.reducedReveal, this.reducedTime),
        stageReached: this.reducedTime >= TIMELINE.reducedFade * 0.5,
        waiting: !this.lastSettled,
      };
    const t = this.clock.time;
    return {
      reveal: smooth(TIMELINE.reveal, TIMELINE.settle, t),
      stageReached: t >= TIMELINE.reprint,
      waiting: this.clock.waiting && !this.lastSettled,
    };
  }

  private frameCamera(az: number, el: number, d: number, fov: number) {
    const x = Math.sin(az) * Math.cos(el) * d;
    const y = Math.sin(el) * d;
    const z = Math.cos(az) * Math.cos(el) * d;
    this.camera.position.set(x, this.target.y + y, z);
    this.camera.lookAt(this.target);
    if (this.camera.fov !== fov) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  render() {
    this.resize();
    const { w, h } = this.size;
    const dist = w < h ? 1.6 : 1;
    const wall = this.wall;
    const T = TIMELINE;
    const m = this.morph.uniforms;
    this.floor.uniforms.uT.value = wall;
    this.columnMat.uniforms.uT.value = wall;
    this.embers.uniforms.uT.value = wall;
    m.uT.value = wall;

    if (this.reduced) {
      const fade = smooth(0, T.reducedFade, this.reducedTime);
      this.from.u.uD.value = fade;
      this.from.holder.visible = fade < 1;
      this.to.holder.visible = fade > 0;
      this.to.u.uD.value = 1 - fade;
      this.target.y = 1.15;
      this.frameCamera(Math.sin(wall * 0.25) * 0.4, 0.12, 6.2 * dist, 36);
      this.floor.uniforms.uPower.value = 0.1;
      this.embers.uniforms.uBoost.value = 0.05;
      this.composer.render();
      return;
    }

    const c = this.clock;
    const t = c.time;
    const done = t >= T.settle;
    const charge = smooth(0, T.dissolve, t);
    const col = Math.pow(smooth(T.collapse, T.flash, t), 2);
    const form = smooth(T.form, T.hold + 0.05, t);
    const morph = smooth(T.reprint, T.reprintEnd, t);
    const glow = smooth(T.form, T.hold, t) * (1 - morph) + col * 1.5;
    const power = charge * 0.8 + smooth(T.collapse, T.flash, t) * 1.2;
    const boost = charge * 0.6 + smooth(T.form, T.hold, t) * 1.2;

    // Old body dissolves from the top while the helix pulls it apart; the new one grows from the feet.
    this.from.u.uD.value = smooth(T.dissolve, T.form + 0.55, t);
    this.from.u.uAm.value = charge * 0.35 * (1 - smooth(T.dissolve, T.form, t));
    this.from.holder.visible = t < T.form + 0.62;
    const reveal = smooth(T.reprint + 0.25, T.reveal + 0.35, t);
    this.to.holder.visible = t >= T.reprint;
    this.to.u.uD.value = 1 - reveal;
    this.to.u.uAm.value = (1 - reveal) * 0.1;
    this.to.holder.rotation.y = done ? Math.sin(wall * 0.5) * 0.35 * clamp((t - T.reveal) / 1.2) : 0;

    m.uForm.value = form;
    m.uCollapse.value = col;
    m.uMorph.value = morph;
    m.uSpin.value = c.spin;
    m.uGlow.value = glow;
    m.uAlpha.value = 1 - smooth(T.reveal, T.reveal + 0.5, t);

    // Camera
    const dolly =
      smooth(0, T.dissolve, t) * -0.7 + smooth(T.form, T.hold, t) * 1.5 + col * -1.3 + smooth(T.flash, T.reveal + 0.6, t) * 0.6;
    let az = c.spin * 0.12 * (1 - smooth(T.flash, T.reveal, t));
    az = lerp(az, 0, smooth(T.flash + 0.2, T.reveal + 0.9, t));
    let el = lerp(0.12, 0.2, smooth(T.form, T.hold, t)) - col * 0.07;
    let d = (6.2 + dolly) * dist;
    const since = Math.max(0, t - T.flash);
    const fov = 36 - 4 * col + (c.flashed ? 7 * Math.exp(-since * 6) : 0);
    this.target.y = done
      ? lerp(1.15, 0.2, clamp((t - T.reveal) / 0.8))
      : lerp(1.15, 0.95, smooth(T.reprint, T.reveal + 0.4, t));
    if (done) {
      az = Math.sin(wall * 0.3) * 0.25;
      el = 0.1;
      d = 7.4 * dist;
    }
    this.frameCamera(az, el, d, fov);
    this.camera.position.x += Math.sin(wall * 70) * 0.05 * this.shake;
    this.camera.position.y += Math.cos(wall * 83) * 0.05 * this.shake;

    // Stage
    this.floor.uniforms.uPower.value = power;
    const columnA =
      smooth(0, 0.6, t) * 0.55 * (1 - smooth(T.reprint, T.reprint + 0.5, t)) * (done ? 0 : 1) +
      (c.flashed ? Math.exp(-since * 3.5) * 0.9 : 0);
    this.columnMat.uniforms.uA.value = clamp(columnA);
    (this.columnMat.uniforms.uCol.value as THREE.Color).copy(CYAN).lerp(WHITE, col);
    this.column.scale.set(1 + col * 0.4, 1, 1 + col * 0.4);
    this.embers.uniforms.uBoost.value = boost;
    this.core.intensity = col * 8 + (c.flashed ? Math.max(0, 10 * Math.exp(-since * 6)) : 0);
    this.rimA.intensity = 18 + power * 30;
    this.rimB.intensity = 5 + power * 8;
    this.rings.forEach((ring, i) => {
      const s = (t - i * 0.09) / 1.0;
      ring.visible = s > 0 && s < 1.4 && !c.flashed;
      if (!ring.visible) return;
      const k = clamp(s);
      ring.position.y = 0.05 + easeOut(k) * 2.9;
      ring.scale.setScalar(lerp(1.7, 0.75, easeOut(k)));
      (ring.material as THREE.MeshBasicMaterial).opacity = Math.sin(k * Math.PI) * 0.9;
    });
    const sp = clamp((t - T.flash) / 0.9);
    this.shell.visible = c.flashed && sp < 1;
    this.shell.scale.setScalar(0.2 + easeOut(sp) * 7);
    this.shellMat.uniforms.uA.value = 0.7 * (1 - sp) * (1 - sp);
    this.wave.visible = this.shell.visible;
    this.wave.scale.setScalar(0.3 + easeOut(sp) * 10);
    this.waveMat.opacity = 1 - sp;

    // Post
    this.post.uniforms.uCA.value = c.flashed ? 0.012 * Math.exp(-since * 4.5) : 0;
    this.post.uniforms.uFlash.value = this.flashLevel;
    this.bloom.strength = 0.4 + (c.flashed ? 0.7 * Math.exp(-since * 4) : 0) + col * 0.35;
    this.composer.render();
  }

  dispose() {
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    this.scene.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.geometry) return;
      geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material))
          if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((mat) => mat.dispose());
    textures.forEach((tex) => tex.dispose());
    this.composer.dispose();
    this.renderer.dispose();
  }
}
