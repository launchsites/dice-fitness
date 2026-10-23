/** Inspection has no knowledge of game choices, requests, or outcomes. */
export class DiceInspection {
  pointer: number | null = null;
  private lastInput = -Infinity;
  begin(pointer: number, now: number) { this.pointer = pointer; this.lastInput = now; }
  touch(now: number) { this.lastInput = now; }
  end(now: number) { this.pointer = null; this.lastInput = now; }
  resumeIdle(now: number) { this.pointer = null; this.lastInput = now - 2000; }
  reset() { this.pointer = null; this.lastInput = -Infinity; }
  idleBlend(now: number) { return this.pointer !== null ? 0 : Math.max(0, Math.min(1, (now - this.lastInput - 2000) / 500)); }
}

/** Frame-rate-independent angular momentum, kept entirely outside game state. */
export class DiceInertia {
  private x = 0;
  private y = 0;
  private lastMove = 0;
  private lastFrame = 0;
  active = false;
  begin(now: number) { this.stop(); this.lastMove = now; }
  track(x: number, y: number, now: number) {
    if (![x, y, now].every(Number.isFinite)) return;
    const elapsed = now - this.lastMove;
    const seconds = Math.max(8, Math.min(100, elapsed)) / 1000;
    const blend = elapsed > 100 ? 1 : .65;
    this.x += (x / seconds - this.x) * blend;
    this.y += (y / seconds - this.y) * blend;
    const scale = Math.min(1, 12 / Math.max(.001, Math.hypot(this.x, this.y)));
    this.x *= scale; this.y *= scale; this.lastMove = now;
  }
  release(now: number) {
    this.active = now - this.lastMove < 100 && Math.hypot(this.x, this.y) > .025;
    this.lastFrame = now;
    if (!this.active) this.stop();
    return this.active;
  }
  step(now: number) {
    if (!this.active) return { x: 0, y: 0 };
    const seconds = Math.max(0, Math.min(.05, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    const damping = Math.exp(-2.2 * seconds);
    const result = { x: this.x * (1 - damping) / 2.2, y: this.y * (1 - damping) / 2.2 };
    this.x *= damping; this.y *= damping;
    if (Math.hypot(this.x, this.y) < .025) this.stop();
    return result;
  }
  stop() { this.x = this.y = 0; this.active = false; }
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
