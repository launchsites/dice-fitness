import * as THREE from "three";

/** Three.js (MIT) presentation of the authoritative, saved server result. */
export class Dice {
  private renderer?: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  private die = new THREE.Group();
  private normals: THREE.Vector3[] = [];
  private ups: THREE.Vector3[] = [];
  private frame = 0;
  private observer?: ResizeObserver;
  private disposed = false;

  constructor(private container: HTMLElement, labels: string[], cube = false) {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.domElement.setAttribute("aria-hidden", "true");
      container.appendChild(this.renderer.domElement);
      this.camera.position.set(0, 0.5, 6.2);
      this.camera.lookAt(0, 0, 0);
      this.scene.add(new THREE.AmbientLight(0xffffff, 2.5));
      const light = new THREE.DirectionalLight(0xffffff, 3);
      light.position.set(-3, 5, 6); this.scene.add(light);
      if (cube) this.cube(labels); else this.icosahedron(labels);
      this.die.rotation.set(0.18, -0.3, -0.12);
      this.scene.add(this.die);
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(container);
      this.resize();
    } catch {
      this.renderer?.dispose();
      this.renderer = undefined;
      const fallback = document.createElement("div");
      fallback.className = "dice-fallback"; fallback.textContent = labels[0] || "Roll";
      container.replaceChildren(fallback);
    }
  }

  private texture(label: string, triangle: boolean, index: number) {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = triangle ? (index % 3 === 0 ? "#d2ed9b" : "#b9d982") : "#d2ed9b"; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = "#8ca65f"; ctx.lineWidth = 8;
    if (triangle) { ctx.beginPath(); ctx.moveTo(8, 504); ctx.lineTo(504, 504); ctx.lineTo(256, 8); ctx.closePath(); ctx.stroke(); }
    else ctx.strokeRect(12, 12, 488, 488);
    ctx.fillStyle = "#24321d"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const words = label.toUpperCase().split(/[\s-]+/);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      if ((line + " " + word).trim().length > (triangle ? 10 : 14) && line) { lines.push(line); line = word; }
      else line = (line + " " + word).trim();
    }
    if (line) lines.push(line);
    ctx.font = `800 ${triangle ? 34 : 52}px system-ui, sans-serif`;
    const center = triangle ? 318 : 256;
    lines.forEach((text, i) => ctx.fillText(text, 256, center + (i - (lines.length - 1) / 2) * (triangle ? 42 : 66), triangle ? 275 : 430));
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private cube(labels: string[]) {
    const geometry = new THREE.BoxGeometry(1.95, 1.95, 1.95);
    const materials = Array.from({ length: 6 }, (_, i) => new THREE.MeshStandardMaterial({ map: this.texture(labels[i] || String(i + 1), false, i), roughness: 0.7 }));
    this.die.add(new THREE.Mesh(geometry, materials));
    this.normals = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.ups = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    this.die.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x5c7341, transparent: true, opacity: 0.5 })));
  }

  private icosahedron(labels: string[]) {
    const geometry = new THREE.IcosahedronGeometry(1.55, 0);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < 20; i++) {
      const vertices = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(positions, i * 3 + j));
      const face = new THREE.BufferGeometry();
      face.setAttribute("position", new THREE.Float32BufferAttribute(vertices.flatMap((vertex) => vertex.toArray()), 3));
      face.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      face.computeVertexNormals();
      this.normals.push(vertices[0]!.clone().add(vertices[1]!).add(vertices[2]!).normalize());
      this.ups.push(vertices[2]!.clone().sub(vertices[0]!.clone().add(vertices[1]!).add(vertices[2]!).divideScalar(3)).normalize());
      this.die.add(new THREE.Mesh(face, new THREE.MeshStandardMaterial({ map: this.texture(labels[i % labels.length] || "Fitness", true, i), roughness: 0.75, metalness: 0.05 })));
    }
    this.die.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color: 0x526b36, transparent: true, opacity: 0.5 })));
    geometry.dispose();
  }

  private orientation(face: number) {
    const index = face % this.normals.length;
    const normal = this.normals[index]!, up = this.ups[index]!;
    const right = up.clone().cross(normal).normalize();
    const basis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, normal.clone().cross(right), normal));
    // Keep a little of the neighbouring faces visible while preserving the outcome.
    return this.camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.13, -0.17, 0))).multiply(basis.invert());
  }

  show(face: number, label: string) {
    if (this.renderer) { this.die.quaternion.copy(this.orientation(face)); this.resize(); }
    else { const fallback = this.container.querySelector(".dice-fallback"); if (fallback) fallback.textContent = label; }
  }

  private resize() {
    if (!this.renderer || this.disposed) return;
    const { width, height } = this.container.getBoundingClientRect();
    this.camera.aspect = width / Math.max(height, 1); this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height); this.renderer.render(this.scene, this.camera);
  }

  async roll(face: number, label: string): Promise<void> {
    if (!this.renderer) {
      const fallback = this.container.querySelector<HTMLElement>(".dice-fallback");
      if (fallback) { fallback.classList.add("rolling"); await new Promise((resolve) => setTimeout(resolve, 700)); fallback.classList.remove("rolling"); fallback.textContent = label; }
      return;
    }
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now(), duration = reduced ? 100 : 1650;
    const target = this.orientation(face);
    const initial = this.die.quaternion.clone();
    await new Promise<void>((resolve) => {
      const tick = (time: number) => {
        if (this.disposed) { resolve(); return; }
        const p = Math.min(1, (time - start) / duration);
        const ease = 1 - Math.pow(1 - p, 3);
        this.die.quaternion.copy(initial).slerp(target, ease);
        if (!reduced) this.die.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler((1 - ease) * Math.PI * 8, (1 - ease) * Math.PI * 6, (1 - ease) * Math.PI * 4)));
        this.die.position.y = reduced ? 0 : Math.sin(p * Math.PI) * 0.18;
        this.renderer!.render(this.scene, this.camera);
        if (p < 1) this.frame = requestAnimationFrame(tick); else resolve();
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  dispose() {
    this.disposed = true; cancelAnimationFrame(this.frame); this.observer?.disconnect();
    this.die.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) if (material) { (material as THREE.MeshStandardMaterial).map?.dispose(); material.dispose(); }
    });
    this.renderer?.dispose();
    this.container.replaceChildren();
  }
}
