// The asteroid field: endless, generated chunk by chunk from a seed. Every site (seed) is the same for all players.

export const CH = 16;                 // tiles per chunk side; a chunk is also the unit of land you claim
export const HUB_X = 7, HUB_Y = 7;    // top-left tile of the 3x3 hub

export const chunkKey = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);
export const keyCX = (k: number) => Math.floor(k / 65536) - 32768;
export const keyCY = (k: number) => (k % 65536) - 32768;

export function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
export function noise(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Deposits near the hub are placed by hand so every start works: [type, x, y, radius]
const START_PATCHES: [number, number, number, number][] = [
  [1, 0, 2, 3.0], [2, 16, 1, 2.8], [3, 17, 16, 2.8], [4, -1, 16, 2.6],
  [5, 8, -17, 3.0], [6, -18, 8, 2.7], [1, 30, -6, 3.6], [2, -8, 30, 3.6],
];
const CELL = 14; // one possible deposit per cell of this many tiles

export interface Chunk {
  cx: number; cy: number;
  ground: Uint8Array;   // 1 rock, 0 open space
  deposit: Uint8Array;
}

export class World {
  private chunks = new Map<number, Chunk>();
  constructor(public seed: number) {}

  chunk(cx: number, cy: number): Chunk {
    const k = chunkKey(cx, cy);
    let c = this.chunks.get(k);
    if (!c) { c = this.generate(cx, cy); this.chunks.set(k, c); }
    return c;
  }

  ground(x: number, y: number): boolean {
    return this.chunk(x >> 4, y >> 4).ground[((y & 15) << 4) | (x & 15)] === 1;
  }
  deposit(x: number, y: number): number {
    return this.chunk(x >> 4, y >> 4).deposit[((y & 15) << 4) | (x & 15)];
  }

  /** The deposit a cell holds, if any: [type, centre x, centre y, radius]. */
  private cellPatch(gx: number, gy: number): [number, number, number, number] | null {
    const s = this.seed * 97 + 11;
    const cx = gx * CELL + 3 + Math.floor(hash(gx, gy, s) * (CELL - 6));
    const cy = gy * CELL + 3 + Math.floor(hash(gx, gy, s + 1) * (CELL - 6));
    const dist = Math.hypot(cx - 8, cy - 8);
    if (dist < 34) return null;                       // the start area is hand-made
    if (hash(gx, gy, s + 2) > 0.5) return null;
    const pick = hash(gx, gy, s + 3);
    let pool: number[];
    if (dist < 60) pool = [1, 2, 3, 4, 5, 6, 1, 2];
    else if (dist < 100) pool = [1, 2, 3, 4, 5, 6, 8, 8, 7];
    else pool = [1, 2, 3, 4, 5, 6, 8, 9, 9, 7];
    const type = pool[Math.floor(pick * pool.length)];
    const r = type === 7 ? 1.2 : Math.min(6, 2.6 + dist / 60 + hash(gx, gy, s + 4) * 1.4);
    return [type, cx, cy, r];
  }

  private generate(cx: number, cy: number): Chunk {
    const ground = new Uint8Array(CH * CH), deposit = new Uint8Array(CH * CH);
    const s = this.seed * 13 + 5;
    const patches: [number, number, number, number][] = [];
    const x0 = cx * CH, y0 = cy * CH;
    for (const p of START_PATCHES) if (p[1] > x0 - 8 && p[1] < x0 + CH + 8 && p[2] > y0 - 8 && p[2] < y0 + CH + 8) patches.push(p);
    const g0x = Math.floor((x0 - 7) / CELL), g1x = Math.floor((x0 + CH + 7) / CELL);
    const g0y = Math.floor((y0 - 7) / CELL), g1y = Math.floor((y0 + CH + 7) / CELL);
    for (let gy = g0y; gy <= g1y; gy++) for (let gx = g0x; gx <= g1x; gx++) {
      const p = this.cellPatch(gx, gy);
      if (p) patches.push(p);
    }
    for (let j = 0; j < CH; j++) {
      for (let i = 0; i < CH; i++) {
        const x = x0 + i, y = y0 + j;
        const d = Math.hypot(x - 8, y - 8);
        // Rock where the noise is high; always rock around the hub, thinning into drifting islands far out.
        const n = noise(x / 26, y / 26, s) * 0.6 + noise(x / 9, y / 9, s + 1) * 0.3 + noise(x / 4, y / 4, s + 2) * 0.1;
        const bias = d < 26 ? 1 : Math.max(0, 0.22 - (d - 26) * 0.012);
        if (n + bias > 0.44) ground[(j << 4) | i] = 1;
      }
    }
    for (const [type, px, py, r] of patches) {
      for (let j = 0; j < CH; j++) {
        for (let i = 0; i < CH; i++) {
          const x = x0 + i, y = y0 + j;
          const d = Math.hypot(x - px, y - py);
          if (d > r + 1) continue;
          // Keep the hub's surroundings free.
          if (x >= HUB_X - 2 && x <= HUB_X + 4 && y >= HUB_Y - 2 && y <= HUB_Y + 4) continue;
          if (type === 7) { if (d < 1.2 && hash(x, y, s + 9) < 0.5) { deposit[(j << 4) | i] = 7; ground[(j << 4) | i] = 1; } continue; }
          if (d < r * (0.7 + 0.6 * noise(x / 2.5, y / 2.5, type * 31 + px))) {
            deposit[(j << 4) | i] = type;
            ground[(j << 4) | i] = 1; // a deposit always has rock under it
          }
        }
      }
    }
    return { cx, cy, ground, deposit };
  }
}

/** Chunks the player owns at the start: the 3x3 block around the hub's chunk. */
export function startChunks(): number[] {
  const out: number[] = [];
  for (let cy = -1; cy <= 1; cy++) for (let cx = -1; cx <= 1; cx++) out.push(chunkKey(cx, cy));
  return out;
}
