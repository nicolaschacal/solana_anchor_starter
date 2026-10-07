import * as THREE from "three";

/**
 * Editable tile grid laid over the game's meadow.
 *
 * Tile centres sit on whole metres: tile (i, j) is centred at (OX + i, OZ + j).
 * The grid only adds relief, ground paint and water on top of the real scene;
 * tiles left at their defaults draw nothing, so an untouched grid shows the
 * meadow exactly as the game renders it.
 */
export const GX = 33;
export const GZ = 37;
export const OX = -16;
export const OZ = -28;
export const SUB = 4; // overlay lattice cells per tile
export const LEVEL_H = 0.45; // metres per level
export const MAX_LEVEL = 4;
export const WATER_Y = 0.05; // same height as the game's lake
export const BANK_Y = 0.035;
export const GROUNDS = ["grass", "path", "sand", "rock"] as const;
export type Ground = (typeof GROUNDS)[number];

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function hash(x: number, y: number) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x),
    yi = Math.floor(y),
    xf = x - xi,
    yf = y - yi,
    u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  return lerp(
    lerp(hash(xi, yi), hash(xi + 1, yi), u),
    lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u),
    v,
  );
}

export type TileData = { ground: string; level: string; water: string; cut?: string };

export class TileMap {
  readonly ground = new Uint8Array(GX * GZ);
  readonly level = new Uint8Array(GX * GZ);
  readonly water = new Uint8Array(GX * GZ);
  /** 1 where the tall grass carpet has been taken away. */
  readonly cut = new Uint8Array(GX * GZ);
  private readonly heights = new Float32Array(GX * GZ);
  private ka = 0;
  private kb = 0;
  private kc = 0;
  private kd = 0;
  private q0 = 0;
  private q1 = 0;
  private q2 = 0;
  private q3 = 0;

  static index(i: number, j: number) {
    return j * GX + i;
  }
  static inBounds(i: number, j: number) {
    return i >= 0 && j >= 0 && i < GX && j < GZ;
  }
  static tileOf(x: number, z: number) {
    return {
      i: Math.min(GX - 1, Math.max(0, Math.round(x - OX))),
      j: Math.min(GZ - 1, Math.max(0, Math.round(z - OZ))),
    };
  }

  clear() {
    this.ground.fill(0);
    this.level.fill(0);
    this.water.fill(0);
    this.cut.fill(0);
    this.refresh();
  }
  refresh() {
    for (let k = 0; k < this.heights.length; k++)
      this.heights[k] = this.level[k] * LEVEL_H;
  }
  hasWater() {
    return this.water.some((v) => v === 1);
  }
  isModified() {
    return (
      this.ground.some((v) => v !== 0) ||
      this.level.some((v) => v !== 0) ||
      this.cut.some((v) => v !== 0) ||
      this.hasWater()
    );
  }

  serialize(): TileData {
    return {
      ground: Array.from(this.ground).join(""),
      level: Array.from(this.level).join(""),
      water: Array.from(this.water).join(""),
      cut: Array.from(this.cut).join(""),
    };
  }
  static validate(data: TileData) {
    const n = GX * GZ;
    const ok = (text: unknown, max: number) =>
      typeof text === "string" &&
      text.length === n &&
      [...text].every((c) => c >= "0" && c <= String(max));
    return (
      ok(data.ground, GROUNDS.length - 1) &&
      ok(data.level, MAX_LEVEL) &&
      ok(data.water, 1) &&
      (data.cut === undefined || ok(data.cut, 1))
    );
  }
  load(data: TileData) {
    for (let k = 0; k < GX * GZ; k++) {
      this.ground[k] = Number(data.ground[k]);
      this.level[k] = Number(data.level[k]);
      this.water[k] = Number(data.water[k]);
      this.cut[k] = data.cut ? Number(data.cut[k]) : 0;
      if (this.water[k]) this.level[k] = 0;
    }
    this.refresh();
  }

  /** Whether the tall grass carpet was removed at this point. */
  cutAt(x: number, z: number) {
    const i = Math.round(x - OX),
      j = Math.round(z - OZ);
    return TileMap.inBounds(i, j) && this.cut[TileMap.index(i, j)] === 1;
  }

  /** Smooth interpolation weights between the four surrounding tile centres. */
  private prep(x: number, z: number) {
    const u = x - OX,
      v = z - OZ;
    let i0 = Math.floor(u),
      j0 = Math.floor(v);
    let fx = u - i0,
      fz = v - j0;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const cx = (n: number) => Math.min(GX - 1, Math.max(0, n)),
      cz = (n: number) => Math.min(GZ - 1, Math.max(0, n));
    const i1 = cx(i0 + 1),
      j1 = cz(j0 + 1);
    i0 = cx(i0);
    j0 = cz(j0);
    this.ka = TileMap.index(i0, j0);
    this.kb = TileMap.index(i1, j0);
    this.kc = TileMap.index(i0, j1);
    this.kd = TileMap.index(i1, j1);
    this.q0 = (1 - fx) * (1 - fz);
    this.q1 = fx * (1 - fz);
    this.q2 = (1 - fx) * fz;
    this.q3 = fx * fz;
  }
  private mix(field: ArrayLike<number>) {
    return (
      field[this.ka] * this.q0 +
      field[this.kb] * this.q1 +
      field[this.kc] * this.q2 +
      field[this.kd] * this.q3
    );
  }

  private baseHeight(x: number, z: number) {
    this.prep(x, z);
    return this.mix(this.heights);
  }
  /**
   * Terrain height. Heights are interpolated with smoothstep between tile
   * centres: a raised tile keeps a flat top and falls away in soft slopes.
   */
  heightAt(x: number, z: number) {
    const base = this.baseHeight(x, z);
    if (base <= 0) return 0;
    return base + (vnoise(x * 1.9, z * 1.9) - 0.5) * 0.05 * sstep(0.05, 0.3, base);
  }
  slopeAt(x: number, z: number) {
    const e = 0.12;
    const gx = (this.baseHeight(x + e, z) - this.baseHeight(x - e, z)) / (2 * e);
    const gz = (this.baseHeight(x, z + e) - this.baseHeight(x, z - e)) / (2 * e);
    return Math.hypot(gx, gz);
  }
  /** Painted ground weights: out = [path, sand, rock]. Grass is the remainder. */
  groundMix(x: number, z: number, out: number[]) {
    this.prep(x, z);
    out[0] = out[1] = out[2] = 0;
    const add = (k: number, q: number) => {
      const g = this.ground[k];
      if (g > 0) out[g - 1] += q;
    };
    add(this.ka, this.q0);
    add(this.kb, this.q1);
    add(this.kc, this.q2);
    add(this.kd, this.q3);
  }
  /** Water field. The shoreline is where it crosses a threshold, roughened by noise. */
  waterField(x: number, z: number) {
    this.prep(x, z);
    const s = this.mix(this.water);
    const k = 4 * s * (1 - s);
    return (
      s +
      (vnoise(x * 1.6 + 3.1, z * 1.6 + 7.7) - 0.5) * 0.7 * k +
      (vnoise(x * 4.1, z * 4.1) - 0.5) * 0.18 * k
    );
  }
  /** 0..1 water coverage used to remove grass blades under water. */
  waterAt(x: number, z: number) {
    return this.waterField(x, z);
  }
}

/** Raised ground and painted ground as a mesh lying on the meadow floor. */
export function buildOverlayGeometry(map: TileMap) {
  const nx = GX * SUB + 1,
    nz = GZ * SUB + 1,
    x0 = OX - 0.5,
    z0 = OZ - 0.5;
  const pos = new Float32Array(nx * nz * 3),
    uv = new Float32Array(nx * nz * 2),
    mixes = new Float32Array(nx * nz * 4),
    live = new Uint8Array(nx * nz);
  const tmp = [0, 0, 0];
  for (let b = 0; b < nz; b++)
    for (let a = 0; a < nx; a++) {
      const p = b * nx + a,
        x = x0 + a / SUB,
        z = z0 + b / SUB,
        h = map.heightAt(x, z);
      map.groundMix(x, z, tmp);
      const earth =
        sstep(0.16, 0.46, map.slopeAt(x, z)) * sstep(0.01, 0.15, h);
      pos[p * 3] = x;
      pos[p * 3 + 1] = h + 0.006;
      pos[p * 3 + 2] = z;
      // Same mapping as the meadow floor (a 120 m plane, texture repeat 40).
      uv[p * 2] = (x + 60) / 120;
      uv[p * 2 + 1] = (60 - z) / 120;
      mixes[p * 4] = tmp[0];
      mixes[p * 4 + 1] = tmp[1];
      mixes[p * 4 + 2] = tmp[2];
      mixes[p * 4 + 3] = earth;
      live[p] = h > 0.004 || tmp[0] + tmp[1] + tmp[2] > 0.02 ? 1 : 0;
    }
  const index: number[] = [];
  for (let b = 0; b < nz - 1; b++)
    for (let a = 0; a < nx - 1; a++) {
      const p = b * nx + a;
      if (live[p] || live[p + 1] || live[p + nx] || live[p + nx + 1])
        index.push(p, p + nx, p + 1, p + 1, p + nx, p + nx + 1);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute("aMix", new THREE.BufferAttribute(mixes, 4));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Region where the water field is above `threshold`, cut cell by cell
 * (marching squares). The outline follows the field, not the tile edges.
 */
export function buildContourGeometry(
  map: TileMap,
  threshold: number,
  y: number,
) {
  let i0 = GX,
    i1 = -1,
    j0 = GZ,
    j1 = -1;
  for (let j = 0; j < GZ; j++)
    for (let i = 0; i < GX; i++)
      if (map.water[TileMap.index(i, j)]) {
        i0 = Math.min(i0, i);
        i1 = Math.max(i1, i);
        j0 = Math.min(j0, j);
        j1 = Math.max(j1, j);
      }
  if (i1 < 0) return null;
  const step = 1 / 6,
    xa = Math.max(OX - 0.5, OX + i0 - 1.5),
    xb = Math.min(OX + GX - 0.5, OX + i1 + 1.5),
    za = Math.max(OZ - 0.5, OZ + j0 - 1.5),
    zb = Math.min(OZ + GZ - 0.5, OZ + j1 + 1.5);
  const nx = Math.ceil((xb - xa) / step),
    nz = Math.ceil((zb - za) / step),
    row = nx + 1;
  const field = new Float32Array((nx + 1) * (nz + 1));
  for (let b = 0; b <= nz; b++)
    for (let a = 0; a <= nx; a++)
      field[b * row + a] = map.waterField(
        Math.min(xb, xa + a * step),
        Math.min(zb, za + b * step),
      );
  const pos: number[] = [];
  const px = [0, 0, 0, 0],
    pz = [0, 0, 0, 0],
    pv = [0, 0, 0, 0];
  for (let b = 0; b < nz; b++)
    for (let a = 0; a < nx; a++) {
      const ax = Math.min(xb, xa + a * step),
        bx = Math.min(xb, xa + (a + 1) * step),
        az = Math.min(zb, za + b * step),
        bz = Math.min(zb, za + (b + 1) * step);
      // Counter-clockwise seen from above so every triangle faces up.
      px[0] = ax; pz[0] = az; pv[0] = field[b * row + a];
      px[1] = ax; pz[1] = bz; pv[1] = field[(b + 1) * row + a];
      px[2] = bx; pz[2] = bz; pv[2] = field[(b + 1) * row + a + 1];
      px[3] = bx; pz[3] = az; pv[3] = field[b * row + a + 1];
      if (pv[0] < threshold && pv[1] < threshold && pv[2] < threshold && pv[3] < threshold)
        continue;
      const polyX: number[] = [],
        polyZ: number[] = [];
      for (let k = 0; k < 4; k++) {
        const n = (k + 1) % 4,
          inK = pv[k] >= threshold,
          inN = pv[n] >= threshold;
        if (inK) {
          polyX.push(px[k]);
          polyZ.push(pz[k]);
        }
        if (inK !== inN) {
          const t = (threshold - pv[k]) / (pv[n] - pv[k]);
          polyX.push(lerp(px[k], px[n], t));
          polyZ.push(lerp(pz[k], pz[n], t));
        }
      }
      for (let k = 1; k < polyX.length - 1; k++)
        pos.push(
          polyX[0], y, polyZ[0],
          polyX[k], y, polyZ[k],
          polyX[k + 1], y, polyZ[k + 1],
        );
    }
  if (!pos.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  const normals = new Float32Array(pos.length);
  for (let k = 1; k < normals.length; k += 3) normals[k] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return geometry;
}

/** Tile borders draped over the terrain, for the optional grid overlay. */
export function buildGridGeometry(map: TileMap) {
  const pts: number[] = [];
  const lift = (x: number, z: number) =>
    Math.max(map.heightAt(x, z), WATER_Y) + 0.03;
  const x0 = OX - 0.5,
    z0 = OZ - 0.5;
  for (let i = 0; i <= GX; i++)
    for (let s = 0; s < GZ * SUB; s++) {
      const x = x0 + i,
        za = z0 + s / SUB,
        zb = z0 + (s + 1) / SUB;
      pts.push(x, lift(x, za), za, x, lift(x, zb), zb);
    }
  for (let j = 0; j <= GZ; j++)
    for (let s = 0; s < GX * SUB; s++) {
      const z = z0 + j,
        xa = x0 + s / SUB,
        xb = x0 + (s + 1) / SUB;
      pts.push(xa, lift(xa, z), z, xb, lift(xb, z), z);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  return geometry;
}
