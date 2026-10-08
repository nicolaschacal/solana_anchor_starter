/**
 * Evolution FX — the "recompile" animation played when a Rebyter evolves.
 *
 * The old form is scanned from top to bottom and breaks into pixel "bytes" that
 * spiral up in a double helix (the DNA the program stores on the mint). The
 * helix waits there while the evolve transaction is confirmed, then collapses
 * into a flash and the bytes are re-printed, bottom to top, as the new form.
 *
 * The engine is framework-free: it takes two images (any art: sprite, SVG or
 * thumbnail), a canvas, and a clock the caller advances once per frame.
 */

export type Rgb = readonly [number, number, number];
export type FxPalette = { cyan: Rgb; violet: Rgb; warm: Rgb; white: Rgb };

/** Seconds on the animation clock. */
export const TIMELINE = {
  scan0: 0.38, // the scan line starts peeling the old form
  scan1: 0.9, // ...and reaches its feet
  hold: 1.1, // the helix waits here until the chain confirms
  collapse: 1.15, // the helix closes into a point of light
  flash: 1.58, // the flash, held for `hit` seconds
  burst: 1.6, // bytes fly out to the new form
  sweep0: 2.0, // the new form is printed bottom to top
  sweep1: 2.45,
  reveal: 2.42, // name, stage rail and Continue
  skipTo: 2.5,
  hit: 0.08,
  reducedFade0: 0.25, // reduced motion: a plain cross-fade
  reducedFade1: 0.85,
  reducedReveal: 0.9,
} as const;
const T = TIMELINE;

const DEFAULT_PALETTE: FxPalette = {
  cyan: [143, 230, 255],
  violet: [182, 167, 255],
  warm: [255, 184, 107],
  white: [255, 255, 255],
};

const TAU = Math.PI * 2;
const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
const easeIn = (t: number) => t * t * t;
const easeBack = (t: number) => {
  const c = 1.35;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};
const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export function mulberry(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseHex(value: string): Rgb | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Effect colours come from the game's UI tokens so the two never drift apart. */
export function readPalette(root: Element = document.documentElement): FxPalette {
  const css = getComputedStyle(root);
  const pick = (name: string, fallback: Rgb) =>
    parseHex(css.getPropertyValue(name)) ?? fallback;
  return {
    cyan: pick("--ui-accent-hi", DEFAULT_PALETTE.cyan),
    violet: pick("--ui-special", DEFAULT_PALETTE.violet),
    warm: pick("--ui-warn", DEFAULT_PALETTE.warm),
    white: DEFAULT_PALETTE.white,
  };
}

/* ---------------------------------------------------------------- clock */

const HELIX_RATE = 6.5 + 8 * (T.hold - 0.4); // rad/s of the helix at the hold point
const RING_RATE = 1.1 + 4.4 * T.hold;

/**
 * The animation clock. It runs the charge and decompile phases on its own,
 * then waits at the helix until `settled` is true (the transaction confirmed),
 * keeping the helix spinning, and plays the finale after that.
 */
export class EvolutionClock {
  time = 0;
  helixSpin = 0;
  ringSpin = 0;
  waiting = false;
  private freeze = 0;
  private hitDone = false;

  constructor(private readonly reduced = false) {}

  advance(dt: number, settled: boolean) {
    if (this.reduced) {
      this.waiting = !settled;
      if (settled) this.time += dt;
      return;
    }
    if (!settled) {
      const next = this.time + dt;
      if (next >= T.hold) {
        const over = next - Math.max(this.time, T.hold);
        this.helixSpin += HELIX_RATE * over;
        this.ringSpin += RING_RATE * over;
        this.time = T.hold;
        this.waiting = true;
      } else {
        this.time = next;
        this.waiting = false;
      }
      return;
    }
    this.waiting = false;
    if (this.freeze > 0) {
      this.freeze -= dt;
      return;
    }
    const next = this.time + dt;
    if (!this.hitDone && this.time < T.flash && next >= T.flash) {
      // A short hit-stop on the flash.
      this.time = T.flash;
      this.freeze = T.hit;
      this.hitDone = true;
      return;
    }
    this.time = next;
  }

  /** Jump to the finished form. Only possible once the chain has confirmed. */
  skip(settled: boolean) {
    if (!settled) return;
    this.waiting = false;
    this.freeze = 0;
    this.hitDone = true;
    this.time = Math.max(this.time, this.reduced ? T.reducedReveal : T.skipTo);
  }
}

/* ------------------------------------------------------------- sampling */

export type Sample = { x: number; y: number; r: number; g: number; b: number };

/**
 * Pairs every byte of the old form with one of the new form, top to top and
 * bottom to bottom, with some jitter so the swirl looks organic.
 */
export function pairByHeight(
  from: readonly Sample[],
  to: readonly Sample[],
  rnd: () => number,
  spread: number,
): Array<[Sample, Sample]> {
  if (!from.length || !to.length) return [];
  const order = (list: readonly Sample[]) =>
    list
      .map((p) => ({ p, k: p.y + (rnd() - 0.5) * spread }))
      .sort((a, b) => a.k - b.k)
      .map((e) => e.p);
  const a = order(from);
  const b = order(to);
  const n = Math.max(a.length, b.length);
  const out: Array<[Sample, Sample]> = [];
  for (let i = 0; i < n; i++)
    out.push([a[Math.floor((i * a.length) / n)], b[Math.floor((i * b.length) / n)]]);
  return out;
}

type Box = { l: number; t: number; w: number; h: number };
type SpriteGeometry = {
  raster: HTMLCanvasElement;
  silhouette: HTMLCanvasElement;
  box: Box;
  points: Sample[]; // offsets from (cx, footY)
  yMin: number;
  yMax: number;
  artTop: number; // negative: how far the art rises above the feet
};

function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Rasterizes an image and samples it on the byte grid. The feet sit on footY. */
function buildSprite(
  img: HTMLImageElement,
  width: number,
  cell: number,
  dpr: number,
  cx: number,
  footY: number,
  tint: string,
): SpriteGeometry {
  const aspect = (img.naturalHeight || img.height || 1) / (img.naturalWidth || img.width || 1);
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(width * aspect));
  const probe = makeCanvas(w, h);
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  if (!pctx) throw new Error("Canvas is not available");
  pctx.drawImage(img, 0, 0, w, h);
  const data = pctx.getImageData(0, 0, w, h).data;

  const raw: Sample[] = [];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (let gy = 0; gy * cell < h; gy++) {
    for (let gx = 0; gx * cell < w; gx++) {
      const px = Math.min(w - 1, Math.floor((gx + 0.5) * cell));
      const py = Math.min(h - 1, Math.floor((gy + 0.5) * cell));
      const i = (py * w + px) * 4;
      if (data[i + 3] <= 140) continue;
      const x = (gx + 0.5) * cell;
      const y = (gy + 0.5) * cell;
      raw.push({ x, y, r: data[i], g: data[i + 1], b: data[i + 2] });
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!raw.length) throw new Error("Creature art is empty");

  const midX = (minX + maxX) / 2;
  const bottom = maxY + cell / 2;
  const points = raw.map((p) => ({ ...p, x: p.x - midX, y: p.y - bottom }));

  const raster = makeCanvas(w * dpr, h * dpr);
  raster.getContext("2d")?.drawImage(img, 0, 0, raster.width, raster.height);
  const silhouette = makeCanvas(raster.width, raster.height);
  const sctx = silhouette.getContext("2d");
  if (sctx) {
    sctx.drawImage(raster, 0, 0);
    sctx.globalCompositeOperation = "source-in";
    sctx.fillStyle = tint;
    sctx.fillRect(0, 0, silhouette.width, silhouette.height);
  }
  return {
    raster,
    silhouette,
    box: { l: cx - midX, t: footY - bottom, w, h },
    points,
    yMin: minY - bottom,
    yMax: maxY - bottom,
    artTop: minY - cell / 2 - bottom,
  };
}

/* ------------------------------------------------------------ the engine */

type Particle = {
  ox: number; oy: number; nx: number; ny: number;
  or: number; og: number; ob: number; nr: number; ng: number; nb: number;
  rel: number; // when the scan line releases it
  dl: number; // delay before it flies to the new form
  h: number; // 0 bottom .. 1 top of the helix
  ph: number; // helix phase
  rr: number; // helix radius jitter
  tone: Rgb;
  arc: number;
};
type Spark = { a: number; v: number; w: number; warm: boolean; life: number; lag: number };

type Geometry = {
  vw: number; vh: number; dpr: number; S: number; cell: number;
  cx: number; footY: number; artH: number; artHNew: number;
  helixH: number; coreY: number; rmax: number;
  from: SpriteGeometry; to: SpriteGeometry;
  particles: Particle[];
  X: Float32Array; Y: Float32Array; A: Float32Array; Z: Float32Array;
  R: Float32Array; G: Float32Array; B: Float32Array;
  sparks: Spark[];
};

export type FxOptions = {
  fromStage: number;
  toStage: number;
  reducedMotion?: boolean;
  palette?: FxPalette;
};

export type FxUi = {
  /** 0..1: how far the name, stage rail and Continue have faded in. */
  reveal: number;
  /** The stage rail has moved on to the new stage. */
  stageReached: boolean;
  /** Holding the helix while the transaction confirms. */
  waiting: boolean;
};

const MONO = "ui-monospace,'SF Mono',Menlo,Consolas,monospace";

export class EvolutionFx {
  readonly clock: EvolutionClock;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly palette: FxPalette;
  private readonly reduced: boolean;
  private g!: Geometry;
  private wall = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sprites: { from: HTMLImageElement; to: HTMLImageElement },
    private readonly options: FxOptions,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is not available");
    this.ctx = ctx;
    this.reduced = !!options.reducedMotion;
    this.palette = options.palette ?? DEFAULT_PALETTE;
    this.clock = new EvolutionClock(this.reduced);
    this.resize();
  }

  /** Rebuilds the layout and the bytes for the current viewport. */
  resize() {
    const vw = Math.max(1, window.innerWidth);
    const vh = Math.max(1, window.innerHeight);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);

    const S = Math.min(vw * 0.62, vh * 0.4, 340);
    const cell = Math.max(3, Math.round(S / 62));
    const cx = vw / 2;
    const footY = vh * 0.4 + S * 0.32;
    const growth = clamp(1 + 0.07 * (this.options.toStage - this.options.fromStage), 1, 1.2);
    const tint = "#e6f8ff";
    const from = buildSprite(this.sprites.from, S, cell, dpr, cx, footY, tint);
    const to = buildSprite(this.sprites.to, S * growth, cell, dpr, cx, footY, tint);

    const artH = -from.artTop;
    const rnd = mulberry(7);
    const pairs = pairByHeight(from.points, to.points, rnd, cell * 3);
    const n = pairs.length;
    const particles: Particle[] = pairs.map(([a, b], i) => {
      const ynOld = (a.y - from.yMin) / (from.yMax - from.yMin || 1);
      const ynNew = (b.y - to.yMin) / (to.yMax - to.yMin || 1);
      const h = 1 - i / n;
      const t = rnd();
      return {
        ox: a.x, oy: a.y, nx: b.x, ny: b.y,
        or: a.r, og: a.g, ob: a.b, nr: b.r, ng: b.g, nb: b.b,
        rel: T.scan0 + ynOld * (T.scan1 - T.scan0) + rnd() * 0.05,
        dl: (1 - ynNew) * 0.28 + rnd() * 0.04,
        h,
        ph: h * 5.2 * Math.PI + (i & 1) * Math.PI + (rnd() - 0.5) * 0.7,
        rr: 0.9 + rnd() * 0.22,
        tone: t < 0.62 ? this.palette.cyan : t < 0.85 ? this.palette.violet : this.palette.white,
        arc: (rnd() - 0.5) * S * 0.22,
      };
    });
    const sparks: Spark[] = Array.from({ length: 44 }, (_, i) => {
      const r = mulberry(100 + i);
      return { a: r() * TAU, v: S * (0.5 + r() * 1.1), w: r(), warm: r() < 0.6, life: 0.8 + r() * 0.5, lag: r() * 0.25 };
    });
    this.g = {
      vw, vh, dpr, S, cell, cx, footY, artH, artHNew: -to.artTop,
      helixH: artH * 1.5, coreY: footY - artH * 0.66, rmax: S * 0.46,
      from, to, particles,
      X: new Float32Array(n), Y: new Float32Array(n), A: new Float32Array(n), Z: new Float32Array(n),
      R: new Float32Array(n), G: new Float32Array(n), B: new Float32Array(n),
      sparks,
    };
  }

  advance(dt: number, settled: boolean) {
    this.wall += dt;
    this.clock.advance(dt, settled);
  }

  skip(settled: boolean) {
    this.clock.skip(settled);
  }

  get ui(): FxUi {
    const at = this.reduced ? T.reducedReveal : T.reveal;
    const t = this.clock.time;
    return { reveal: clamp((t - at) / 0.4), stageReached: t > at + 0.3, waiting: this.clock.waiting };
  }

  render() {
    const { ctx, g } = this;
    ctx.setTransform(g.dpr, 0, 0, g.dpr, 0, 0);
    ctx.clearRect(0, 0, g.vw, g.vh);
    if (this.reduced) return this.renderReduced();
    const t = this.clock.time;
    this.drawScrim(t);
    this.drawRing(t, false);
    this.drawPillar(t);
    this.drawOld(t);
    this.drawParticles(t);
    this.drawNew(t);
    this.drawCore(t);
    this.drawRing(t, true);
    this.drawShock(t);
    this.drawSparks(t);
    this.drawFlash(t);
  }

  /** Reduced motion: no flashing, no particles. The form simply cross-fades. */
  private renderReduced() {
    const { ctx, g } = this;
    const t = this.clock.time;
    ctx.fillStyle = "rgba(2,8,26,.92)";
    ctx.fillRect(0, 0, g.vw, g.vh);
    const x = clamp((t - T.reducedFade0) / (T.reducedFade1 - T.reducedFade0));
    const o = g.from.box;
    const n = g.to.box;
    ctx.globalAlpha = 1 - x;
    ctx.drawImage(g.from.raster, o.l, o.t, o.w, o.h);
    ctx.globalAlpha = x;
    ctx.drawImage(g.to.raster, n.l, n.t, n.w, n.h);
    ctx.globalAlpha = 1;
  }

  private sweepY(t: number) {
    const { footY } = this.g;
    const p = clamp((t - T.sweep0) / (T.sweep1 - T.sweep0));
    return footY - p * this.g.artHNew * 1.02;
  }

  private drawScrim(t: number) {
    const { ctx, g, palette } = this;
    const a = t < T.reveal ? 0.92 * easeOut(clamp(t / 0.3)) : lerp(0.92, 0.66, easeOut(clamp((t - T.reveal) / 0.6)));
    ctx.fillStyle = `rgba(2,8,26,${a})`;
    ctx.fillRect(0, 0, g.vw, g.vh);
    let col: Rgb;
    let amt: number;
    if (t < T.flash) {
      col = palette.cyan;
      amt = 0.1 + 0.3 * clamp((t - 0.2) / 1.4);
    } else {
      col = palette.warm;
      amt = 0.38 * Math.exp(-(t - T.flash) * 1.3);
    }
    const gy = g.footY - g.artH * 0.55;
    const gr = ctx.createRadialGradient(g.cx, gy, 0, g.cx, gy, g.S * 1.25);
    gr.addColorStop(0, rgba(col, amt));
    gr.addColorStop(1, rgba(col, 0));
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, g.vw, g.vh);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(0,0,0,${0.35 * a})`;
    ctx.beginPath();
    ctx.ellipse(g.cx, g.footY + 4, g.S * 0.34, g.S * 0.06, 0, 0, TAU);
    ctx.fill();
  }

  private drawRing(t: number, front: boolean) {
    const { ctx, g, palette } = this;
    const a = easeOut(clamp(t / 0.35));
    if (a <= 0) return;
    let rx = g.S * 0.66;
    let col = palette.cyan;
    let alpha = a;
    const c = t > T.collapse ? easeIn(clamp((t - T.collapse) / (T.flash - T.collapse))) : 0;
    let k = 1 - 0.45 * c;
    if (t > T.flash) {
      const u = clamp((t - T.flash) / 0.9);
      k = 0.55 + u * 1.3;
      alpha = (1 - u) * 0.9;
      col = palette.warm;
    }
    if (alpha <= 0.01) return;
    rx *= k;
    const ry = rx * 0.26;
    const gy = g.footY + 6;
    if (!front) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgba(col, 0.55 * alpha);
      ctx.beginPath();
      ctx.ellipse(g.cx, gy, rx, ry, 0, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([3, 7]);
      ctx.lineDashOffset = -t * 60;
      ctx.strokeStyle = rgba(col, 0.35 * alpha);
      ctx.beginPath();
      ctx.ellipse(g.cx, gy, rx * 0.8, ry * 0.8, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    const spin =
      (t < T.flash
        ? 1.1 * t + 2.2 * t * t
        : 1.1 * T.flash + 2.2 * T.flash * T.flash + 1.2 * (t - T.flash)) + this.clock.ringSpin;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.globalCompositeOperation = "lighter";
    const N = 28;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * TAU + spin;
      const depth = Math.sin(ang);
      if (depth > 0 !== front) continue;
      ctx.font = `600 ${9 + 3 * depth}px ${MONO}`;
      ctx.fillStyle = rgba(col, alpha * (0.55 + 0.4 * depth));
      ctx.fillText(i % 7 === 3 ? "█" : (i * 5 + 3) % 3 ? "0" : "1", g.cx + Math.cos(ang) * rx, gy + Math.sin(ang) * ry);
    }
    ctx.restore();
  }

  private pulse() {
    return this.clock.waiting ? 1 + 0.12 * Math.sin(this.wall * 5) : 1;
  }

  private drawPillar(t: number) {
    const { ctx, g, palette } = this;
    if (t < 0.85) return;
    const base = t < T.flash ? Math.pow((t - 0.85) / (T.flash - 0.85), 1.5) : 1 - clamp((t - T.burst) / 0.7);
    const a = base * this.pulse();
    if (a <= 0.002) return;
    const w = g.S * (0.05 + 0.42 * a * a);
    const col = t > T.flash ? palette.warm : palette.cyan;
    const gr = ctx.createLinearGradient(g.cx - w, 0, g.cx + w, 0);
    gr.addColorStop(0, rgba(col, 0));
    gr.addColorStop(0.35, rgba(col, 0.35 * a));
    gr.addColorStop(0.5, `rgba(255,255,255,${Math.min(1, 0.9 * a)})`);
    gr.addColorStop(0.65, rgba(col, 0.35 * a));
    gr.addColorStop(1, rgba(col, 0));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr;
    ctx.fillRect(g.cx - w, 0, 2 * w, g.footY + 8);
    ctx.restore();
  }

  /** The old form, peeled from the top by the scan line, with glitch bands. */
  private drawOld(t: number) {
    const { ctx, g, palette } = this;
    const prog = clamp((t - T.scan0) / (T.scan1 - T.scan0));
    if (prog >= 1 || t >= T.collapse) return;
    const sp = g.from;
    const b = sp.box;
    const charge = clamp(t / 0.38);
    const squash = t < 0.38 ? Math.sin(charge * Math.PI) * 0.07 : 0;
    const shake = clamp(t / 0.4) * 2.2 * (1 - clamp((t - 0.8) / 0.2));
    const whiten = clamp((t - 0.1) / 0.3) * 0.92;
    const dx = Math.sin(t * 95) * shake;
    const scanY = g.footY + sp.artTop + prog * -sp.artTop;
    ctx.save();
    ctx.translate(g.cx + dx, g.footY);
    ctx.scale(1 + squash * 0.6, 1 - squash);
    ctx.translate(-g.cx, -g.footY);
    const sh = g.cell;
    const step = Math.floor(t * 30);
    for (let y = b.t; y < b.t + b.h; y += sh) {
      if (y + sh < scanY) continue;
      const d = Math.max(0, y - scanY);
      const glitch = prog > 0 && d < 70 ? (hash(Math.round(y) + step * 13) - 0.5) * 2 * 18 * (1 - d / 70) : 0;
      const sy = (y - b.t) * g.dpr;
      const hh = Math.min(sh, b.t + b.h - y);
      ctx.drawImage(sp.raster, 0, sy, sp.raster.width, hh * g.dpr, b.l + glitch, y, b.w, hh);
      ctx.globalAlpha = whiten;
      ctx.drawImage(sp.silhouette, 0, sy, sp.silhouette.width, hh * g.dpr, b.l + glitch, y, b.w, hh);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (prog > 0) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const w = b.w * 1.05;
      const gr = ctx.createLinearGradient(0, scanY - 26, 0, scanY + 2);
      gr.addColorStop(0, rgba(palette.cyan, 0));
      gr.addColorStop(1, rgba(palette.cyan, 0.45));
      ctx.fillStyle = gr;
      ctx.fillRect(g.cx - w / 2, scanY - 26, w, 28);
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.fillRect(g.cx - w / 2, scanY, w, 2);
      ctx.restore();
    }
  }

  private drawParticles(t: number) {
    const { ctx, g } = this;
    const P = g.particles;
    const n = P.length;
    const { cx, footY, coreY, cell } = g;
    const sY = this.sweepY(t);
    const c = t > T.collapse ? easeIn(clamp((t - T.collapse) / (T.flash - T.collapse))) : 0;
    const k0 = t - 0.4;
    const spin = this.clock.helixSpin;
    const cy = this.palette.cyan;
    for (let i = 0; i < n; i++) {
      const p = P[i];
      g.A[i] = 0;
      if (t < p.rel) continue;
      const ang = p.ph + 6.5 * k0 + 4 * k0 * k0 + spin;
      const R = g.rmax * p.rr * (0.55 + 0.45 * Math.sin(Math.PI * (0.12 + 0.88 * p.h)));
      const hx = cx + Math.cos(ang) * R;
      const hy = footY - p.h * g.helixH + Math.sin(t * 7 + p.h * 9 + spin * 0.6) * 3;
      const z = Math.sin(ang);
      const u = easeOut(clamp((t - p.rel) / 0.34));
      const kc = clamp((t - p.rel) / 0.25);
      let x = lerp(cx + p.ox, hx, u);
      let y = lerp(footY + p.oy, hy, u);
      let r = lerp(p.or, p.tone[0], kc);
      let gg = lerp(p.og, p.tone[1], kc);
      let b = lerp(p.ob, p.tone[2], kc);
      let a = 1;
      let sz = 0.8 + 0.3 * z;
      if (c > 0) {
        x = lerp(x, cx, c);
        y = lerp(y, coreY, c);
        r = lerp(r, 255, c);
        gg = lerp(gg, 255, c);
        b = lerp(b, 255, c);
      }
      if (t >= T.burst) {
        const ub = clamp((t - T.burst - p.dl) / 0.44);
        sz = 1;
        if (ub <= 0) {
          x = cx;
          y = coreY;
          r = gg = b = 255;
        } else {
          const e = easeBack(ub);
          x = lerp(cx, cx + p.nx, e) + Math.sin(ub * Math.PI) * p.arc;
          y = lerp(coreY, footY + p.ny, e);
          if (ub < 0.4) {
            const m = ub / 0.4;
            r = lerp(255, cy[0], m);
            gg = lerp(255, cy[1], m);
            b = lerp(255, cy[2], m);
          } else {
            const m = clamp((ub - 0.4) / 0.6);
            r = lerp(cy[0], p.nr, m);
            gg = lerp(cy[1], p.ng, m);
            b = lerp(cy[2], p.nb, m);
          }
          if (ub >= 1) a = clamp(1 - (footY + p.ny - sY) / (0.12 * g.artHNew));
        }
        if (t > T.sweep1 + 0.08) a = 0;
      }
      g.X[i] = Math.round(x / cell) * cell;
      g.Y[i] = Math.round(y / cell) * cell;
      g.A[i] = a;
      g.Z[i] = sz;
      g.R[i] = r;
      g.G[i] = gg;
      g.B[i] = b;
    }
    if (t > 0.45 && t < 2.2) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < n; i++) {
        if (g.A[i] <= 0) continue;
        const s2 = cell * g.Z[i] * 2.4;
        ctx.globalAlpha = 0.1 * g.A[i];
        ctx.fillStyle = `rgb(${g.R[i] | 0},${g.G[i] | 0},${g.B[i] | 0})`;
        ctx.fillRect(g.X[i] - s2 / 2, g.Y[i] - s2 / 2, s2, s2);
      }
      ctx.restore();
    }
    for (let i = 0; i < n; i++) {
      if (g.A[i] <= 0) continue;
      const s2 = cell * g.Z[i];
      ctx.globalAlpha = g.A[i];
      ctx.fillStyle = `rgb(${g.R[i] | 0},${g.G[i] | 0},${g.B[i] | 0})`;
      ctx.fillRect(g.X[i] - s2 / 2, g.Y[i] - s2 / 2, s2, s2);
    }
    ctx.globalAlpha = 1;
  }

  /** The new form is printed bottom to top, starts white and settles into colour. */
  private drawNew(t: number) {
    const { ctx, g, palette } = this;
    const p = clamp((t - T.sweep0) / (T.sweep1 - T.sweep0));
    if (p <= 0) return;
    const sp = g.to;
    const b = sp.box;
    const sy = this.sweepY(t);
    let sc = 1;
    if (t > T.sweep1) {
      const a = t - T.sweep1;
      sc = 1 + 0.11 * Math.exp(-7 * a) * Math.cos(16 * a);
    }
    const bob = t > 2.9 ? Math.sin((t - 2.9) * 3.2) * 2.5 : 0;
    ctx.save();
    ctx.translate(g.cx, g.footY + bob);
    ctx.scale(sc, sc);
    ctx.translate(-g.cx, -g.footY);
    ctx.beginPath();
    ctx.rect(b.l - 20, sy, b.w + 40, g.footY - sy + b.h);
    ctx.clip();
    ctx.drawImage(sp.raster, b.l, b.t, b.w, b.h);
    const white = 0.9 * (1 - clamp((t - T.sweep1 + 0.05) / 0.4));
    if (white > 0.01) {
      ctx.globalAlpha = white;
      ctx.drawImage(sp.silhouette, b.l, b.t, b.w, b.h);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    if (p < 1) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const w = b.w * 1.05;
      const gr = ctx.createLinearGradient(0, sy - 30, 0, sy + 2);
      gr.addColorStop(0, rgba(palette.warm, 0));
      gr.addColorStop(1, "rgba(255,214,160,.5)");
      ctx.fillStyle = gr;
      ctx.fillRect(g.cx - w / 2, sy - 30, w, 32);
      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.fillRect(g.cx - w / 2, sy, w, 2);
      for (let i = 0; i < 9; i++) {
        const hx = g.cx - w / 2 + hash(i * 7 + Math.floor(t * 40)) * w;
        ctx.fillStyle = "rgba(255,236,200,.9)";
        ctx.fillRect(Math.round(hx / g.cell) * g.cell, sy - 4 - hash(i + 3) * 10, g.cell, g.cell);
      }
      ctx.restore();
    }
  }

  private drawCore(t: number) {
    const { ctx, g, palette } = this;
    if (t < 1.0 || t > 2.3) return;
    const base = t < T.flash ? easeIn(clamp((t - 0.95) / (T.flash - 0.95))) : 1 - clamp((t - T.flash) / 0.7);
    const c = base * this.pulse();
    const r = g.S * (0.08 + 0.55 * c * c);
    const warm = t > T.flash;
    const gr = ctx.createRadialGradient(g.cx, g.coreY, 0, g.cx, g.coreY, r);
    gr.addColorStop(0, `rgba(255,255,255,${Math.min(1, 0.95 * c)})`);
    gr.addColorStop(0.35, rgba(warm ? palette.warm : palette.cyan, 0.55 * c));
    gr.addColorStop(1, rgba(palette.cyan, 0));
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gr;
    ctx.fillRect(g.cx - r, g.coreY - r, 2 * r, 2 * r);
    ctx.restore();
  }

  /** Shockwave with a small chromatic split. */
  private drawShock(t: number) {
    const { ctx, g, palette } = this;
    if (t < T.flash) return;
    const u = clamp((t - T.flash) / 0.6);
    if (u >= 1) return;
    const rad = easeOut(u) * g.S * 1.9;
    const lw = 12 * (1 - u) + 1;
    const al = 1 - u;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineWidth = lw;
    const split: Array<[number, string]> = [
      [-4, "255,60,90"],
      [0, "255,255,255"],
      [4, "60,160,255"],
    ];
    for (const [o, c] of split) {
      ctx.strokeStyle = `rgba(${c},${0.8 * al})`;
      ctx.beginPath();
      ctx.arc(g.cx + o, g.coreY, rad, 0, TAU);
      ctx.stroke();
    }
    ctx.lineWidth = lw * 0.7;
    ctx.strokeStyle = rgba(palette.warm, 0.7 * al);
    ctx.beginPath();
    ctx.ellipse(g.cx, g.footY + 6, rad * 1.15, rad * 0.3, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  private drawSparks(t: number) {
    const { ctx, g, palette } = this;
    if (t < 2.3) return;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const sp of g.sparks) {
      const age = t - 2.3 - sp.lag;
      if (age <= 0 || age > sp.life) continue;
      const u = age / sp.life;
      const d = easeOut(u) * sp.v * 0.55;
      const x = g.cx + Math.cos(sp.a) * d;
      const y = g.coreY + Math.sin(sp.a) * d * 0.8 + u * u * 40;
      const a = (1 - u) * 0.9;
      const s2 = g.cell * (sp.w > 0.5 ? 1.4 : 1);
      ctx.fillStyle = rgba(sp.warm ? palette.warm : palette.cyan, a);
      const X = Math.round(x / g.cell) * g.cell;
      const Y = Math.round(y / g.cell) * g.cell;
      ctx.fillRect(X - s2 / 2, Y - s2 / 2, s2, s2);
      ctx.fillRect(X - s2 * 1.5, Y - s2 / 2, s2, s2);
      ctx.fillRect(X + s2 / 2, Y - s2 / 2, s2, s2);
      ctx.fillRect(X - s2 / 2, Y - s2 * 1.5, s2, s2);
      ctx.fillRect(X - s2 / 2, Y + s2 / 2, s2, s2);
    }
    ctx.restore();
  }

  private drawFlash(t: number) {
    const { ctx, g } = this;
    let a = 0;
    if (t > 1.46 && t < T.flash) a = Math.pow((t - 1.46) / 0.12, 2);
    else if (t >= T.flash) a = Math.exp(-(t - T.flash) * 9);
    if (a <= 0.003) return;
    ctx.fillStyle = `rgba(236,250,255,${clamp(a)})`;
    ctx.fillRect(0, 0, g.vw, g.vh);
  }
}
