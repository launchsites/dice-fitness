import { describe, expect, it } from "vitest";
import { DiceInertia, DiceInspection, DiceQuality } from "../web/dice-controls.js";

describe("dice inspection", () => {
  it("pauses idle movement during dragging and for two seconds afterwards, then eases back in", () => {
    const inspection = new DiceInspection();
    expect(inspection.idleBlend(0)).toBe(1);
    inspection.begin(7, 100); expect(inspection.idleBlend(9000)).toBe(0);
    inspection.touch(200); inspection.end(300);
    expect(inspection.idleBlend(2299)).toBe(0);
    expect(inspection.idleBlend(2550)).toBe(.5);
    expect(inspection.idleBlend(2800)).toBe(1);
    inspection.reset(); expect(inspection.pointer).toBeNull(); expect(inspection.idleBlend(0)).toBe(1);
  });
});
describe("swipe momentum", () => {
  const swipe = () => { const motion = new DiceInertia(); motion.begin(0); motion.track(.2, .1, 20); motion.release(20); return motion; };
  it("continues the swipe direction and slows gradually instead of stopping at release", () => {
    const motion = swipe();
    const early = motion.step(40), later = motion.step(60);
    expect(early.x).toBeGreaterThan(0); expect(early.y).toBeGreaterThan(0);
    expect(later.x).toBeLessThan(early.x); expect(later.y).toBeLessThan(early.y);
    for (let now = 80; now < 5000; now += 20) motion.step(now);
    expect(motion.active).toBe(false);
  });
  it("integrates consistently at different frame rates", () => {
    const travel = (step: number) => { const motion = swipe(); let x = 0; for (let now = 20 + step; now <= 1020; now += step) x += motion.step(now).x; return x; };
    expect(travel(10)).toBeCloseTo(travel(20), 8);
  });
  it("does not fling after holding still, cancellation, or a new drag", () => {
    const motion = swipe(); motion.stop(); expect(motion.step(40)).toEqual({ x: 0, y: 0 });
    motion.begin(40); motion.track(.2, 0, 60); expect(motion.release(300)).toBe(false);
    motion.begin(400); expect(motion.release(420)).toBe(false);
  });
  it("can blend into idle immediately after coasting rather than pausing again", () => {
    const inspection = new DiceInspection(); inspection.end(0); inspection.resumeIdle(3000);
    expect(inspection.idleBlend(3000)).toBe(0); expect(inspection.idleBlend(3250)).toBe(.5); expect(inspection.idleBlend(3500)).toBe(1);
  });
});
describe("dice rendering quality", () => {
  it("uses native Retina resolution instead of a fixed 2x limit", () => {
    const quality = new DiceQuality(3);
    expect(quality.pixelRatio(350, 390, 4096)).toBe(3);
    expect(quality.labelSize(4096)).toBe(1024);
    expect(new DiceQuality(1).pixelRatio(350, 390, 4096)).toBe(1);
  });
  it("bounds pixel allocation and respects constrained devices and GPU limits", () => {
    const quality = new DiceQuality(4);
    expect(1000 * 1000 * quality.pixelRatio(1000, 1000, 4096) ** 2).toBeCloseTo(1_800_000);
    expect(new DiceQuality(3, true).pixelRatio(350, 390, 4096)).toBe(2);
    expect(new DiceQuality(3, true).labelSize(4096)).toBe(512);
    expect(quality.pixelRatio(1000, 1000, 1024)).toBe(1.024);
    expect(new DiceQuality(NaN).pixelRatio(350, 390, 4096)).toBe(1);
  });
  it("ignores isolated hiccups but backs off after sustained heavy frames", () => {
    const quality = new DiceQuality(3);
    for (let i = 0; i < 90; i++) quality.observe(16.7, 2);
    expect(quality.pixelRatio(350, 390, 4096)).toBe(3);
    for (let i = 0; i < 45; i++) quality.observe(40, 12);
    expect(quality.pixelRatio(350, 390, 4096)).toBe(3);
    for (let i = 0; i < 45; i++) quality.observe(40, 12);
    expect(quality.pixelRatio(350, 390, 4096)).toBeCloseTo(2.4);
  });
});
