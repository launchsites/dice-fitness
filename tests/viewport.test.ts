import { describe, expect, it } from "vitest";
import { safeInsets } from "../web/viewport.js";

describe("Telegram safe areas", () => {
  it("adds the iPhone system inset to Telegram's content inset", () => {
    expect(safeInsets({ top: 59, bottom: 34 }, { top: 56, bottom: 8 })).toEqual({ top: 115, bottom: 42, left: 0, right: 0 });
  });
  it("reserves Telegram controls in fullscreen mobile while their inset is unavailable", () => {
    expect(safeInsets({ top: 59 }, {}, true).top).toBe(115);
    expect(safeInsets({}, {}, false).top).toBe(0);
  });
  it("handles landscape cutouts and invalid values", () => {
    expect(safeInsets({ left: 59, right: -1, top: NaN }, { left: 8, right: 4 })).toEqual({ top: 0, bottom: 0, left: 67, right: 4 });
  });
});
