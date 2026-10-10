import * as THREE from "three";

/**
 * The world camera: a smooth, limited orbit around the board.
 *
 * - The player can orbit and zoom, but never look from underneath, from too far
 *   away, or so close that the board stops making sense.
 * - Every movement is a goal the camera eases towards, so nothing snaps.
 * - If nothing is touched for a while the camera drifts between a few shots by itself.
 * - "top" is the edit view: straight down, fixed.
 */
export type Pose = { yaw: number; pitch: number; dist: number; x: number; y: number; z: number };
export type Spot = { x: number; z: number };
export const FOV = 42;

export const LIMITS = { minPitch: 0.24, maxPitch: 1.18, minDist: 3.2, topPitch: 1.5 } as const;
/** Limits while one rebyter is the protagonist: a close, low camera that can swing around it. */
export const FOCUS = { minPitch: 0.08, maxPitch: 0.6, minDist: 2.6, maxDist: 7.5, pitch: 0.24 } as const;

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const TAU = Math.PI * 2;
/** Shortest signed angle from a to b. */
export function angleDelta(a: number, b: number) {
  return ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}
/** Distance at which a half-width (in metres) just fits the screen, whatever its shape. */
export function fitDistance(halfWidth: number, aspect: number, fov = FOV) {
  const t = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  return halfWidth / (t * Math.min(aspect, 1.6));
}

type Shot = { yaw: number; pitch: number; dist: number; target: "centre" | number };
const IDLE_BEFORE_TOUR = 7;
const SHOT_SECONDS = 7;

export class WorldRig {
  mode: "free" | "top" | "focus" = "free";
  cur: Pose;
  goal: Pose;
  aspect = 1;
  private idle = 0;
  private touring = false;
  private shotIndex = 0;
  private shotTime = 0;
  private holdUntil = 0;
  private time = 0;
  private zoomed = false;
  private focusZoomed = false;
  private focusSpot: Spot = { x: 0, z: 0 };
  private focusHeight = 0.9;
  private aspectKnown = false;
  private introPending = false;
  private introUntil = 0;

  constructor(
    readonly centre: Spot,
    private readonly half = 2.9,
    private readonly spots: () => Spot[] = () => [],
  ) {
    const start = this.home();
    this.cur = { ...start };
    this.goal = { ...start };
  }

  // ---- Limits that depend on the screen --------------------------------------

  /** Bigger islands need the camera further out: every distance limit grows with the island. */
  private get scale() {
    return Math.max(1, this.half / 2.9);
  }
  get maxDist() {
    return clamp(fitDistance(this.half + 0.6, this.aspect), 8, 17 * this.scale);
  }
  private get homeDist() {
    // Shows a bit less than the whole board: close enough to see the rebyters, far enough to see where they live.
    // Bigger islands show nearly all of the board so the land can be read at a glance.
    const trim = this.half > 3.5 ? 0.9 : this.half > 3 ? 1.1 : 1.25;
    // The view is turned 35 degrees, so the board's diagonal is what has to fit.
    const reach = this.half > 3 ? (this.half - trim) * 1.22 : this.half - trim;
    return clamp(fitDistance(reach, this.aspect), LIMITS.minDist + 1.5, this.maxDist);
  }
  /** Height the home view looks at; raising it moves the island lower on screen. */
  homeY = 0.35;
  private home(): Pose {
    return { yaw: 0.62, pitch: 0.62, dist: this.homeDist, x: this.centre.x, y: this.homeY, z: this.centre.z };
  }
  private topDist() {
    return clamp(fitDistance(this.half + 0.1, this.aspect), 6, 24 * this.scale);
  }
  /** On a tall screen the edit panel covers the bottom, so the board sits a little higher. */
  private topShift() {
    return this.aspect < 1 ? 0.9 : 0;
  }

  // ---- Input ------------------------------------------------------------------

  /** The opening shot: rise from beneath the island, wide and slow, towards the usual view. */
  intro(seconds = 4.6) {
    this.introSeconds = seconds;
    if (this.aspectKnown) this.startIntro();
    else this.introPending = true;
  }
  private introSeconds = 4.6;
  private startIntro() {
    this.introPending = false;
    const home = this.home();
    this.cur = { yaw: home.yaw - 1.15, pitch: 0.16, dist: Math.min(this.maxDist * 1.25, home.dist * 2.1), x: home.x, y: -1.6, z: home.z };
    this.goal = { ...home };
    this.introUntil = this.time + this.introSeconds;
  }
  private interrupt() {
    this.introUntil = 0;
    this.idle = 0;
    if (this.touring) {
      this.touring = false;
      this.goal = { ...this.cur };
    }
  }
  orbit(dYaw: number, dPitch: number) {
    if (this.mode === "top") return;
    this.interrupt();
    const [lo, hi] = this.mode === "focus" ? [FOCUS.minPitch, FOCUS.maxPitch] : [LIMITS.minPitch, LIMITS.maxPitch];
    this.goal.yaw += dYaw;
    this.goal.pitch = clamp(this.goal.pitch + dPitch, lo, hi);
  }
  zoom(factor: number) {
    if (this.mode === "top") return;
    this.interrupt();
    if (this.mode === "focus") {
      this.focusZoomed = true;
      this.goal.dist = clamp(this.goal.dist * factor, FOCUS.minDist, FOCUS.maxDist);
      return;
    }
    this.zoomed = true;
    this.goal.dist = clamp(this.goal.dist * factor, LIMITS.minDist, this.maxDist);
  }
  /** Any other input (a tap, a key) that should count as activity. */
  poke() {
    this.interrupt();
  }
  /** Flies in close to a spot, for a moment (used when a rebyter is chosen). */
  focus(spot: Spot, dist = 3.4, seconds = 0.6) {
    this.interrupt();
    this.goal = { yaw: this.goal.yaw, pitch: 0.42, dist, x: spot.x, y: 0.5, z: spot.z };
    this.holdUntil = this.time + seconds;
  }
  setMode(mode: "free" | "top") {
    if (mode === this.mode) return;
    this.mode = mode;
    this.interrupt();
    if (mode === "top") {
      this.goal = { yaw: 0, pitch: LIMITS.topPitch, dist: this.topDist(), x: this.centre.x, y: 0, z: this.centre.z + this.topShift() };
    } else {
      this.goal = { ...this.home(), yaw: this.cur.yaw };
    }
  }
  /** A rebyter becomes the protagonist: the camera comes to it, in front of the way it faces. */
  setFocus(on: boolean, spot?: Spot, height = 0.9, yaw?: number) {
    if (on) {
      if (spot) this.focusSpot = spot;
      this.focusHeight = height;
      this.mode = "focus";
      this.focusZoomed = false;
      this.interrupt();
      this.goal = {
        yaw: yaw ?? this.cur.yaw,
        pitch: FOCUS.pitch,
        dist: this.focusDist(),
        x: this.focusSpot.x,
        y: this.focusHeight * 0.34,
        z: this.focusSpot.z,
      };
    } else if (this.mode === "focus") {
      this.mode = "free";
      this.interrupt();
      this.zoomed = false;
      this.goal = { ...this.home(), yaw: this.cur.yaw };
    }
  }
  /** Keeps the protagonist centred while it moves. */
  trackFocus(spot: Spot, height: number) {
    this.focusSpot = spot;
    this.focusHeight = height;
  }
  private focusDist() {
    return clamp(fitDistance(0.85, this.aspect), 2.8, 7);
  }

  setAspect(aspect: number) {
    const first = !this.aspectKnown;
    this.aspectKnown = true;
    this.aspect = aspect;
    if (this.mode === "top") {
      this.goal.dist = this.topDist();
      this.goal.z = this.centre.z + this.topShift();
    } else if (this.mode === "focus") {
      if (!this.focusZoomed) this.goal.dist = this.focusDist();
    } else if (first) {
      // The first real screen size: start from the right distance for it.
      const home = this.home();
      this.cur.dist = this.goal.dist = home.dist;
      if (this.introPending) this.startIntro();
    } else if (!this.zoomed && !this.touring) this.goal.dist = this.homeDist;
    else this.goal.dist = clamp(this.goal.dist, LIMITS.minDist, this.maxDist);
  }

  // ---- Frame ------------------------------------------------------------------

  /** The shots the camera drifts through when left alone. */
  private shots(): Shot[] {
    const d = this.homeDist;
    return [
      { yaw: 0.62, pitch: 0.62, dist: d, target: "centre" },
      { yaw: -0.55, pitch: 0.34, dist: d * 0.78, target: "centre" },
      { yaw: 0.2, pitch: 0.46, dist: Math.max(LIMITS.minDist + 0.6, d * 0.5), target: 0 },
      { yaw: 2.3, pitch: 0.9, dist: d * 0.95, target: "centre" },
      { yaw: 3.7, pitch: 0.4, dist: d * 0.7, target: "centre" },
      { yaw: 5.2, pitch: 0.45, dist: Math.max(LIMITS.minDist + 0.6, d * 0.5), target: 1 },
    ];
  }
  private applyShot(shot: Shot) {
    const spots = this.spots();
    const at = shot.target === "centre" ? this.centre : (spots[shot.target % Math.max(1, spots.length)] ?? this.centre);
    // Look at a creature only a little: the camera should keep the board in sight.
    const k = shot.target === "centre" ? 0 : 0.8;
    this.goal = {
      yaw: shot.yaw,
      pitch: clamp(shot.pitch, LIMITS.minPitch, LIMITS.maxPitch),
      dist: clamp(shot.dist, LIMITS.minDist, this.maxDist),
      x: this.centre.x + (at.x - this.centre.x) * k,
      y: shot.target === "centre" ? 0.35 : 0.45,
      z: this.centre.z + (at.z - this.centre.z) * k,
    };
  }

  update(dt: number) {
    this.time += dt;
    this.idle += dt;
    if (this.mode === "focus") {
      this.goal.x = this.focusSpot.x;
      this.goal.z = this.focusSpot.z;
      this.goal.y = this.focusHeight * 0.34;
    }
    if (this.mode === "free" && this.time >= this.holdUntil) {
      if (!this.touring && this.idle >= IDLE_BEFORE_TOUR) {
        this.touring = true;
        this.shotTime = 0;
        this.applyShot(this.shots()[this.shotIndex]);
      } else if (this.touring) {
        this.shotTime += dt;
        if (this.shotTime >= SHOT_SECONDS) {
          this.shotTime = 0;
          this.shotIndex = (this.shotIndex + 1) % this.shots().length;
          this.applyShot(this.shots()[this.shotIndex]);
        } else if (this.shots()[this.shotIndex].target !== "centre") {
          // Keep following the creature while it walks.
          this.applyShot(this.shots()[this.shotIndex]);
        }
      }
    }
    // Ease towards the goal. Tours are slower and softer than the player's own moves.
    const rate = this.time < this.introUntil ? 0.95 : this.touring ? 1.1 : this.mode === "top" ? 3 : this.mode === "focus" ? 3.5 : 5;
    const k = 1 - Math.exp(-rate * dt);
    const c = this.cur;
    const g = this.goal;
    c.yaw += angleDelta(c.yaw, g.yaw) * k;
    c.pitch += (g.pitch - c.pitch) * k;
    c.dist += (g.dist - c.dist) * k;
    c.x += (g.x - c.x) * k;
    c.y += (g.y - c.y) * k;
    c.z += (g.z - c.z) * k;
    // Keep the angle numbers small without changing where the camera is.
    if (Math.abs(c.yaw) > TAU * 2) {
      const turns = Math.round(c.yaw / TAU) * TAU;
      c.yaw -= turns;
      g.yaw -= turns;
    }
    return c;
  }

  apply(camera: THREE.PerspectiveCamera) {
    const c = this.cur;
    camera.fov = FOV;
    camera.aspect = this.aspect;
    const cp = Math.cos(c.pitch);
    camera.position.set(c.x + Math.sin(c.yaw) * cp * c.dist, c.y + Math.sin(c.pitch) * c.dist, c.z + Math.cos(c.yaw) * cp * c.dist);
    camera.lookAt(c.x, c.y, c.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  get isTouring() {
    return this.touring;
  }
}
