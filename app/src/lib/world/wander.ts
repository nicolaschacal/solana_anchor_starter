/**
 * Calm wandering on a tile grid. A walker idles for a while, then steps to a free
 * neighbouring tile, one at a time. Two walkers never share a tile: a step reserves
 * its destination before it starts.
 */
export type Walker = {
  id: string;
  /** Tile it stands on, or is leaving. */
  i: number;
  j: number;
  /** Tile it is walking to (equal to i, j when still). */
  ti: number;
  tj: number;
  /** Progress of the current step, 0..1. */
  t: number;
  walking: boolean;
  /** Seconds left before the next step. */
  wait: number;
  /** Direction it is facing, radians around Y (0 faces +z). */
  yaw: number;
};

export type WanderContext = {
  canStand: (i: number, j: number) => boolean;
  rand: () => number;
  /** Tiles per second. */
  speed?: number;
};

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function createWalker(id: string, i: number, j: number, rand: () => number = Math.random): Walker {
  return { id, i, j, ti: i, tj: j, t: 0, walking: false, wait: 0.5 + rand() * 3, yaw: 0 };
}

/** Whether a tile is taken by another walker, standing or on its way. */
export function tileTaken(walkers: readonly Walker[], i: number, j: number, except?: string) {
  return walkers.some((w) => w.id !== except && ((w.i === i && w.j === j) || (w.ti === i && w.tj === j)));
}

/** Where the walker is right now, in fractional tiles. */
export function walkerPosition(w: Walker) {
  const k = w.t * w.t * (3 - 2 * w.t); // ease in and out of each step
  return { x: w.i + (w.ti - w.i) * k, z: w.j + (w.tj - w.j) * k };
}

export function stepWalker(w: Walker, all: readonly Walker[], dt: number, ctx: WanderContext) {
  const speed = ctx.speed ?? 0.5;
  if (w.walking) {
    w.t += dt * speed;
    if (w.t >= 1) {
      w.i = w.ti;
      w.j = w.tj;
      w.t = 0;
      w.walking = false;
      w.wait = 1.2 + ctx.rand() * 4.5;
    }
    return;
  }
  w.wait -= dt;
  if (w.wait > 0) return;
  const options = NEIGHBOURS.filter(([di, dj]) => {
    const i = w.i + di,
      j = w.j + dj;
    return ctx.canStand(i, j) && !tileTaken(all, i, j, w.id);
  });
  if (!options.length) {
    w.wait = 1 + ctx.rand() * 2;
    return;
  }
  const [di, dj] = options[Math.floor(ctx.rand() * options.length) % options.length];
  w.ti = w.i + di;
  w.tj = w.j + dj;
  w.t = 0;
  w.walking = true;
  w.yaw = Math.atan2(di, dj);
}

/** Moves a walker to a tile at once (used when placing it by hand). */
export function placeWalker(w: Walker, i: number, j: number) {
  Object.assign(w, { i, j, ti: i, tj: j, t: 0, walking: false, wait: 1 });
}
