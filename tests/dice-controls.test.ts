import { describe, expect, it } from "vitest";
import { DiceInspection, DiceQuality } from "../web/dice-controls.js";

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
