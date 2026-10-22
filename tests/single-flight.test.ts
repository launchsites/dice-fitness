import { describe, expect, it } from "vitest";
import { singleFlight } from "../src/utils/single-flight.js";

describe("projection refresh coordination", () => {
  it("reruns a projection when state changes during an in-flight refresh", async () => {
    let state = 0, rendered = -1, release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    const work = async () => { const snapshot = state; calls++; if (calls === 1) await gate; rendered = snapshot; };
    const first = singleFlight("test-board", work);
    state = 1;
    const second = singleFlight("test-board", work);
    release(); await Promise.all([first, second]);
    expect(rendered).toBe(1); expect(calls).toBe(2);
  });
});
