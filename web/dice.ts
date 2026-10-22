import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { ConvexGeometry } from "three/addons/geometries/ConvexGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

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
  private reduced = matchMedia("(prefers-reduced-motion: reduce)");
  private visibility = () => { if (!document.hidden) this.start(); };

  constructor(private container: HTMLElement, labels: string[], private isCube = false) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
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
      if (isCube) this.cube(labels); else this.icosahedron(labels);
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
    this.container = container;
    if (this.renderer) container.appendChild(this.renderer.domElement);
    else if (fallback) container.appendChild(fallback);
    this.observer?.disconnect(); this.observer?.observe(container); this.resize();
  }

  update(container: HTMLElement, labels: string[], isCube: boolean) {
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
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (material && material !== this.surface) {
        (material as THREE.MeshBasicMaterial).map?.dispose(); material.dispose();
      }
    });
    this.die.clear(); this.normals = []; this.ups = [];
    if (isCube) this.cube(labels); else this.icosahedron(labels);
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

  private label(label: string, triangle: boolean, index: number) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#14202b"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (!triangle) {
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
      ctx.font = "650 47px -apple-system, BlinkMacSystemFont, sans-serif";
      lines.forEach((text, i) => ctx.fillText(text, 256, 324 + (i - (lines.length - 1) / 2) * 54, 292));
    }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer!.capabilities.getMaxAnisotropy());
    return new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
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

  private icosahedron(labels: string[]) {
    const original = new THREE.IcosahedronGeometry(1.55, 0);
    const positions = original.getAttribute("position");
    const bevelPoints: THREE.Vector3[] = [];
    for (let i = 0; i < 20; i++) {
      const vertices = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(positions, i * 3 + j));
      const center = vertices[0]!.clone().add(vertices[1]!).add(vertices[2]!).divideScalar(3);
      const normal = center.clone().normalize();
      this.normals.push(normal); this.ups.push(vertices[2]!.clone().sub(center).normalize());
      bevelPoints.push(...vertices.map((vertex) => vertex.clone().lerp(center, 0.1)));
      const inset = vertices.map((vertex) => vertex.clone().lerp(center, 0.17).addScaledVector(normal, 0.005));
      const face = new THREE.BufferGeometry();
      face.setAttribute("position", new THREE.Float32BufferAttribute(inset.flatMap((vertex) => vertex.toArray()), 3));
      face.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      face.computeVertexNormals(); this.die.add(new THREE.Mesh(face, this.label(labels[i % labels.length] || "Roll", true, i)));
    }
    const geometry = new ConvexGeometry(bevelPoints);
    const bodyPositions = geometry.getAttribute("position");
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(Array.from({ length: bodyPositions.count }, (_, i) => [bodyPositions.getX(i), bodyPositions.getY(i)]).flat(), 2));
    const body = new THREE.Mesh(geometry, this.surface); body.castShadow = true; this.die.add(body); original.dispose();
  }

  private orientation(face: number) {
    const index = face % this.normals.length;
    const normal = this.normals[index]!, up = this.ups[index]!;
    const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(up.clone().cross(normal).normalize(), up, normal));
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.isCube ? 0.32 : 0.04, this.isCube ? -0.42 : -0.06, -0.04));
    return this.camera.quaternion.clone().multiply(tilt).multiply(basis.invert());
  }

  show(face: number, label: string) {
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
    this.renderer.setSize(width, height); this.draw();
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
    } else if (!this.reduced.matches) {
      this.die.position.y = Math.sin(time * 0.0012) * 0.045;
      this.die.quaternion.copy(this.rest).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.sin(time * .0006) * .025, Math.sin(time * .0007) * .04, 0)));
    }
    this.draw();
    if (this.rolling || !this.reduced.matches) this.start();
  };

  async roll(face: number, label: string): Promise<void> {
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
    this.noise?.dispose(); this.environment?.dispose(); this.renderer?.dispose(); this.renderer?.forceContextLoss(); this.renderer = undefined;
    this.rolling?.resolve(); this.rolling = undefined;
  }

  dispose() { this.disposed = true; this.release(); this.container.replaceChildren(); }
}
