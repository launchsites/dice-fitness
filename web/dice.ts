import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DiceInertia, DiceInspection, DiceQuality } from "./dice-controls.js";
import { activityDie, faceUv } from "./dice-shapes.js";

type Rolling = { start: number; duration: number; initial: THREE.Quaternion; target: THREE.Quaternion; resolve(): void };

/** A porcelain-like die. Animation presents the saved server result, never chooses it. */
export class Dice {
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private die = new THREE.Group();
  private normals: THREE.Vector3[] = [];
  private ups: THREE.Vector3[] = [];
  private rest = new THREE.Quaternion();
  private frame = 0;
  private observer?: ResizeObserver;
  private disposed = false;
  private rolling?: Rolling;
  private environment?: THREE.WebGLRenderTarget;
  private surface?: THREE.MeshPhysicalMaterial;
  private floor?: THREE.Mesh;
  private noise?: THREE.CanvasTexture;
  private labelMaterials = new Map<string, THREE.MeshBasicMaterial>();
  private inspection = new DiceInspection();
  private inertia = new DiceInertia();
  private inspectable = false;
  private pointerX = 0;
  private pointerY = 0;
  private idleAnchorY = 0;
  private previousFrame = 0;
  private warmUntil = performance.now() + 2500;
  private quality = new DiceQuality(devicePixelRatio || 1, (() => {
    const hints = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
    return !!hints.connection?.saveData || (hints.deviceMemory !== undefined && hints.deviceMemory <= 2);
  })());
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private visibility = () => { this.previousFrame = 0; if (!document.hidden) this.start(); };

  constructor(private container: HTMLElement, labels: string[], private isCube = false) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.15;
      this.renderer.domElement.setAttribute("aria-hidden", "true");
      this.renderer.domElement.classList.add("dice-canvas");
      const generator = new THREE.PMREMGenerator(this.renderer);
      const room = new RoomEnvironment();
      this.environment = generator.fromScene(room, 0.04);
      this.scene.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.8;
      room.dispose(); generator.dispose();

      this.scene.add(new THREE.HemisphereLight(0xffffff, 0x64768a, 1.1));
      const key = new THREE.DirectionalLight(0xffffff, 3.4);
      key.position.set(-3, 6, 5);
      this.scene.add(key);
      const rim = new THREE.DirectionalLight(0xc4e7ff, 1.2);
      rim.position.set(4, 1, -3); this.scene.add(rim);

      this.noise = this.surfaceNoise();
      this.surface = new THREE.MeshPhysicalMaterial({ color: 0xf6f7fa, roughness: 0.26, metalness: 0, clearcoat: 0.85, clearcoatRoughness: 0.16, bumpMap: this.noise, bumpScale: 0.009, envMapIntensity: 1.05 });
      if (isCube) this.cube(labels); else this.activity(labels);
      this.rest.copy(this.orientation(isCube ? 4 : 0));
      this.die.quaternion.copy(this.rest);
      this.scene.add(this.die);
      const shadowCanvas = document.createElement("canvas"); shadowCanvas.width = shadowCanvas.height = 128;
      const shadowCtx = shadowCanvas.getContext("2d")!;
      const shadowGradient = shadowCtx.createRadialGradient(64, 64, 5, 64, 64, 64);
      shadowGradient.addColorStop(0, "rgba(0,0,0,.45)"); shadowGradient.addColorStop(.45, "rgba(0,0,0,.22)"); shadowGradient.addColorStop(1, "rgba(0,0,0,0)");
      shadowCtx.fillStyle = shadowGradient; shadowCtx.fillRect(0, 0, 128, 128);
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = isCube ? -1.35 : -1.62;
      this.floor = floor;
      this.scene.add(floor);
      this.observer = new ResizeObserver(() => this.resize());
      this.mount(container);
      const canvas = this.renderer.domElement;
      canvas.addEventListener("pointerdown", this.pointerDown);
      canvas.addEventListener("pointermove", this.pointerMove);
      canvas.addEventListener("pointerup", this.pointerEnd);
      canvas.addEventListener("pointercancel", this.pointerEnd);
      canvas.addEventListener("lostpointercapture", this.pointerEnd);
      document.addEventListener("visibilitychange", this.visibility);
      this.start();
    } catch {
      this.release();
      const fallback = document.createElement("div");
      fallback.className = `dice-fallback ${isCube ? "cube-fallback" : ""}`; fallback.textContent = labels[0] || "Roll";
      container.replaceChildren(fallback);
    }
  }

  mount(container: HTMLElement) {
    const fallback = this.container.querySelector(".dice-fallback");
    this.container.removeEventListener("keydown", this.keyInspect);
    this.container = container;
    container.addEventListener("keydown", this.keyInspect);
    if (this.renderer) container.appendChild(this.renderer.domElement);
    else if (fallback) container.appendChild(fallback);
    this.observer?.disconnect(); this.observer?.observe(container); this.resize();
    container.dataset.faceCount = String(this.normals.length);
  }

  update(container: HTMLElement, labels: string[], isCube: boolean) {
    this.cancelPointer(); this.inertia.stop(); this.inspection.reset(); this.idleAnchorY = 0; this.warmUntil = performance.now() + 1000;
    this.mount(container);
    this.isCube = isCube;
    if (!this.renderer) {
      const fallback = container.querySelector<HTMLElement>(".dice-fallback");
      if (fallback) { fallback.classList.toggle("cube-fallback", isCube); fallback.textContent = labels[0] || "Roll"; }
      return;
    }
    this.die.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    for (const material of this.labelMaterials.values()) { material.map?.dispose(); material.dispose(); }
    this.labelMaterials.clear();
    this.die.clear(); this.normals = []; this.ups = [];
    if (isCube) this.cube(labels); else this.activity(labels);
    this.container.dataset.faceCount = String(this.normals.length);
    this.rest.copy(this.orientation(isCube ? 4 : 0)); this.die.quaternion.copy(this.rest); this.die.position.set(0, 0, 0);
    if (this.floor) this.floor.position.y = isCube ? -1.35 : -1.62;
    if (!this.reduced.matches) this.renderer.domElement.animate([{ opacity: 0, transform: "scale(.88)" }, { opacity: 1, transform: "scale(1)" }], { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" });
    this.draw(); this.start();
  }

  private surfaceNoise() {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 128;
    const ctx = canvas.getContext("2d")!;
    const pixels = ctx.createImageData(128, 128);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const grain = 120 + ((i * 16807 % 2147483647) % 17);
      pixels.data.set([grain, grain, grain, 255], i);
    }
    ctx.putImageData(pixels, 0, 0);
    const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping; map.repeat.set(4, 4);
    return map;
  }

  private label(label: string, triangle: boolean, index: number, activity = false) {
    const key = activity ? `activity:${triangle}:${label}` : `amount:${label}:${index}`;
    const cached = this.labelMaterials.get(key); if (cached) return cached;
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = this.quality.labelSize(this.renderer!.capabilities.maxTextureSize);
    const ctx = canvas.getContext("2d")!;
    ctx.scale(canvas.width / 512, canvas.height / 512);
    ctx.fillStyle = "#14202b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (!activity) {
      const [value, unit] = label.endsWith("s") && !label.endsWith("reps") ? [label.slice(0, -1), "sec"] : label.split(" ");
      ctx.font = "650 156px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(value!, 256, 213, 390);
      ctx.font = "500 42px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#526170"; ctx.fillText(unit || "reps", 256, 326);
      ctx.fillStyle = "#14202b";
      for (let i = 0; i <= index; i++) { ctx.beginPath(); ctx.arc(256 + (i - index / 2) * 20, 400, 4.5, 0, Math.PI * 2); ctx.fill(); }
    } else {
      const words = label.split(/[\s-]+/), lines: string[] = [];
      let line = "";
      for (const word of words) {
        if ((line + " " + word).trim().length > 10 && line) { lines.push(line); line = word; }
        else line = (line + " " + word).trim();
      }
      if (line) lines.push(line);
      ctx.font = `650 ${triangle ? 47 : 60}px -apple-system, BlinkMacSystemFont, sans-serif`;
      lines.forEach((text, i) => ctx.fillText(text, 256, (triangle ? 324 : 256) + (i - (lines.length - 1) / 2) * (triangle ? 54 : 70), triangle ? 292 : 400));
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(16, this.renderer!.capabilities.getMaxAnisotropy());
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.labelMaterials.set(key, material); return material;
  }

  private cube(labels: string[]) {
    const body = new THREE.Mesh(new RoundedBoxGeometry(2, 2, 2, 6, 0.22), this.surface);
    body.castShadow = true; this.die.add(body);
    this.normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.ups = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    for (let i = 0; i < 6; i++) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), this.label(labels[i] || String(i + 1), false, i));
      const normal = this.normals[i]!, up = this.ups[i]!;
      face.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(normal), up, normal));
      face.position.copy(normal).multiplyScalar(1.004); this.die.add(face);
    }
  }

  private activity(labels: string[]) {
    const shape = activityDie(labels.length);
    const bevelPoints = shape.shell.flatMap((item) => item.vertices.map((vertex) => vertex.clone().lerp(item.center, .1)));
    shape.faces.forEach((item, i) => {
      this.normals.push(item.normal); this.ups.push(item.up);
      const inset = item.vertices.map((vertex) => vertex.clone().lerp(item.center, .17).addScaledVector(item.normal, .005));
      const face = new THREE.BufferGeometry();
      face.setAttribute("position", new THREE.Float32BufferAttribute(inset.flatMap((vertex) => vertex.toArray()), 3));
      face.setAttribute("uv", new THREE.Float32BufferAttribute(faceUv(item), 2));
      face.setIndex(Array.from({ length: inset.length - 2 }, (_, j) => [0, j + 1, j + 2]).flat());
      face.computeVertexNormals(); this.die.add(new THREE.Mesh(face, this.label(labels[i]!, inset.length === 3, i, true)));
    });
    const geometry = new ConvexGeometry(bevelPoints);
    const bodyPositions = geometry.getAttribute("position");
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(Array.from({ length: bodyPositions.count }, (_, i) => [bodyPositions.getX(i), bodyPositions.getY(i)]).flat(), 2));
    const body = new THREE.Mesh(geometry, this.surface); body.castShadow = true; this.die.add(body);
  }

  private orientation(face: number) {
    const index = face % this.normals.length;
    const normal = this.normals[index]!, up = this.ups[index]!;
    const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(normal).normalize(), up, normal));
    const prism = this.normals.length <= 3 || this.normals.length === 6 || this.normals.length % 2 === 1;
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.isCube ? .32 : prism ? .25 : .04, this.isCube ? -.42 : prism ? -.35 : -.06, -.04));
    return this.camera.quaternion.clone().multiply(tilt).multiply(basis.invert());
  }

  show(face: number, label: string) {
    this.inertia.stop(); this.inspection.reset(); this.idleAnchorY = 0;
    if (this.renderer) { this.rest.copy(this.orientation(face)); this.die.quaternion.copy(this.rest); this.draw(); }
    else { const fallback = this.container.querySelector(".dice-fallback"); if (fallback) fallback.textContent = label; }
  }

  private resize() {
    if (!this.renderer || this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (!width || !height) return;
    this.camera.aspect = width / height;
    const distance = 1.95 / (Math.tan(THREE.MathUtils.degToRad(18)) * Math.min(1, this.camera.aspect));
    this.camera.position.set(0, 0.7, distance); this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
    this.quality.nativeRatio = devicePixelRatio || 1;
    const ratio = this.quality.pixelRatio(width, height, this.renderer.capabilities.maxTextureSize);
    if (Math.abs(this.renderer.getPixelRatio() - ratio) > .01) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height); this.draw();
  }

  setInspectable(enabled: boolean) {
    this.inspectable = enabled && !!this.renderer;
    this.renderer?.domElement.classList.toggle("inspectable", this.inspectable);
    if (this.inspectable) {
      this.container.tabIndex = 0;
      this.container.setAttribute("aria-description", "Drag or use arrow keys to inspect the dice. This does not roll.");
    } else {
      this.cancelPointer(); this.inertia.stop(); this.inspection.reset();
      this.container.removeAttribute("tabindex"); this.container.removeAttribute("aria-description");
    }
  }

  private cancelPointer() {
    const id = this.inspection.pointer;
    this.inspection.pointer = null;
    const canvas = this.renderer?.domElement;
    if (id !== null && canvas?.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    canvas?.classList.remove("dragging");
  }

  private pointerDown = (event: PointerEvent) => {
    if (!this.inspectable || this.rolling || !event.isPrimary || event.button !== 0 || this.inspection.pointer !== null) return;
    event.preventDefault();
    this.rest.copy(this.die.quaternion); this.idleAnchorY = this.die.position.y;
    this.inertia.begin(performance.now());
    this.inspection.begin(event.pointerId, performance.now()); this.pointerX = event.clientX; this.pointerY = event.clientY;
    this.renderer!.domElement.setPointerCapture(event.pointerId);
    this.renderer!.domElement.classList.add("dragging"); this.start();
  };

  private pointerMove = (event: PointerEvent) => {
    if (!this.inspectable || this.rolling || event.pointerId !== this.inspection.pointer) return;
    event.preventDefault();
    const rect = this.container.getBoundingClientRect();
    const scale = Math.PI * 1.4 / Math.max(100, Math.min(rect.width, rect.height));
    const x = (event.clientX - this.pointerX) * scale, y = (event.clientY - this.pointerY) * scale;
    this.rotate(x, y); this.inertia.track(x, y, performance.now());
    this.pointerX = event.clientX; this.pointerY = event.clientY;
  };

  private pointerEnd = (event: PointerEvent) => {
    if (event.pointerId !== this.inspection.pointer) return;
    this.cancelPointer();
    const now = performance.now(); this.inspection.end(now);
    if (event.type === "pointerup" && !this.reduced.matches) this.inertia.release(now); else this.inertia.stop();
    this.start();
  };

  private keyInspect = (event: KeyboardEvent) => {
    if (!this.inspectable || this.rolling || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault(); this.inertia.stop(); this.idleAnchorY = this.die.position.y;
    this.rotate(event.key === "ArrowLeft" ? -.18 : event.key === "ArrowRight" ? .18 : 0, event.key === "ArrowUp" ? -.18 : event.key === "ArrowDown" ? .18 : 0);
  };

  private rotate(x: number, y: number) {
    this.die.quaternion.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(y, x, 0))).normalize();
    this.rest.copy(this.die.quaternion); this.inspection.touch(performance.now()); this.draw(); this.start();
  }

  private draw() { this.renderer?.render(this.scene, this.camera); }

  private start() { if (!this.frame && !this.disposed && this.renderer) this.frame = requestAnimationFrame(this.tick); }

  private tick = (time: number) => {
    this.frame = 0;
    if (this.disposed || document.hidden) return;
    const rolling = this.rolling;
    if (rolling) {
      const p = Math.min(1, (time - rolling.start) / rolling.duration);
      const eased = 1 - Math.pow(1 - p, 3);
      this.die.quaternion.copy(rolling.initial).slerp(rolling.target, eased);
      if (!this.reduced.matches) {
        const spin = 1 - Math.pow(1 - p, 2.5);
        this.die.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(spin * Math.PI * 8, spin * Math.PI * 6, spin * Math.PI * 4)));
        this.die.position.set(Math.sin(p * Math.PI * 2) * (1 - p) * 0.18, Math.sin(p * Math.PI) * 0.65 + (p > .7 ? Math.abs(Math.sin((p - .7) / .3 * Math.PI * 2)) * (1 - p) * .3 : 0), 0);
      }
      if (p === 1) { this.rest.copy(rolling.target); this.die.position.set(0, 0, 0); this.rolling = undefined; rolling.resolve(); }
    } else if (!this.reduced.matches && this.inspectable && this.inertia.active) {
      const delta = this.inertia.step(time);
      this.rest.premultiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(delta.y, delta.x, 0))).normalize();
      this.die.quaternion.copy(this.rest);
      if (!this.inertia.active) this.inspection.resumeIdle(time);
    } else if (!this.reduced.matches) {
      const idle = this.inspection.idleBlend(time);
      this.die.position.y = this.idleAnchorY * (1 - idle) + Math.sin(time * 0.0012) * 0.045 * idle;
      this.die.quaternion.copy(this.rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(time * .0006) * .025 * idle, Math.sin(time * .0007) * .04 * idle, 0)));
    }
    const started = performance.now();
    this.draw();
    if (time > this.warmUntil && this.previousFrame && this.quality.observe(time - this.previousFrame, performance.now() - started)) this.resize();
    this.previousFrame = time;
    if (this.rolling || !this.reduced.matches) this.start();
  };

  async roll(face: number, label: string): Promise<void> {
    this.setInspectable(false);
    if (!this.renderer) {
      const fallback = this.container.querySelector<HTMLElement>(".dice-fallback");
      if (fallback) { fallback.classList.add("rolling"); await new Promise((resolve) => setTimeout(resolve, this.reduced.matches ? 0 : 700)); fallback.classList.remove("rolling"); fallback.textContent = label; }
      return;
    }
    await new Promise<void>((resolve) => {
      this.rolling = { start: performance.now(), duration: this.reduced.matches ? 100 : 1850, initial: this.die.quaternion.clone(), target: this.orientation(face), resolve };
      this.start();
    });
  }

  private release() {
    this.inertia.stop();
    this.cancelPointer(); this.container.removeEventListener("keydown", this.keyInspect);
    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener("pointerdown", this.pointerDown);
    canvas?.removeEventListener("pointermove", this.pointerMove);
    for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) canvas?.removeEventListener(event, this.pointerEnd as EventListener);
    cancelAnimationFrame(this.frame); this.frame = 0; this.observer?.disconnect();
    document.removeEventListener("visibilitychange", this.visibility);
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material) materials.add(material);
      if (object instanceof THREE.Light && "shadow" in object) (object as THREE.DirectionalLight).shadow?.dispose();
    });
    for (const material of materials) { (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose(); }
    this.labelMaterials.clear();
    this.noise?.dispose(); this.environment?.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer = undefined;
    this.rolling?.resolve(); this.rolling = undefined;
  }

  dispose() { this.disposed = true; this.release(); this.container.replaceChildren(); }
}
