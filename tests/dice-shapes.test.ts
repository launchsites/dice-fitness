import { describe, expect, it } from "vitest";
import { activityDie, faceUv } from "../web/dice-shapes.js";
import { INJURY_FILTERS, eligibleExercises } from "../src/config/injuries.js";

describe("activity dice", () => {
  for (let count = 0; count <= 20; count++) it(`has exactly ${count} outcome faces`, () => {
    const shape = activityDie(count);
    expect(shape.faces).toHaveLength(count);
    for (const item of shape.faces) {
      expect(item.normal.length()).toBeCloseTo(1);
      expect(item.up.dot(item.normal)).toBeCloseTo(0);
      expect(item.normal.dot(item.center)).toBeGreaterThan(0);
      expect(faceUv(item)).toHaveLength(item.vertices.length * 2);
      expect(faceUv(item).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      if (item.vertices.length === 3) {
        const uv = faceUv(item);
        const top = [0, 1, 2].find((i) => Math.abs(uv[i * 2 + 1]! - 1) < .00001)!;
        expect(uv[top * 2]).toBeCloseTo(.5); // The ink must sit inside the face, not across an edge.
      }
    }
    for (const plane of shape.shell) for (const vertex of shape.shell.flatMap((item) => item.vertices)) {
      expect(vertex.clone().sub(plane.center).dot(plane.normal)).toBeLessThan(.00001);
      expect(vertex.length()).toBeLessThan(1.55001);
    }
  });
  it("covers every injury combination without repeating outcome faces", () => {
    for (let mask = 0; mask < 32; mask++) {
      const filters = INJURY_FILTERS.filter((_, i) => mask & (1 << i)).map((filter) => filter.key);
      const eligible = eligibleExercises(filters);
      expect(activityDie(eligible.length).faces).toHaveLength(eligible.length);
      expect(new Set(eligible.map((item) => item.key)).size).toBe(eligible.length);
    }
  });
  it("rejects invalid counts", () => {
    for (const count of [-1, 1.5, NaN, 129]) expect(() => activityDie(count)).toThrow("Invalid");
  });
});
