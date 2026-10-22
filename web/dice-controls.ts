/** Inspection has no knowledge of game choices, requests, or outcomes. */
export class DiceInspection {
  pointer: number | null = null;
  private lastInput = -Infinity;
  begin(pointer: number, now: number) { this.pointer = pointer; this.lastInput = now; }
  touch(now: number) { this.lastInput = now; }
  end(now: number) { this.pointer = null; this.lastInput = now; }
  reset() { this.pointer = null; this.lastInput = -Infinity; }
  idleBlend(now: number) { return this.pointer !== null ? 0 : Math.max(0, Math.min(1, (now - this.lastInput - 2000) / 500)); }
}

/** Native screen resolution within a bounded pixel budget, with sustained-load fallback. */
export class DiceQuality {
  private ceiling = 4;
  private samples: { frame: number; draw: number }[] = [];
  private slowWindows = 0;
  constructor(public nativeRatio: number, readonly economical = false) {}
  pixelRatio(width: number, height: number, maxSize: number) {
    const native = Number.isFinite(this.nativeRatio) && this.nativeRatio > 0 ? this.nativeRatio : 1;
    return Math.max(.5, Math.min(native, this.economical ? 2 : this.ceiling, Math.sqrt((this.economical ? 700_000 : 1_800_000) / Math.max(1, width * height)), maxSize / Math.max(1, width, height)));
  }
  labelSize(maxSize: number) { return Math.min(maxSize, !this.economical && this.nativeRatio > 1 ? 1024 : 512); }
  observe(frame: number, draw: number) {
    if (frame < 5 || frame > 100 || !Number.isFinite(frame) || !Number.isFinite(draw)) return false;
    this.samples.push({ frame, draw });
    if (this.samples.length < 45) return false;
    const frameMean = this.samples.reduce((sum, item) => sum + item.frame, 0) / 45;
    const drawMean = this.samples.reduce((sum, item) => sum + item.draw, 0) / 45;
    this.samples = [];
    this.slowWindows = frameMean > 26 && (drawMean > 6 || frameMean > 35) ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2 || this.ceiling <= 1.5 || this.nativeRatio <= 1.5) return false;
    this.slowWindows = 0; this.ceiling = Math.max(1.5, Math.min(this.ceiling, this.nativeRatio) * .8);
    return true;
  }
}
