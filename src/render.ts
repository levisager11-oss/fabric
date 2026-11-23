// Draws the world at art resolution (one canvas pixel per art pixel); CSS scales it up with hard edges.
import { B, BUILDINGS, DX, DY, PAD_LAUNCH_TIME, RECIPES } from "./defs";
import { Ent, Game } from "./sim";
import type { Guide } from "./guide";
import { Atlas, BELT_FRAMES, FLUID_COLORS, IT, T, buildAtlas, color, drawChunk, makeCanvas, screenOf } from "./sprites";
import { CH, chunkKey, hash } from "./world";

export const TOOL_NONE = -1, TOOL_ERASE = -2;

export interface View {
  tool: number;
  dir: number;
  hover: { x: number; y: number } | null; // tile under the pointer
  sel: Ent | null;
  guide: Guide | null;                    // the walkthrough's markers, during level 1
}

/** An arrow pointing up, as pixel offsets from its centre. */
const ARROW: [number, number][] = [[0, -3], [-1, -2], [0, -2], [1, -2], [-2, -1], [-1, -1], [0, -1], [1, -1], [2, -1], [0, 0], [0, 1], [0, 2]];
/** Kinds that put items out on one side; an arrow shows which. */
const OUTPUTS = new Set(["drill", "scoop", "crafter", "crate", "catcher", "splitter", "sorter", "driver"]);

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; g: number; s: number }
interface Rocket { x: number; y: number; t: number }
interface Ring { x: number; y: number; t: number; max: number; c: string }

const AMBIENT = "#a39cc0";
/** Buildings that look the same whichever way they face. */
export const DIRLESS = new Set(["hub", "pad", "solar", "reactor", "fusion", "lamp", "tank", "trash", "cross", "well", "burner", "turbine"]);
const TANK_ROWS: [number, number][] = [[6, 4], [5, 6], [5, 6], [5, 6], [5, 6], [6, 4]]; // x offset and width, top to bottom

export class Renderer {
  cam = { x: 8.5, y: 8.5 };   // world position at the centre of the screen, in tiles
  scale = 2;                  // device pixels per art pixel
  private zf = 2;             // the zoom the player asked for, before snapping to whole pixels
  w = 1; h = 1;               // canvas size in art pixels
  dpr = 1;
  atlas: Atlas;
  private ctx: CanvasRenderingContext2D;
  private light: HTMLCanvasElement;
  private lctx: CanvasRenderingContext2D;
  private chunks = new Map<number, HTMLCanvasElement | null>();
  private chunkSeed = -1;
  private particles: Particle[] = [];
  private rockets: Rocket[] = [];
  private rings: Ring[] = [];
  private shake = 0;
  private flash = 0;

  constructor(public canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.light = makeCanvas(1, 1);
    this.lctx = this.light.getContext("2d")!;
    this.atlas = buildAtlas();
    this.dpr = window.devicePixelRatio || 1;
    // About eleven tiles across the short side of the screen, within sensible limits.
    const tile = Math.min(48, Math.max(32, Math.min(window.innerWidth, window.innerHeight) / 11));
    this.zf = this.scale = Math.max(this.minScale(), Math.round((this.dpr * tile) / T));
    this.resize();
  }

  minScale(): number { return Math.max(1, Math.round(this.dpr * 0.6)); }
  maxScale(): number { return Math.max(3, Math.round(this.dpr * 4.5)); }
  /** CSS pixels per tile. */
  get z(): number { return (T * this.scale) / this.dpr; }

  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const cw = window.innerWidth, ch = window.innerHeight;
    this.w = Math.max(16, Math.ceil((cw * this.dpr) / this.scale));
    this.h = Math.max(16, Math.ceil((ch * this.dpr) / this.scale));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.canvas.style.width = (this.w * this.scale) / this.dpr + "px";
    this.canvas.style.height = (this.h * this.scale) / this.dpr + "px";
    this.light.width = this.w;
    this.light.height = this.h;
  }

  /** Screen position (CSS pixels) to world position in tiles. */
  toWorld(sx: number, sy: number): [number, number] {
    const k = this.dpr / this.scale;
    return [(sx * k - this.w / 2) / T + this.cam.x, (sy * k - this.h / 2) / T + this.cam.y];
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    this.zf = Math.min(this.maxScale(), Math.max(this.minScale(), this.zf * factor));
    const s = Math.round(this.zf);
    if (s === this.scale) return;
    const [wx, wy] = this.toWorld(sx, sy);
    this.scale = s;
    this.resize();
    const k = this.dpr / this.scale;
    this.cam.x = wx - (sx * k - this.w / 2) / T;
    this.cam.y = wy - (sy * k - this.h / 2) / T;
  }

  // ---------- Effects ----------
  burst(tx: number, ty: number, colors: string, count: number, speed = 26, up = 0): void {
    for (let i = 0; i < count && this.particles.length < 700; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      const life = 0.25 + Math.random() * 0.45;
      this.particles.push({
        x: tx * T, y: ty * T, vx: Math.cos(a) * v, vy: Math.sin(a) * v - up, life, max: life,
        c: color(colors[Math.floor(Math.random() * colors.length)]), g: up ? 60 : 0, s: Math.random() < 0.3 ? 2 : 1,
      });
    }
  }
  smoke(tx: number, ty: number, colors = "345"): void {
    if (this.particles.length > 600) return;
    const life = 0.6 + Math.random() * 0.5;
    this.particles.push({ x: tx * T, y: ty * T, vx: (Math.random() - 0.5) * 6, vy: -9 - Math.random() * 7, life, max: life, c: color(colors[Math.floor(Math.random() * colors.length)]), g: 0, s: Math.random() < 0.5 ? 2 : 1 });
  }
  ring(tx: number, ty: number, max = 60, c = "g"): void { this.rings.push({ x: tx * T, y: ty * T, t: 0, max, c: color(c) }); }
  shakeBy(a: number): void { this.shake = Math.max(this.shake, a); }
  flashBy(a: number): void { this.flash = Math.max(this.flash, a); }
  addRocket(e: Ent): void { this.rockets.push({ x: e.x + 1.5, y: e.y + 1.5, t: 0 }); }

  private chunkCanvas(g: Game, cx: number, cy: number, budget: { n: number }): HTMLCanvasElement | null {
    const k = chunkKey(cx, cy);
    const have = this.chunks.get(k);
    if (have !== undefined) return have;
    if (budget.n <= 0) return null;
    budget.n--;
    const chunk = g.world.chunk(cx, cy);
    let any = false;
    for (let i = 0; i < chunk.ground.length; i++) if (chunk.ground[i]) { any = true; break; }
    const cv = any ? drawChunk(chunk, (x, y) => g.world.ground(x, y), (x, y) => g.world.deposit(x, y)) : null;
    if (this.chunks.size > 220) this.chunks.clear();
    this.chunks.set(k, cv);
    return cv;
  }

  draw(g: Game, v: View, now: number, dt: number): void {
    const c = this.ctx, A = this.atlas, W = this.w, H = this.h;
    if (g.world.seed !== this.chunkSeed) { this.chunks.clear(); this.chunkSeed = g.world.seed; }
    c.imageSmoothingEnabled = false;
    c.globalAlpha = 1;
    c.globalCompositeOperation = "source-over";

    let shx = 0, shy = 0;
    if (this.shake > 0.05) {
      shx = Math.round((Math.random() - 0.5) * 2 * this.shake);
      shy = Math.round((Math.random() - 0.5) * 2 * this.shake);
      this.shake *= Math.pow(0.002, dt);
    }
    const camX = Math.round(this.cam.x * T - W / 2) + shx, camY = Math.round(this.cam.y * T - H / 2) + shy;

    // Space and stars
    c.fillStyle = "#07070d";
    c.fillRect(0, 0, W, H);
    const stars = Math.floor((W * H) / 700);
    for (let i = 0; i < stars; i++) {
      const par = 0.08 + hash(i, 3, 1) * 0.2;
      const sx = (((hash(i, 1, 1) * 4096 - camX * par) % W) + W) % W, sy = (((hash(i, 2, 1) * 4096 - camY * par) % H) + H) % H;
      const b = hash(i, 4, 1);
      c.fillStyle = b > 0.93 ? "#f4f4e6" : b > 0.6 ? "#8b9bb4" : "#414664";
      c.fillRect(sx | 0, sy | 0, 1, 1);
    }

    const tx0 = Math.floor(camX / T) - 3, ty0 = Math.floor(camY / T) - 3;
    const tx1 = Math.floor((camX + W) / T), ty1 = Math.floor((camY + H) / T);
    const cx0 = tx0 >> 4, cy0 = ty0 >> 4, cx1 = tx1 >> 4, cy1 = ty1 >> 4;
    const budget = { n: this.chunks.size ? 2 : 99 };

    // Ground
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cv = this.chunkCanvas(g, cx, cy, budget);
      if (cv) c.drawImage(cv, cx * CH * T - camX, cy * CH * T - camY);
    }

    const beltFrame = Math.floor(g.time * g.beltSpeed * T) % BELT_FRAMES;
    const animTick = Math.floor(now * 7);
    const lights: [number, number, number, number][] = []; // x, y, radius, kind

    // Scaffolds, and where the light comes from
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cell = g.getCell(cx, cy);
      if (!cell) continue;
      const bx = cx * CH * T - camX, by = cy * CH * T - camY;
      for (let k = 0; k < CH * CH; k++) {
        if (cell.floor[k]) c.drawImage(A.floor, bx + (k & 15) * T, by + (k >> 4) * T);
        const e = cell.ents[k];
        if (e && e.kind !== "belt" && e.x === cx * CH + (k & 15) && e.y === cy * CH + (k >> 4)) this.lightOf(e, e.x * T - camX, e.y * T - camY, animTick, lights);
      }
    }
    for (const r of this.rockets) {
      const k = 1 + r.t / PAD_LAUNCH_TIME;
      lights.push([r.x * T - camX, r.y * T - camY - k * k * 7 * T + 6, 48, 3]);
    }

    // Light: the rock lies in dim starlight, machines and lamps carve warm pools into it.
    const L = this.lctx;
    L.globalCompositeOperation = "source-over";
    L.fillStyle = AMBIENT;
    L.fillRect(0, 0, W, H);
    L.imageSmoothingEnabled = false;
    L.globalCompositeOperation = "lighter";
    for (const [x, y, r, kind] of lights) L.drawImage(A.lights[kind], Math.round(x - r), Math.round(y - r), r * 2, r * 2);
    c.globalCompositeOperation = "multiply";
    c.drawImage(this.light, 0, 0);
    c.globalCompositeOperation = "source-over";

    // Pipes and belts
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cell = g.getCell(cx, cy);
      if (!cell) continue;
      const bx = cx * CH * T - camX, by = cy * CH * T - camY;
      for (let k = 0; k < CH * CH; k++) {
        const px = bx + (k & 15) * T, py = by + (k >> 4) * T;
        const p = cell.pipes[k];
        if (p) {
          const net = p.net;
          const row = net && net.type >= 0 && net.vol > 0.5 ? net.type + 1 : 0;
          c.drawImage(A.pipes, p.shape * T, row * T, T, T, px, py, T, T);
          if (p.kind === "tank") {
            c.drawImage(A.build[B.tank], 0, 0, T, T, px, py, T, T);
            if (net && net.type >= 0) {
              const rows = Math.round(Math.min(1, net.vol / net.cap) * 6);
              c.fillStyle = FLUID_COLORS[net.type];
              for (let r = 0; r < rows; r++) { const [ox, w] = TANK_ROWS[5 - r]; c.fillRect(px + ox, py + 10 - r, w, 1); }
            }
          }
        }
        const e = cell.ents[k];
        if (e && e.kind === "belt") c.drawImage(A.belts, (e.shape * 4 + e.dir) * T, beltFrame * T, T, T, px, py, T, T);
      }
    }

    // Items riding the belts
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cell = g.getCell(cx, cy);
      if (!cell) continue;
      const bx = cx * CH * T - camX, by = cy * CH * T - camY;
      for (let k = 0; k < CH * CH; k++) {
        const e = cell.ents[k];
        if (!e || e.kind !== "belt" || e.n === 0) continue;
        const px = bx + (k & 15) * T + 4, py = by + (k >> 4) * T + 4;
        for (let i = e.n - 1; i >= 0; i--) {
          const item = i === 0 ? e.a : e.b, p = i === 0 ? e.ap : e.bp;
          const d = p < 0.5 ? (i === 0 ? e.af : e.bf) : e.dir;
          c.drawImage(A.items, item * IT, 0, IT, IT, px + Math.round(DX[d] * (p - 0.5) * T), py + Math.round(DY[d] * (p - 0.5) * T), IT, IT);
        }
      }
    }

    // Buildings
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cell = g.getCell(cx, cy);
      if (!cell) continue;
      for (let k = 0; k < CH * CH; k++) {
        const e = cell.ents[k];
        if (!e || e.kind === "belt") continue;
        const ex = cx * CH + (k & 15), ey = cy * CH + (k >> 4);
        if (e.x !== ex || e.y !== ey) continue;
        this.drawEnt(g, e, e.x * T - camX, e.y * T - camY, now, animTick);
      }
    }

    // Items in flight between mass drivers and catchers
    for (const s of g.shots) {
      const k = s.t / s.dur;
      const x = (s.x0 + (s.x1 - s.x0) * k) * T + 4 - camX, y = (s.y0 + (s.y1 - s.y0) * k) * T + 4 - camY;
      const lift = Math.sin(k * Math.PI) * (6 + Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * 2.2);
      c.fillStyle = "rgba(0,0,0,.45)";
      c.fillRect(Math.round(x + 2), Math.round(y + 6), 4, 2);
      c.drawImage(A.items, s.item * IT, 0, IT, IT, Math.round(x), Math.round(y - lift), IT, IT);
    }

    // Rockets that have left their pad
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.t += dt;
      const k = 1 + r.t / PAD_LAUNCH_TIME;
      const px = r.x * T - camX, py = r.y * T - camY - k * k * 7 * T;
      c.drawImage(A.rocket, (1 + (animTick & 1)) * T, 0, T, 32, Math.round(px - 8), Math.round(py - 20), T, 32);
      this.smoke(r.x + (Math.random() - 0.5) * 0.3, r.y - k * k * 7 + 0.6, "efg6");
      if (r.t > 4 || py < -80) this.rockets.splice(i, 1);
    }

    // Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles[i] = this.particles[this.particles.length - 1]; this.particles.pop(); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      c.fillStyle = p.c;
      const s = p.life < p.max * 0.35 ? 1 : p.s;
      c.fillRect(Math.round(p.x - camX), Math.round(p.y - camY), s, s);
    }

    // Ground that isn't claimed yet
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const key = chunkKey(cx, cy);
      if (g.claimed.has(key)) continue;
      const px = cx * CH * T - camX, py = cy * CH * T - camY, n = CH * T;
      c.fillStyle = "rgba(7,7,13,.55)";
      c.fillRect(px, py, n, n);
      const st = g.claimState(key);
      if (st === "far") continue;
      const ready = st === "ready";
      c.fillStyle = ready ? "#feae34" : "#5f6b8a";
      const off = ready ? animTick & 7 : 0;
      for (let i = -8; i < n; i += 8) {
        const a = Math.max(0, i + off), b = Math.min(n, i + off + 4);
        if (b <= a) continue;
        c.fillRect(px + a, py, b - a, 1); c.fillRect(px + a, py + n - 1, b - a, 1);
        c.fillRect(px, py + a, 1, b - a); c.fillRect(px + n - 1, py + a, 1, b - a);
      }
      const mx = px + n / 2, my = py + n / 2, s = ready && animTick & 4 ? 6 : 5;
      c.fillStyle = "#0b0c14"; c.fillRect(mx - s - 2, my - s - 2, s * 2 + 4, s * 2 + 4);
      c.fillStyle = ready ? "#feae34" : "#5f6b8a";
      c.fillRect(mx - s, my - 1, s * 2, 2); c.fillRect(mx - 1, my - s, 2, s * 2);
    }

    // Shockwaves
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / 0.7;
      if (k >= 1) { this.rings.splice(i, 1); continue; }
      const rad = r.max * (1 - (1 - k) * (1 - k));
      c.fillStyle = r.c;
      c.globalAlpha = 1 - k;
      const steps = Math.max(16, Math.floor(rad * 3));
      for (let a = 0; a < steps; a++) {
        const ang = (a / steps) * Math.PI * 2;
        c.fillRect(Math.round(r.x - camX + Math.cos(ang) * rad), Math.round(r.y - camY + Math.sin(ang) * rad * 0.8), 1, 1);
      }
      c.globalAlpha = 1;
    }

    // While building, every machine shows where its output goes.
    if (v.tool >= 0) {
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const cell = g.getCell(cx, cy);
        if (!cell) continue;
        for (let k = 0; k < CH * CH; k++) {
          const e = cell.ents[k];
          if (!e || !OUTPUTS.has(e.kind) || e.x !== cx * CH + (k & 15) || e.y !== cy * CH + (k >> 4)) continue;
          this.outArrow(e.x, e.y, e.size, e.dir, camX, camY, "#feae34", animTick);
        }
      }
    } else if (v.sel && OUTPUTS.has(v.sel.kind)) {
      const e = v.sel;
      this.outArrow(e.x, e.y, e.size, e.dir, camX, camY, "#fee761", animTick);
    }

    // The walkthrough: a dotted belt path and bouncing markers.
    if (v.guide) {
      const blink = Math.floor(now * 4);
      v.guide.path.forEach(([x, y, d], i) => {
        if (((i + blink) & 3) === 3) return;
        this.chevron(x * T - camX + 8, y * T - camY + 8, d, "#feae34");
      });
      for (const [x, y] of v.guide.marks) {
        const px = x * T - camX, py = y * T - camY, bob = (Math.floor(now * 5) & 1) * 2;
        c.fillStyle = "#fee761";
        for (const [ax, ay, sx, sy] of [[px, py, 1, 1], [px + T - 1, py, -1, 1], [px, py + T - 1, 1, -1], [px + T - 1, py + T - 1, -1, -1]]) {
          c.fillRect(sx > 0 ? ax : ax - 4, ay, 5, 1);
          c.fillRect(ax, sy > 0 ? ay : ay - 4, 1, 5);
        }
        // A downward arrow above the tile.
        c.fillStyle = "#0b0c14";
        c.fillRect(px + 4, py - 13 - bob, 8, 9);
        c.fillStyle = "#fee761";
        for (let r = 0; r < 4; r++) c.fillRect(px + 5 + r, py - 12 - bob + r, 6 - r * 2, 1);
        c.fillRect(px + 7, py - 16 - bob, 2, 4);
      }
    }

    // Selection: four brackets that breathe
    if (v.sel) {
      const e = v.sel, n = e.size * T, o = animTick & 2 ? 2 : 1;
      const px = e.x * T - camX - o, py = e.y * T - camY - o, m = n + o * 2;
      c.fillStyle = "#fee761";
      for (const [ax, ay, sx, sy] of [[px, py, 1, 1], [px + m - 1, py, -1, 1], [px, py + m - 1, 1, -1], [px + m - 1, py + m - 1, -1, -1]]) {
        c.fillRect(sx > 0 ? ax : ax - 3, ay, 4, 1);
        c.fillRect(ax, sy > 0 ? ay : ay - 3, 1, 4);
      }
    }

    // Build preview
    if (v.hover && v.tool !== TOOL_NONE) {
      const hx = v.hover.x, hy = v.hover.y;
      const size = v.tool >= 0 ? BUILDINGS[v.tool].size : 1, n = size * T;
      const px = hx * T - camX, py = hy * T - camY;
      let ok = true;
      if (v.tool === TOOL_ERASE) ok = false;
      else {
        ok = g.canPlace(v.tool, hx, hy);
        c.globalAlpha = 0.75;
        if (v.tool === B.belt) c.drawImage(A.belts, v.dir * T, 0, T, T, px, py, T, T);
        else if (v.tool === B.pipe) c.drawImage(A.pipes, 0, T, T, T, px, py, T, T);
        else if (v.tool === B.scaffold) c.drawImage(A.floor, px, py);
        else c.drawImage(A.build[v.tool], (DIRLESS.has(BUILDINGS[v.tool].kind) ? 0 : v.dir) * n, 0, n, n, px, py, n, n);
        c.globalAlpha = 1;
      }
      if (v.tool >= 0 && OUTPUTS.has(BUILDINGS[v.tool].kind)) this.outArrow(hx, hy, size, v.dir, camX, camY, ok ? "#63c74d" : "#e43b44", animTick);
      c.fillStyle = ok ? "#63c74d" : "#e43b44";
      if (!ok) { c.globalAlpha = 0.3; c.fillRect(px, py, n, n); c.globalAlpha = 1; }
      c.fillRect(px, py, n, 1); c.fillRect(px, py + n - 1, n, 1); c.fillRect(px, py, 1, n); c.fillRect(px + n - 1, py, 1, n);
    }

    if (this.flash > 0.01) {
      c.fillStyle = "#f4f4e6";
      c.globalAlpha = Math.min(0.7, this.flash);
      c.fillRect(0, 0, W, H);
      c.globalAlpha = 1;
      this.flash *= Math.pow(0.01, dt);
    }
  }

  /** A small arrow in direction d, centred on px,py, outlined in ink so it reads on any ground. */
  private chevron(px: number, py: number, d: number, col: string): void {
    const c = this.ctx;
    const pts = ARROW.map(([a, b]) => (d === 0 ? [a, b] : d === 1 ? [-b, a] : d === 2 ? [-a, -b] : [b, -a]));
    const x0 = Math.round(px), y0 = Math.round(py);
    c.fillStyle = "#0b0c14";
    for (const [x, y] of pts) c.fillRect(x0 + x - 1, y0 + y - 1, 3, 3);
    c.fillStyle = col;
    for (const [x, y] of pts) c.fillRect(x0 + x, y0 + y, 1, 1);
  }

  /** The arrow on the edge where a building of this size at x,y facing d puts out its items. */
  private outArrow(x: number, y: number, size: number, d: number, camX: number, camY: number, col: string, tick: number): void {
    // The output tile, as Game.outTile has it.
    const ox = d === 0 ? x : d === 1 ? x + size : d === 2 ? x + size - 1 : x - 1;
    const oy = d === 0 ? y - 1 : d === 1 ? y : d === 2 ? y + size : y + size - 1;
    const push = tick & 2 ? 1 : 0;
    const cx = ox * T + 8 - DX[d] * (8 - push) - camX, cy = oy * T + 8 - DY[d] * (8 - push) - camY;
    this.chevron(cx, cy, d, col);
  }

  /** Light a building throws on the ground around it. */
  private lightOf(e: Ent, px: number, py: number, tick: number, lights: [number, number, number, number][]): void {
    const def = BUILDINGS[e.t], n = e.size * T;
    switch (e.kind) {
      case "hub": lights.push([px + n / 2, py + n / 2 - 2, 84, 1]); lights.push([px + n / 2, py + n / 2 - 2, 34, 2]); break;
      case "lamp": lights.push([px + 8, py + 5, 66, 1]); break;
      case "pad":
        lights.push([px + n / 2, py + n / 2, 44, 1]);
        if (e.launchT >= 0) { const k = e.launchT / PAD_LAUNCH_TIME; lights.push([px + 24, py + 30 - k * k * 7 * T, 58, 3]); }
        break;
      case "reactor": case "fusion": if (e.active) lights.push([px + n / 2, py + n / 2 - 3, 76 + (tick & 1) * 3, def.light]); break;
      case "drill": case "scoop": if (e.active) lights.push([px + n / 2, py + n / 2, 13 * e.size, 1]); break;
      default:
        if (def.light && e.active) lights.push([px + n / 2, py + n / 2, (def.light === 3 ? 26 + ((tick + e.x) & 1) * 2 : 22) * e.size, def.light]);
    }
  }

  private drawEnt(g: Game, e: Ent, px: number, py: number, now: number, tick: number): void {
    const c = this.ctx, A = this.atlas, n = e.size * T;
    const phase = (tick + ((e.x * 7 + e.y * 13) & 3)) & 1;
    let frame = 0;
    switch (e.kind) {
      case "hub": frame = Math.floor(now * 2) % 3; break;
      case "pad": frame = Math.floor(now * 2) & 1; break;
      case "driver": frame = e.cool > 0 ? 1 + phase : 0; break;
      case "catcher": frame = e.q.length || e.res ? 1 : 0; break;
      case "lamp": case "solar": case "tank": case "cross": case "splitter": case "sorter": case "crate": case "trash": break;
      default: frame = e.active ? 1 + phase : 0;
    }
    const col = DIRLESS.has(e.kind) ? 0 : e.dir;
    // A freshly placed building pops in.
    const age = g.time - e.born;
    if (age < 0.16) {
      const k = age < 0.05 ? 0.6 : age < 0.11 ? 1.14 : 1;
      const m = Math.round(n * k), o = Math.round((n - m) / 2);
      c.drawImage(A.build[e.t], col * n, frame * n, n, n, px + o, py + o, m, m);
      return;
    }
    c.drawImage(A.build[e.t], col * n, frame * n, n, n, px, py, n, n);

    if (e.kind === "crafter") {
      const r = e.recipe >= 0 ? RECIPES[e.recipe] : null;
      const [sx, sy, sc] = screenOf(e.size);
      if (r) {
        if (r.out) c.drawImage(A.items, r.out[0] * IT, 0, IT, IT, px + sx, py + sy, IT * sc, IT * sc);
        else if (r.fout) { c.fillStyle = FLUID_COLORS[r.fout[0]]; c.fillRect(px + sx + 2 * sc, py + sy + 2 * sc, 4 * sc, 4 * sc); c.fillStyle = "#f4f4e6"; c.fillRect(px + sx + 2 * sc, py + sy + 2 * sc, sc, sc); }
        if (e.working) {
          c.fillStyle = "#feae34";
          c.fillRect(px + sx - 1, py + sy + IT * sc + 1, Math.round((IT * sc + 2) * e.prog), 1);
        }
      }
      if ((!r || (e.rej >= 0 && !e.working)) && tick & 2) { c.fillStyle = "#e43b44"; c.fillRect(px + sx + 3 * sc, py + sy + 2 * sc, 2 * sc, 3 * sc); c.fillRect(px + sx + 3 * sc, py + sy + 6 * sc, 2 * sc, sc); }
      if (e.active && (e.t === B.smelter || e.t === B.kiln || e.t === B.refinery) && Math.random() < 0.06) this.smoke(e.x + 0.72, e.y + 0.05);
    } else if (e.kind === "sorter") {
      if (e.filter >= 0) c.drawImage(A.items, e.filter * IT, 0, IT, IT, px + 4, py + 4, IT, IT);
    } else if (e.kind === "crate") {
      if (e.n > 0) c.drawImage(A.items, e.a * IT, 0, IT, IT, px + 4, py + 2, IT, IT);
    } else if (e.kind === "pad") {
      if (e.launchT >= 0 || e.a >= 0) {
        const k = e.launchT >= 0 ? e.launchT / PAD_LAUNCH_TIME : 0;
        const ry = py + 4 - Math.round(k * k * 7 * T);
        c.drawImage(A.rocket, (k > 0 ? 1 + (tick & 1) : 0) * T, 0, T, 32, px + 16, ry, T, 32);
        if (k > 0) for (let i = 0; i < 2; i++) this.smoke(e.x + 1.5 + (Math.random() - 0.5) * 0.5, e.y + 1.7 - k * k * 7 + 0.5, "efg65");
      }
    } else if (e.kind === "burner") {
      if (e.active && Math.random() < 0.08) this.smoke(e.x + 0.5, e.y + 0.1);
    } else if ((e.kind === "drill" || e.kind === "scoop") && e.active && Math.random() < 0.05) {
      this.burst(e.x + e.size / 2, e.y + e.size / 2 - 0.1, "CDa", 1, 14, 16);
    }
  }
}
