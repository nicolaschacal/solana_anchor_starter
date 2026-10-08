import { describe, expect, it } from "vitest";
import { FOCUS, LIMITS, WorldRig, angleDelta } from "./rig";

const run = (rig: WorldRig, seconds: number, dt = 0.05) => {
  for (let t = 0; t < seconds; t += dt) rig.update(dt);
};

describe("world camera", () => {
  const make = (aspect = 0.5) => {
    const rig = new WorldRig({ x: 0, z: 0 }, 2.9, () => [{ x: 1, z: 1 }, { x: -1, z: 0 }]);
    rig.setAspect(aspect);
    return rig;
  };

  it("never looks from underneath or from straight above while free", () => {
    const rig = make();
    rig.orbit(0, -50);
    run(rig, 3);
    expect(rig.cur.pitch).toBeGreaterThanOrEqual(LIMITS.minPitch - 1e-6);
    rig.orbit(0, 50);
    run(rig, 3);
    expect(rig.cur.pitch).toBeLessThanOrEqual(LIMITS.maxPitch + 1e-6);
  });

  it("limits zoom both ways", () => {
    const rig = make();
    for (let n = 0; n < 40; n++) rig.zoom(0.7);
    run(rig, 3);
    expect(rig.cur.dist).toBeGreaterThanOrEqual(LIMITS.minDist - 1e-6);
    for (let n = 0; n < 40; n++) rig.zoom(1.5);
    run(rig, 3);
    expect(rig.cur.dist).toBeLessThanOrEqual(rig.maxDist + 1e-6);
  });

  it("eases instead of jumping", () => {
    const rig = make();
    const before = rig.cur.yaw;
    rig.orbit(1, 0);
    rig.update(0.016);
    expect(Math.abs(rig.cur.yaw - before)).toBeLessThan(0.5);
    run(rig, 3);
    expect(rig.cur.yaw).toBeCloseTo(before + 1, 1);
  });

  it("starts touring after a quiet spell and stops when touched", () => {
    const rig = make();
    run(rig, 3);
    expect(rig.isTouring).toBe(false);
    run(rig, 5);
    expect(rig.isTouring).toBe(true);
    const yaw = rig.cur.yaw;
    rig.orbit(0.2, 0);
    expect(rig.isTouring).toBe(false);
    expect(Math.abs(angleDelta(rig.goal.yaw, yaw + 0.2))).toBeLessThan(1e-6);
  });

  it("changes shots while touring, always inside the limits", () => {
    const rig = make();
    const seen = new Set<string>();
    for (let t = 0; t < 90; t += 0.05) {
      rig.update(0.05);
      expect(rig.cur.pitch).toBeGreaterThanOrEqual(LIMITS.minPitch - 1e-6);
      expect(rig.cur.pitch).toBeLessThanOrEqual(LIMITS.maxPitch + 1e-6);
      expect(rig.cur.dist).toBeLessThanOrEqual(rig.maxDist + 1e-6);
      expect(rig.cur.dist).toBeGreaterThanOrEqual(LIMITS.minDist - 1e-6);
      seen.add(`${Math.round(rig.goal.yaw * 10)}:${Math.round(rig.goal.dist)}`);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it("top view looks straight down and ignores orbit", () => {
    const rig = make();
    rig.setMode("top");
    rig.orbit(1, -1);
    rig.zoom(0.5);
    run(rig, 4);
    expect(rig.cur.pitch).toBeCloseTo(LIMITS.topPitch, 1);
    expect(rig.cur.yaw).toBeCloseTo(0, 1);
    expect(rig.isTouring).toBe(false);
    rig.setMode("free");
    run(rig, 4);
    expect(rig.cur.pitch).toBeLessThan(1.3);
  });

  it("takes the short way round", () => {
    expect(angleDelta(0.1, Math.PI * 2 - 0.1)).toBeCloseTo(-0.2);
  });

  it("focus: comes close to the rebyter, keeps it centred, and stays low", () => {
    const rig = make();
    rig.setFocus(true, { x: 1, z: -2 }, 0.9, 1.2);
    run(rig, 5);
    expect(rig.mode).toBe("focus");
    expect(rig.cur.x).toBeCloseTo(1, 1);
    expect(rig.cur.z).toBeCloseTo(-2, 1);
    expect(rig.cur.dist).toBeLessThan(8);
    expect(rig.cur.pitch).toBeCloseTo(FOCUS.pitch, 1);
    rig.trackFocus({ x: 2, z: -1 }, 0.9);
    run(rig, 5);
    expect(rig.cur.x).toBeCloseTo(2, 1);
    rig.orbit(0, 50);
    run(rig, 4);
    expect(rig.cur.pitch).toBeLessThanOrEqual(FOCUS.maxPitch + 1e-6);
    for (let n = 0; n < 40; n++) rig.zoom(0.6);
    run(rig, 4);
    expect(rig.cur.dist).toBeGreaterThanOrEqual(FOCUS.minDist - 1e-6);
  });

  it("focus does not tour, and leaving it returns to the regular view", () => {
    const rig = make();
    rig.setFocus(true, { x: 0, z: 0 });
    run(rig, 30);
    expect(rig.isTouring).toBe(false);
    rig.setFocus(false);
    run(rig, 5);
    expect(rig.mode).toBe("free");
    expect(rig.cur.pitch).toBeGreaterThan(0.5);
    expect(rig.cur.dist).toBeGreaterThan(5);
  });
});
