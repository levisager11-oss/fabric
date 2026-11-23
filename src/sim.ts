// The factory simulation. No DOM in here, so it runs in tests too.
import {
  ACHIEVEMENTS, AchievementId, B, BEACON_BONUS, BUILDINGS, BURNER_SECONDS, CRATE_CAP, DEPOSIT_ITEM, DEP_VENT,
  DRIVER_RANGE, DX, DY, F, FUSION_RATE, HUB_POWER, I, ITEM_COUNT, ITEM_VALUE, Kind, LAUNCH_POINTS_PER_CORE,
  OFFLINE_EFFICIENCY, PAD_CANISTERS, PAD_LAUNCH_TIME, PAD_POINTS, PIPE_CAP, REACTOR_COOLANT, RECIPES,
  RECIPES_BY_MACHINE, ROD_SECONDS, TANK_CAP, TRACKS, TRACK_MAX, TURBINE_RATE, Track, UNLOCK_CLAIMS,
  UNLOCK_RELOCATE, UNLOCK_UPGRADES, WELL_RATE, beaconsFor, claimCost, levelCores, levelGoal, opp, trackCost,
  trackValue,
} from "./defs";
import { CH, HUB_X, HUB_Y, World, chunkKey, keyCX, keyCY, startChunks } from "./world";

export const SP = 0.5;        // spacing between items on a belt, in tiles
const END = 0.75;             // where items stop on a belt that leads nowhere
const DRILL_RATE = 0.5;       // items per second per deposit tile
const SCOOP_RATE = 0.34;
const DRILL_BUF = 4;

export interface Net {
  type: number;   // fluid index, -1 while empty and unclaimed
  vol: number;
  cap: number;
  tiles: Ent[];
}

export interface Ent {
  t: number; kind: Kind; x: number; y: number; dir: number; size: number; idx: number;
  // Belt: up to two items, a in front of b. Cross: a/b are the two lanes. Splitter/sorter/driver: a is the held item.
  // Crate: a is the stored item and n how many. Pad: a is the waiting payload, b the one being launched.
  n: number; a: number; ap: number; af: number; b: number; bp: number; bf: number;
  shape: number;          // belt: 0 straight, 1 fed from the left, 2 fed from the right. Pipe: side mask.
  last: number; want: number; mark: number;
  next: Ent | null;       // belt: what it runs into. Driver: its catcher.
  rr: number; filter: number;
  rej: number;            // crafter: an item it was offered but cannot use, -1 if none
  recipe: number; inBuf: number[]; out: number; prog: number; working: boolean; active: boolean;
  fins: number[]; fout: number;
  item: number;           // drill: what it mines
  mult: number;           // drill: deposit tiles under it
  nets: Net[];
  fuel: number;           // burner/reactor: seconds of fuel left
  net: Net | null; fluid: number; amt: number; // pipe and tank
  launchT: number;        // pad: seconds into a launch, -1 when idle
  q: number[];            // catcher: items that landed
  res: number;            // catcher: items in flight towards it
  cool: number;           // driver: seconds until the next shot
  born: number;           // game time when it was placed, for the renderer
}

export interface Shot { item: number; x0: number; y0: number; x1: number; y1: number; t: number; dur: number; to: Ent }

export type GameEvent =
  | "level" | "achievement" | "launch" | "upgrade" | "claim" | "best" | "change" | "craft" | "deliver"
  | "shot" | "land" | "place" | "remove" | "core";

export interface SaveData {
  v: number;
  seed: number;
  time: number;
  savedAt: number;
  stock: number[];
  total: number[];
  level: number;
  maxLevel: number;
  cores: number;
  tiers: number[];
  claimed: number[];
  claims: number;
  launches: number;
  launchPts: number;
  bestOutput: number;
  beacons: number;
  relocations: number;
  lastRecipe: number[];
  ach: string[];
  ents: number[][];
  pipes: number[][];
  floors: number[];
  rates: number[];
}

export interface Away { seconds: number; gains: [number, number][] }

export interface Cell { ents: (Ent | null)[]; pipes: (Ent | null)[]; floor: Uint8Array }

const TICKED: Partial<Record<Kind, boolean>> = {
  cross: true, splitter: true, sorter: true, drill: true, crafter: true, pad: true, burner: true, turbine: true,
  fusion: true, well: true, crate: true, driver: true, catcher: true, scoop: true, reactor: true,
};
const isPipe = (k: Kind) => k === "pipe" || k === "tank";
const ti = (x: number, y: number) => ((y & 15) << 4) | (x & 15);

export class Game {
  world: World;
  private cells = new Map<number, Cell>();
  ents: Ent[] = [];
  pipes: Ent[] = [];
  belts: Ent[] = [];
  ticked: Ent[] = [];
  nets: Net[] = [];
  shots: Shot[] = [];
  floors = new Set<number>();   // scaffold tiles, as packed coordinates
  dirty = true;
  pdirty = true;

  time = 0;
  stock: number[] = new Array(ITEM_COUNT).fill(0);
  total: number[] = new Array(ITEM_COUNT).fill(0);
  level = 1;
  maxLevel = 1;
  cores = 0;
  tiers: Record<Track, number> = { belt: 0, drill: 0, craft: 0, power: 0, value: 0, offline: 0 };
  claimed = new Set<number>();
  claims = 0;
  launches = 0;
  launchPts = 0;
  bestOutput = 0;
  beacons = 0;
  relocations = 0;
  lastRecipe: number[] = BUILDINGS.map(() => -1);
  ach = new Set<string>();
  counts: number[] = BUILDINGS.map(() => 0);
  away: Away | null = null;

  // Power, in kW.
  demand = 0;
  supply = HUB_POWER;
  sat = 1;
  private load = 0;
  private demandAcc = 0;
  private fuelCapAcc = 0;

  // Per-second rings over the last minute.
  private sec = 0;
  private itemRing = new Float32Array(60 * ITEM_COUNT);
  private savedRates: number[] | null = null;
  private ranFor = 0;

  beltSpeed = trackValue("belt", 0);
  private drillMul = 1;
  private craftMul = 1;
  private powerMul = 1;
  private valueMul = 1;

  on: (ev: GameEvent, data?: unknown) => void = () => {};

  constructor(seed = 0) {
    this.world = new World(seed);
    for (const k of startChunks()) this.claimed.add(k);
    this.add(B.hub, HUB_X, HUB_Y, 0);
    this.applyUpgrades();
  }

  // ---------- Grid ----------
  private cell(x: number, y: number, make: boolean): Cell | null {
    const k = chunkKey(x >> 4, y >> 4);
    let c = this.cells.get(k);
    if (!c && make) {
      c = { ents: new Array(CH * CH).fill(null), pipes: new Array(CH * CH).fill(null), floor: new Uint8Array(CH * CH) };
      this.cells.set(k, c);
    }
    return c ?? null;
  }
  getCell(cx: number, cy: number): Cell | undefined { return this.cells.get(chunkKey(cx, cy)); }
  at(x: number, y: number): Ent | null {
    const c = this.cells.get(chunkKey(x >> 4, y >> 4));
    return c ? c.ents[ti(x, y)] : null;
  }
  pipeAt(x: number, y: number): Ent | null {
    const c = this.cells.get(chunkKey(x >> 4, y >> 4));
    return c ? c.pipes[ti(x, y)] : null;
  }
  hasFloor(x: number, y: number): boolean {
    const c = this.cells.get(chunkKey(x >> 4, y >> 4));
    return !!c && c.floor[ti(x, y)] === 1;
  }
  isGround(x: number, y: number): boolean { return this.world.ground(x, y) || this.hasFloor(x, y); }
  isClaimed(x: number, y: number): boolean { return this.claimed.has(chunkKey(x >> 4, y >> 4)); }
  owned(x: number, y: number): boolean { return this.isClaimed(x, y) && this.isGround(x, y); }
  unlocked(t: number): boolean { return BUILDINGS[t].unlock <= this.maxLevel; }
  recipeUnlocked(r: number): boolean { return RECIPES[r].unlock <= this.maxLevel; }

  canPlace(t: number, x: number, y: number): boolean {
    const def = BUILDINGS[t];
    if (!this.unlocked(t)) return false;
    if (def.kind === "floor") return this.isClaimed(x, y) && !this.isGround(x, y);
    let deposits = 0;
    for (let j = 0; j < def.size; j++) {
      for (let i = 0; i < def.size; i++) {
        const tx = x + i, ty = y + j;
        if (!this.owned(tx, ty)) return false;
        const e = this.at(tx, ty), p = this.pipeAt(tx, ty);
        if (def.kind === "pipe") {
          if (p || (e && e.kind !== "belt")) return false;
        } else if (def.kind === "tank") {
          if (p || e) return false;
        } else if (def.kind === "belt") {
          if (e && e.kind !== "belt") return false;
          if (p && p.kind === "tank") return false;
        } else {
          // Other 1x1 buildings may replace a belt; nothing may stand on a pipe.
          if (p) return false;
          if (e && !(e.kind === "belt" && def.size === 1)) return false;
        }
        const dep = this.world.deposit(tx, ty);
        if (dep > 0 && dep !== DEP_VENT) deposits++;
      }
    }
    if (def.kind === "drill" && deposits === 0) return false;
    if (def.kind === "well" && this.world.deposit(x, y) !== DEP_VENT) return false;
    return true;
  }

  // ---------- Building ----------
  private mk(t: number, x: number, y: number, dir: number): Ent {
    const def = BUILDINGS[t];
    return {
      t, kind: def.kind, x, y, dir, size: def.size, idx: -1,
      n: 0, a: -1, ap: 0, af: 0, b: -1, bp: 0, bf: 0, shape: 0, last: -1, want: 0, mark: 0, next: null,
      rr: 0, filter: -1, rej: -1, recipe: -1, inBuf: [], out: 0, prog: 0, working: false, active: false,
      fins: [], fout: 0, item: -1, mult: 1, nets: [], fuel: 0, net: null, fluid: -1, amt: 0, launchT: -1,
      q: [], res: 0, cool: 0, born: this.time,
    };
  }

  /** Adds without checking: used for the hub and when loading. */
  private add(t: number, x: number, y: number, dir: number): Ent {
    const e = this.mk(t, x, y, dir);
    const layer = isPipe(e.kind);
    const list = layer ? this.pipes : this.ents;
    e.idx = list.length;
    list.push(e);
    for (let j = 0; j < e.size; j++) for (let i = 0; i < e.size; i++) {
      const c = this.cell(x + i, y + j, true)!;
      (layer ? c.pipes : c.ents)[ti(x + i, y + j)] = e;
    }
    this.counts[t]++;
    if (e.kind === "drill") {
      // Mines the first kind of deposit under it, faster the more of it it covers.
      let n = 0;
      for (let j = 0; j < e.size; j++) for (let i = 0; i < e.size; i++) {
        const item = DEPOSIT_ITEM[this.world.deposit(x + i, y + j)] ?? -1;
        if (item < 0) continue;
        if (e.item < 0) e.item = item;
        if (item === e.item) n++;
      }
      e.mult = Math.max(1, n) * (e.size > 1 ? 1.5 : 1);
    }
    if (e.kind === "scoop") e.item = I.regolith;
    if (e.kind === "crafter") this.setRecipe(e, this.defaultRecipe(t));
    if (e.kind === "pad" || e.kind === "burner" || e.kind === "reactor") e.inBuf = [0];
    if (layer) this.pdirty = true;
    this.dirty = true;
    return e;
  }

  private defaultRecipe(t: number): number {
    const last = this.lastRecipe[t];
    if (last >= 0 && this.recipeUnlocked(last)) return last;
    for (const r of RECIPES_BY_MACHINE[t]) if (this.recipeUnlocked(r)) return r;
    return -1;
  }

  place(t: number, x: number, y: number, dir: number): Ent | boolean {
    if (!this.canPlace(t, x, y)) return false;
    const def = BUILDINGS[t];
    if (def.kind === "floor") {
      this.cell(x, y, true)!.floor[ti(x, y)] = 1;
      this.floors.add(chunkKey(x, y));
      this.counts[t]++;
      this.on("place", { x, y, size: 1 });
      this.on("change");
      return true;
    }
    const old = this.at(x, y);
    if (def.kind === "belt" && old && old.kind === "belt") {
      if (old.dir !== dir) { old.dir = dir; this.dirty = true; }
      return old;
    }
    if (old && def.kind !== "pipe") this.remove(old, true);
    const e = this.add(t, x, y, dir);
    if (t === B.belt && this.counts[t] >= 100) this.unlock("belt-100");
    if (t === B.solar && this.counts[t] >= 10) this.unlock("sunlight");
    if (this.ents.length >= 500) this.unlock("builder-500");
    this.on("place", e);
    this.on("change");
    return e;
  }

  remove(e: Ent, quiet = false): boolean {
    if (e.kind === "hub") return false;
    const layer = isPipe(e.kind);
    const list = layer ? this.pipes : this.ents;
    const lastE = list[list.length - 1];
    list[e.idx] = lastE;
    lastE.idx = e.idx;
    list.pop();
    for (let j = 0; j < e.size; j++) for (let i = 0; i < e.size; i++) {
      const c = this.cell(e.x + i, e.y + j, true)!;
      (layer ? c.pipes : c.ents)[ti(e.x + i, e.y + j)] = null;
    }
    this.counts[e.t]--;
    if (layer) {
      // Keep what the rest of the network holds.
      this.writeBackNets();
      this.pdirty = true;
    }
    this.dirty = true;
    if (!quiet) { this.on("remove", e); this.on("change"); }
    return true;
  }

  /** Removes the building on a tile, or the pipe under it, or the scaffold it stood on. */
  removeAt(x: number, y: number): boolean {
    const e = this.at(x, y);
    if (e) return this.remove(e);
    const p = this.pipeAt(x, y);
    if (p) return this.remove(p);
    if (this.hasFloor(x, y)) {
      this.cell(x, y, true)!.floor[ti(x, y)] = 0;
      this.floors.delete(chunkKey(x, y));
      this.counts[B.scaffold]--;
      this.on("remove", { x, y, size: 1 });
      return true;
    }
    return false;
  }

  rotate(e: Ent, by = 1): void {
    if (isPipe(e.kind) || e.kind === "hub" || e.kind === "pad" || e.kind === "solar") return;
    e.dir = (e.dir + by) & 3;
    this.dirty = true;
    this.on("change");
  }

  setRecipe(e: Ent, r: number, remember = true): void {
    e.recipe = r;
    e.rej = -1;
    e.inBuf = r >= 0 ? RECIPES[r].inp.map(() => 0) : [];
    e.fins = r >= 0 ? RECIPES[r].fin.map(() => 0) : [];
    e.out = 0; e.prog = 0; e.working = false; e.fout = 0;
    if (r >= 0 && remember) this.lastRecipe[e.t] = r;
    this.dirty = true;
  }

  drain(p: Ent): void {
    if (!p.net) return;
    p.net.vol = 0;
    p.net.type = -1;
    for (const tile of p.net.tiles) { tile.fluid = -1; tile.amt = 0; }
  }

  /** The tile a building hands its output to. */
  outTile(e: Ent): [number, number] {
    const s = e.size;
    switch (e.dir) {
      case 0: return [e.x, e.y - 1];
      case 1: return [e.x + s, e.y];
      case 2: return [e.x + s - 1, e.y + s];
      default: return [e.x - 1, e.y + s - 1];
    }
  }

  // ---------- Topology ----------
  private feeds(e: Ent | null, d: number, x: number, y: number): boolean {
    // Does e push items in direction d into the tile x,y?
    if (!e) return false;
    switch (e.kind) {
      case "belt": return e.dir === d;
      case "drill": case "crafter": case "scoop": case "crate": case "catcher": {
        if (e.dir !== d) return false;
        const [ox, oy] = this.outTile(e);
        return ox === x && oy === y;
      }
      case "splitter": case "sorter": return e.dir !== opp(d);
      case "cross": return true;
      default: return false;
    }
  }

  usesFluid(e: Ent): boolean {
    if (e.kind === "well" || e.kind === "turbine" || e.kind === "fusion" || e.kind === "reactor") return true;
    if (e.kind !== "crafter" || e.recipe < 0) return false;
    const r = RECIPES[e.recipe];
    return r.fin.length > 0 || !!r.fout;
  }

  private writeBackNets(): void {
    for (const net of this.nets) {
      const total = net.cap || 1;
      for (const tile of net.tiles) {
        tile.fluid = net.type;
        tile.amt = net.type < 0 ? 0 : (net.vol * (tile.kind === "tank" ? TANK_CAP : PIPE_CAP)) / total;
      }
    }
  }

  rebuild(): void {
    if (this.pdirty) {
      this.pdirty = false;
      this.writeBackNets();
      for (const p of this.pipes) p.net = null;
      this.nets = [];
      const stack: Ent[] = [];
      for (const start of this.pipes) {
        if (start.net) continue;
        const net: Net = { type: -1, vol: 0, cap: 0, tiles: [] };
        this.nets.push(net);
        start.net = net;
        stack.push(start);
        while (stack.length) {
          const p = stack.pop()!;
          net.tiles.push(p);
          net.cap += p.kind === "tank" ? TANK_CAP : PIPE_CAP;
          if (net.type < 0 && p.fluid >= 0 && p.amt > 0) net.type = p.fluid;
          for (let d = 0; d < 4; d++) {
            const q = this.pipeAt(p.x + DX[d], p.y + DY[d]);
            if (q && !q.net) { q.net = net; stack.push(q); }
          }
        }
        for (const p of net.tiles) if (p.fluid === net.type && net.type >= 0) net.vol += p.amt;
        if (net.vol > net.cap) net.vol = net.cap;
      }
    }
    this.dirty = false;
    this.belts = [];
    this.ticked = [];
    for (const p of this.pipes) {
      let mask = 0;
      for (let d = 0; d < 4; d++) if (this.pipeAt(p.x + DX[d], p.y + DY[d])) mask |= 1 << d;
      p.shape = mask;
    }
    for (const e of this.ents) {
      e.mark = 0;
      if (e.kind === "driver") {
        e.next = null;
        for (let k = 2; k <= DRIVER_RANGE; k++) {
          const t = this.at(e.x + DX[e.dir] * k, e.y + DY[e.dir] * k);
          if (t && t.kind === "catcher") { e.next = t; break; }
        }
      }
      if (!TICKED[e.kind]) continue;
      this.ticked.push(e);
      // Pipe networks next to this building.
      e.nets = [];
      if (!this.usesFluid(e)) continue;
      for (let i = 0; i < e.size; i++) {
        for (const [px, py] of [[e.x + i, e.y - 1], [e.x + i, e.y + e.size], [e.x - 1, e.y + i], [e.x + e.size, e.y + i]]) {
          const p = this.pipeAt(px, py);
          if (!p || !p.net) continue;
          if (!e.nets.includes(p.net)) e.nets.push(p.net);
          // Draw a stub from the pipe towards the building.
          for (let d = 0; d < 4; d++) {
            const tx = p.x + DX[d], ty = p.y + DY[d];
            if (tx >= e.x && tx < e.x + e.size && ty >= e.y && ty < e.y + e.size) p.shape |= 1 << d;
          }
        }
      }
    }
    // Belts: downstream first, so a full line moves as one.
    const chain: Ent[] = [];
    for (const start of this.ents) {
      if (start.kind !== "belt" || start.mark) continue;
      let b: Ent | null = start;
      while (b && b.kind === "belt" && !b.mark) {
        b.mark = 1;
        chain.push(b);
        b.next = this.at(b.x + DX[b.dir], b.y + DY[b.dir]);
        b = b.next;
      }
      while (chain.length) this.belts.push(chain.pop()!);
    }
    for (const b of this.belts) {
      const d = b.dir, l = (d + 3) & 3, r = (d + 1) & 3;
      const back = this.feeds(this.at(b.x - DX[d], b.y - DY[d]), d, b.x, b.y);
      const left = this.feeds(this.at(b.x + DX[l], b.y + DY[l]), r, b.x, b.y);
      const right = this.feeds(this.at(b.x + DX[r], b.y + DY[r]), l, b.x, b.y);
      b.shape = back ? 0 : left && !right ? 1 : right && !left ? 2 : 0;
    }
  }

  // ---------- Item movement ----------
  private beltInsert(t: Ent, item: number, from: number, pos: number): boolean {
    const bit = 1 << from;
    if (t.n >= 2 || (t.n === 1 && t.ap < pos + SP - 1e-9)) { t.want |= bit; return false; }
    // Two feeders competing for the same belt take turns.
    if (t.last === from && (t.want & ~bit)) { t.want = bit; return false; }
    t.want &= ~bit;
    t.last = from;
    if (t.n === 0) { t.a = item; t.ap = pos; t.af = from; }
    else { t.b = item; t.bp = pos; t.bf = from; }
    t.n++;
    return true;
  }

  /** Hands an item moving in direction d to the building e. */
  private give(e: Ent, item: number, d: number): boolean {
    switch (e.kind) {
      case "belt":
        return e.dir !== opp(d) && this.beltInsert(e, item, d, 0);
      case "cross": {
        if (d & 1) { if (e.b >= 0) return false; e.b = item; e.bf = d; }
        else { if (e.a >= 0) return false; e.a = item; e.af = d; }
        return true;
      }
      case "splitter": case "sorter": case "driver":
        if (d !== e.dir || e.a >= 0) return false;
        e.a = item;
        return true;
      case "drill": case "scoop":
        if (item !== e.item || e.out >= DRILL_BUF) return false;
        e.out++;
        return true;
      case "crafter": {
        if (d === opp(e.dir)) return false;
        if (e.recipe < 0 || !RECIPES[e.recipe].inp.some(([i]) => i === item)) {
          // An idle, empty machine switches to a recipe that uses what it is fed (copper ore into a smelter).
          const r = this.idle(e) ? this.recipeFor(e.t, item) : -1;
          if (r < 0) { e.rej = item; return false; }
          this.setRecipe(e, r, false);
        }
        const inp = RECIPES[e.recipe].inp;
        for (let i = 0; i < inp.length; i++) {
          if (inp[i][0] === item) {
            if (e.inBuf[i] >= inp[i][1] * 2 + 2) return false;
            e.inBuf[i]++;
            e.rej = -1;
            return true;
          }
        }
        return false;
      }
      case "crate":
        if (d === opp(e.dir) || e.n >= CRATE_CAP || (e.n > 0 && e.a !== item)) return false;
        e.a = item;
        e.n++;
        return true;
      case "trash": return true;
      case "hub":
        this.stock[item] += this.valueMul;
        this.total[item] += this.valueMul;
        this.itemRing[this.sec * ITEM_COUNT + item] += this.valueMul;
        if (!this.ach.has("first-delivery")) this.unlock("first-delivery");
        this.on("deliver", item);
        return true;
      case "pad":
        if (item === I.canister) { if (e.inBuf[0] >= 8) return false; e.inBuf[0]++; return true; }
        if (PAD_POINTS[item] && e.a < 0) { e.a = item; return true; }
        return false;
      case "burner":
        if (item !== I.carbon || e.inBuf[0] >= 5) return false;
        e.inBuf[0]++;
        return true;
      case "reactor":
        if (item !== I.fuel_rod || e.inBuf[0] >= 5) return false;
        e.inBuf[0]++;
        return true;
      default:
        return false;
    }
  }

  /** A crafter holding nothing and doing nothing. */
  private idle(e: Ent): boolean {
    return !e.working && e.out === 0 && e.fout <= 0 && e.inBuf.every((n) => n === 0) && e.fins.every((n) => n <= 0);
  }

  /** The first unlocked recipe of a machine that takes this item. */
  recipeFor(t: number, item: number): number {
    for (const r of RECIPES_BY_MACHINE[t]) if (this.recipeUnlocked(r) && RECIPES[r].inp.some(([i]) => i === item)) return r;
    return -1;
  }

  /**
   * A belt is being started on x,y next to a machine whose output leads nowhere: turn the machine so its
   * output feeds the new belt. Returns the direction the machine now faces, or -1 if nothing turned.
   */
  faceOutputTo(x: number, y: number): number {
    let found: Ent | null = null, dir = -1;
    for (let d = 0; d < 4; d++) {
      const e = this.at(x - DX[d], y - DY[d]);
      if (!e || !["drill", "scoop", "crafter", "crate", "catcher"].includes(e.kind)) continue;
      const keep = e.dir;
      const [cx, cy] = this.outTile(e);
      if (this.at(cx, cy) || this.pipeAt(cx, cy)) continue; // its output already goes somewhere
      e.dir = d;
      const [ox, oy] = this.outTile(e);
      e.dir = keep;
      if (ox !== x || oy !== y) continue;
      if (found && found !== e) return -1; // two candidates: don't guess
      found = e; dir = d;
    }
    if (!found) return -1;
    if (found.dir !== dir) { found.dir = dir; this.dirty = true; this.on("change"); }
    return dir;
  }

  private pushTo(x: number, y: number, item: number, d: number): boolean {
    const t = this.at(x + DX[d], y + DY[d]);
    return t ? this.give(t, item, d) : false;
  }

  private pushOut(e: Ent, item: number): boolean {
    const [ox, oy] = this.outTile(e);
    const t = this.at(ox, oy);
    return t ? this.give(t, item, e.dir) : false;
  }

  private maxFront(b: Ent, t: Ent | null): number {
    if (!t) return END;
    if (t.kind !== "belt") return 2;
    if (t.dir === opp(b.dir)) return END;
    if (t.n === 0) return 2;
    const m = (t.n === 1 ? t.ap : t.bp) + 1 - SP;
    return t.n === 2 ? Math.min(1, m) : m;
  }

  private tickBelt(b: Ent, step: number): void {
    const t = b.next;
    let lim = this.maxFront(b, t);
    let p = b.ap + step;
    if (p > lim) p = Math.max(b.ap, lim);
    if (p >= 1 && t) {
      const ok = t.kind === "belt" ? this.beltInsert(t, b.a, b.dir, p - 1) : this.give(t, b.a, b.dir);
      if (ok) {
        b.n--;
        if (b.n) {
          b.a = b.b; b.af = b.bf;
          lim = Math.min(this.maxFront(b, t), 0.9999);
          p = b.bp + step;
          b.ap = p > lim ? Math.max(b.bp, lim) : p;
        }
        return;
      }
      p = 1;
    }
    b.ap = p;
    if (b.n === 2) {
      const q = b.bp + step, l2 = b.ap - SP;
      b.bp = q > l2 ? Math.max(b.bp, l2) : q;
    }
  }

  // ---------- Fluids ----------
  private pull(e: Ent, f: number, want: number): number {
    let got = 0;
    for (const net of e.nets) {
      if (net.type !== f || net.vol <= 0) continue;
      const take = Math.min(want - got, net.vol);
      net.vol -= take;
      got += take;
      if (got >= want) break;
    }
    return got;
  }

  private push(e: Ent, f: number, amt: number): number {
    let put = 0;
    for (const net of e.nets) {
      if (net.type !== f && net.type >= 0) continue;
      const room = net.cap - net.vol;
      if (room <= 0) continue;
      net.type = f;
      const give = Math.min(amt - put, room);
      net.vol += give;
      put += give;
      if (put >= amt) break;
    }
    return put;
  }

  // ---------- Machines ----------
  private tickEnt(e: Ent, dt: number): void {
    switch (e.kind) {
      case "cross":
        if (e.a >= 0 && this.pushTo(e.x, e.y, e.a, e.af)) e.a = -1;
        if (e.b >= 0 && this.pushTo(e.x, e.y, e.b, e.bf)) e.b = -1;
        break;
      case "splitter": {
        if (e.a < 0) break;
        for (let k = 0; k < 3; k++) {
          const o = (e.rr + k) % 3;
          const d = o === 0 ? e.dir : o === 1 ? (e.dir + 1) & 3 : (e.dir + 3) & 3;
          if (this.pushTo(e.x, e.y, e.a, d)) { e.a = -1; e.rr = (o + 1) % 3; break; }
        }
        break;
      }
      case "sorter": {
        if (e.a < 0) break;
        if (e.filter < 0 || e.a === e.filter) {
          if (this.pushTo(e.x, e.y, e.a, e.dir)) e.a = -1;
        } else {
          for (let k = 0; k < 2; k++) {
            const o = (e.rr + k) % 2;
            const d = o === 0 ? (e.dir + 1) & 3 : (e.dir + 3) & 3;
            if (this.pushTo(e.x, e.y, e.a, d)) { e.a = -1; e.rr = (o + 1) % 2; break; }
          }
        }
        break;
      }
      case "drill": case "scoop":
        e.active = e.out < DRILL_BUF;
        if (e.active) {
          this.demandAcc += BUILDINGS[e.t].power;
          e.prog += dt * (e.kind === "scoop" ? SCOOP_RATE : DRILL_RATE * e.mult) * this.drillMul * this.sat;
          if (e.prog >= 1) { e.prog -= 1; e.out++; }
        }
        if (e.out > 0 && this.pushOut(e, e.item)) e.out--;
        break;
      case "crafter": this.tickCrafter(e, dt); break;
      case "crate":
        if (e.n > 0 && this.pushOut(e, e.a)) { e.n--; if (e.n === 0) e.a = -1; }
        break;
      case "driver": {
        if (e.cool > 0) e.cool -= dt;
        const c = e.next;
        if (e.a < 0 || e.cool > 0 || !c || c.q.length + c.res >= 4) break;
        const dist = Math.abs(c.x - e.x) + Math.abs(c.y - e.y);
        this.shots.push({ item: e.a, x0: e.x, y0: e.y, x1: c.x, y1: c.y, t: 0, dur: 0.25 + dist * 0.07, to: c });
        c.res++;
        e.a = -1;
        e.cool = SP / this.beltSpeed;
        if (!this.ach.has("long-shot")) this.unlock("long-shot");
        this.on("shot", e);
        break;
      }
      case "catcher":
        if (e.q.length && this.pushOut(e, e.q[0])) e.q.shift();
        break;
      case "well": {
        e.active = e.fout < 40;
        if (e.active) {
          this.demandAcc += BUILDINGS[e.t].power;
          e.fout += WELL_RATE * dt * this.sat * this.drillMul;
        }
        if (e.fout > 0) e.fout -= this.push(e, F.helium, e.fout);
        break;
      }
      case "burner":
        if (e.fuel <= 0 && e.inBuf[0] > 0) { e.inBuf[0]--; e.fuel = BURNER_SECONDS; }
        e.active = e.fuel > 0;
        if (e.active) { this.fuelCapAcc += BUILDINGS[e.t].power * this.powerMul; e.fuel -= dt * this.load; }
        break;
      case "reactor": {
        if (e.fuel <= 0 && e.inBuf[0] > 0) { e.inBuf[0]--; e.fuel = ROD_SECONDS; }
        if (e.fout < 20) e.fout += this.pull(e, F.coolant, 20 - e.fout);
        e.active = e.fuel > 0 && e.fout > 0;
        if (e.active) {
          this.fuelCapAcc += BUILDINGS[e.t].power * this.powerMul;
          e.fuel -= dt * this.load;
          e.fout = Math.max(0, e.fout - REACTOR_COOLANT * dt * this.load);
          if (!this.ach.has("critical")) this.unlock("critical");
        }
        break;
      }
      case "turbine": case "fusion": {
        const fluid = e.kind === "turbine" ? F.hydrogen : F.helium;
        const rate = e.kind === "turbine" ? TURBINE_RATE : FUSION_RATE;
        if (e.fout < 20) e.fout += this.pull(e, fluid, 20 - e.fout);
        e.active = e.fout > 0;
        if (e.active) {
          this.fuelCapAcc += BUILDINGS[e.t].power * this.powerMul;
          e.fout = Math.max(0, e.fout - rate * dt * this.load);
          if (e.kind === "fusion" && !this.ach.has("fusion")) this.unlock("fusion");
        }
        break;
      }
      case "pad":
        if (e.launchT < 0) {
          if (e.a >= 0 && e.inBuf[0] >= PAD_CANISTERS) {
            e.inBuf[0] -= PAD_CANISTERS;
            e.b = e.a;
            e.a = -1;
            e.launchT = 0;
          }
        } else {
          e.launchT += dt;
          if (e.launchT >= PAD_LAUNCH_TIME) {
            e.launchT = -1;
            this.launches++;
            this.launchPts += PAD_POINTS[e.b] ?? 1;
            while (this.launchPts >= LAUNCH_POINTS_PER_CORE) { this.launchPts -= LAUNCH_POINTS_PER_CORE; this.cores++; this.on("core"); }
            this.on("launch", e);
            if (this.launches === 1) this.unlock("first-launch");
            if (this.launches === 100) this.unlock("launch-100");
          }
        }
        break;
    }
  }

  private tickCrafter(e: Ent, dt: number): void {
    if (e.recipe < 0) { e.active = false; return; }
    const r = RECIPES[e.recipe];
    for (let i = 0; i < r.fin.length; i++) {
      const cap = r.fin[i][1] * 2;
      if (e.fins[i] < cap) e.fins[i] += this.pull(e, r.fin[i][0], cap - e.fins[i]);
    }
    if (!e.working) {
      let can = true;
      for (let i = 0; can && i < r.fin.length; i++) if (e.fins[i] < r.fin[i][1]) can = false;
      if (can && r.out && e.out + r.out[1] > Math.max(4, r.out[1] * 2)) can = false;
      if (can && r.fout && e.fout + r.fout[1] > r.fout[1] * 3) can = false;
      for (let i = 0; can && i < r.inp.length; i++) if (e.inBuf[i] < r.inp[i][1]) can = false;
      if (can) {
        for (let i = 0; i < r.inp.length; i++) e.inBuf[i] -= r.inp[i][1];
        for (let i = 0; i < r.fin.length; i++) e.fins[i] -= r.fin[i][1];
        e.working = true;
        e.prog = 0;
      }
    }
    e.active = e.working;
    if (e.working) {
      this.demandAcc += BUILDINGS[e.t].power;
      e.prog += (dt * this.craftMul * this.sat) / r.time;
      if (e.prog >= 1) {
        e.working = false;
        e.prog = 0;
        if (r.out) e.out += r.out[1];
        if (r.fout) {
          e.fout += r.fout[1];
          if (r.fout[0] === F.water && !this.ach.has("plumber")) this.unlock("plumber");
        }
        this.on("craft", e);
      }
    }
    if (e.out > 0 && r.out && this.pushOut(e, r.out[0])) e.out--;
    if (e.fout > 0 && r.fout) e.fout -= this.push(e, r.fout[0], e.fout);
  }

  // ---------- Main step ----------
  tick(dt: number): void {
    if (this.dirty || this.pdirty) this.rebuild();
    this.time += dt;
    this.ranFor += dt;

    // Power from what ran during the last step.
    const passive = (HUB_POWER + this.counts[B.solar] * BUILDINGS[B.solar].power) * this.powerMul;
    const fuelCap = this.fuelCapAcc;
    this.demand = this.demandAcc;
    this.supply = passive + fuelCap;
    this.sat = this.demand <= this.supply ? 1 : this.supply / this.demand;
    this.load = fuelCap > 0 ? Math.min(1, Math.max(0, this.demand - passive) / fuelCap) : 0;
    this.demandAcc = 0;
    this.fuelCapAcc = 0;
    if (this.supply >= 1000 && !this.ach.has("megawatt")) this.unlock("megawatt");

    const step = this.beltSpeed * dt;
    const belts = this.belts;
    for (let i = 0; i < belts.length; i++) if (belts[i].n) this.tickBelt(belts[i], step);
    const ticked = this.ticked;
    for (let i = 0; i < ticked.length; i++) this.tickEnt(ticked[i], dt);

    // Items in flight between mass drivers and catchers.
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i];
      s.t += dt;
      if (s.t < s.dur) continue;
      s.to.res--;
      if (this.at(s.to.x, s.to.y) === s.to) { s.to.q.push(s.item); this.on("land", s.to); }
      this.shots.splice(i, 1);
    }

    const sec = Math.floor(this.time) % 60;
    if (sec !== this.sec) {
      const out = this.output();
      if (out > this.bestOutput && this.ranFor > 20) {
        this.bestOutput = Math.round(out);
        this.on("best", this.bestOutput);
        if (out >= 1000) this.unlock("output-1k");
      }
      this.sec = sec;
      this.itemRing.fill(0, sec * ITEM_COUNT, (sec + 1) * ITEM_COUNT);
    }
    this.checkLevel();
  }

  /** Deliveries of an item to the hub during the last minute. */
  itemRate(item: number): number {
    let s = 0;
    for (let i = 0; i < 60; i++) s += this.itemRing[i * ITEM_COUNT + item];
    return s;
  }

  /** Worth of everything delivered during the last minute. */
  output(): number {
    let s = 0;
    for (let i = 0; i < ITEM_COUNT; i++) { const r = this.itemRate(i); if (r) s += r * ITEM_VALUE[i]; }
    return s;
  }

  // ---------- Progress ----------
  private has(cost: [number, number][]): boolean {
    for (const [item, n] of cost) if (this.stock[item] < n) return false;
    return true;
  }

  private pay(cost: [number, number][]): void {
    for (const [item, n] of cost) this.stock[item] -= n;
  }

  private checkLevel(): void {
    const goal = levelGoal(this.level);
    if (!this.has(goal.need)) return;
    this.pay(goal.need);
    const gained = levelCores(this.level);
    this.cores += gained;
    this.level++;
    if (this.level > this.maxLevel) this.maxLevel = this.level;
    for (const n of [10, 20, 30, 50]) if (this.maxLevel >= n) this.unlock(("level-" + n) as AchievementId);
    this.on("level", { level: this.level, cores: gained });
  }

  canBuy(track: Track): "ready" | "poor" | "max" | "locked" {
    if (this.maxLevel < UNLOCK_UPGRADES) return "locked";
    const max = TRACK_MAX[track];
    if (max !== undefined && this.tiers[track] >= max) return "max";
    return this.cores >= trackCost(this.tiers[track]) ? "ready" : "poor";
  }

  buy(track: Track): boolean {
    if (this.canBuy(track) !== "ready") return false;
    this.cores -= trackCost(this.tiers[track]);
    this.tiers[track]++;
    this.applyUpgrades();
    this.unlock("upgrade-1");
    this.on("upgrade", track);
    return true;
  }

  private applyUpgrades(): void {
    const perm = 1 + this.beacons * BEACON_BONUS;
    this.beltSpeed = trackValue("belt", this.tiers.belt);
    this.drillMul = trackValue("drill", this.tiers.drill) * perm;
    this.craftMul = trackValue("craft", this.tiers.craft) * perm;
    this.powerMul = trackValue("power", this.tiers.power);
    this.valueMul = trackValue("value", this.tiers.value);
  }

  claimState(key: number): "owned" | "far" | "locked" | "ready" | "poor" {
    if (this.claimed.has(key)) return "owned";
    const cx = keyCX(key), cy = keyCY(key);
    let near = false;
    for (let d = 0; d < 4; d++) if (this.claimed.has(chunkKey(cx + DX[d], cy + DY[d]))) near = true;
    if (!near) return "far";
    if (this.maxLevel < UNLOCK_CLAIMS) return "locked";
    return this.has(claimCost(this.claims)) ? "ready" : "poor";
  }

  claim(key: number): boolean {
    if (this.claimState(key) !== "ready") return false;
    this.pay(claimCost(this.claims));
    this.claimed.add(key);
    this.claims++;
    this.unlock("claim-1");
    if (this.claims >= 10) this.unlock("claim-10");
    this.on("claim", key);
    return true;
  }

  canRelocate(): boolean { return this.level >= UNLOCK_RELOCATE; }

  /** Leaves this site for a fresh one. Beacons, records and blueprints come along; the factory does not. */
  relocate(): Game {
    const g = new Game(this.world.seed + 1);
    g.beacons = this.beacons + beaconsFor(this.level);
    g.relocations = this.relocations + 1;
    g.maxLevel = this.maxLevel;
    g.bestOutput = this.bestOutput;
    g.time = this.time;
    g.launches = this.launches;
    g.ach = new Set(this.ach);
    g.lastRecipe = this.lastRecipe.slice();
    g.applyUpgrades();
    g.on = this.on;
    g.unlock("relocate");
    return g;
  }

  private unlock(id: AchievementId): void {
    if (this.ach.has(id)) return;
    this.ach.add(id);
    this.on("achievement", id);
  }

  // ---------- Saving ----------
  serialize(now: number): SaveData {
    this.writeBackNets();
    const ents: number[][] = [];
    for (const e of this.ents) {
      if (e.kind === "hub") continue;
      const row = [e.t, e.x, e.y, e.dir];
      if (e.kind === "crafter") row.push(e.recipe, e.out, Math.round(e.fout), ...e.inBuf, ...e.fins.map(Math.round));
      else if (e.kind === "sorter") row.push(e.filter);
      else if (e.kind === "drill" || e.kind === "scoop") row.push(e.out);
      else if (e.kind === "burner" || e.kind === "reactor") row.push(e.inBuf[0], Math.round(e.fuel * 10), Math.round(e.fout));
      else if (e.kind === "pad") row.push(e.inBuf[0], e.a);
      else if (e.kind === "turbine" || e.kind === "fusion") row.push(Math.round(e.fout));
      else if (e.kind === "crate") row.push(e.a, e.n);
      else if (e.kind === "catcher") row.push(...e.q, ...this.shots.filter((s) => s.to === e).map((s) => s.item));
      ents.push(row);
    }
    // A short session says little about what the factory makes: keep the older measurement then.
    const rates: number[] = [];
    for (let i = 0; i < ITEM_COUNT; i++) {
      const live = this.itemRate(i) * (this.ranFor >= 60 ? 1 : 60 / Math.max(10, this.ranFor));
      rates.push(Math.round((this.ranFor < 30 && this.savedRates ? this.savedRates[i] ?? 0 : live) * 10) / 10);
    }
    return {
      v: 2, seed: this.world.seed, time: Math.round(this.time * 10) / 10, savedAt: now,
      stock: this.stock.map((n) => Math.round(n * 10) / 10), total: this.total.map(Math.round),
      level: this.level, maxLevel: this.maxLevel, cores: this.cores, tiers: TRACKS.map((t) => this.tiers[t]),
      claimed: [...this.claimed], claims: this.claims, launches: this.launches, launchPts: this.launchPts,
      bestOutput: this.bestOutput, beacons: this.beacons, relocations: this.relocations,
      lastRecipe: this.lastRecipe.slice(), ach: [...this.ach], ents,
      pipes: this.pipes.map((p) => [p.t, p.x, p.y, p.fluid, Math.round(p.amt)]),
      floors: [...this.floors], rates,
    };
  }

  static load(d: SaveData, now: number): Game {
    const num = (v: unknown, def = 0) => (typeof v === "number" && isFinite(v) ? v : def);
    const g = new Game(num(d.seed));
    g.time = num(d.time);
    for (let i = 0; i < ITEM_COUNT; i++) { g.stock[i] = num(d.stock?.[i]); g.total[i] = num(d.total?.[i]); }
    g.level = Math.max(1, num(d.level, 1));
    g.maxLevel = Math.max(g.level, num(d.maxLevel, 1));
    g.cores = Math.max(0, num(d.cores));
    TRACKS.forEach((t, i) => { g.tiers[t] = Math.min(TRACK_MAX[t] ?? 1e6, Math.max(0, Math.floor(num(d.tiers?.[i])))); });
    g.beacons = Math.max(0, num(d.beacons));
    g.relocations = num(d.relocations);
    g.applyUpgrades();
    for (const k of d.claimed ?? []) if (typeof k === "number") g.claimed.add(k);
    g.claims = num(d.claims);
    g.launches = num(d.launches);
    g.launchPts = num(d.launchPts);
    g.bestOutput = num(d.bestOutput);
    for (const a of d.ach ?? []) if ((ACHIEVEMENTS as readonly string[]).includes(a)) g.ach.add(a);
    for (const k of d.floors ?? []) {
      const x = keyCX(k), y = keyCY(k);
      g.cell(x, y, true)!.floor[ti(x, y)] = 1;
      g.floors.add(k);
      g.counts[B.scaffold]++;
    }
    for (const row of d.ents ?? []) {
      const [t, x, y, dir] = row;
      const def = BUILDINGS[t];
      if (!def || def.kind === "hub" || isPipe(def.kind) || def.kind === "floor") continue;
      // A save from an older version may hold something that no longer fits: skip it.
      let free = true;
      for (let j = 0; j < def.size; j++) for (let i = 0; i < def.size; i++) if (g.at(x + i, y + j)) free = false;
      if (!free) continue;
      const e = g.add(t, x, y, dir & 3);
      e.born = -10;
      if (e.kind === "crafter") {
        const r = row[4];
        if (RECIPES[r] && RECIPES[r].machine === t) {
          g.setRecipe(e, r);
          e.out = num(row[5]); e.fout = num(row[6]);
          for (let i = 0; i < e.inBuf.length; i++) e.inBuf[i] = num(row[7 + i]);
          for (let i = 0; i < e.fins.length; i++) e.fins[i] = num(row[7 + e.inBuf.length + i]);
        }
      } else if (e.kind === "sorter") e.filter = num(row[4], -1);
      else if (e.kind === "drill" || e.kind === "scoop") e.out = num(row[4]);
      else if (e.kind === "burner" || e.kind === "reactor") { e.inBuf[0] = num(row[4]); e.fuel = num(row[5]) / 10; e.fout = num(row[6]); }
      else if (e.kind === "pad") { e.inBuf[0] = num(row[4]); e.a = num(row[5], -1); }
      else if (e.kind === "turbine" || e.kind === "fusion") e.fout = num(row[4]);
      else if (e.kind === "crate") { e.a = num(row[4], -1); e.n = num(row[5]); if (e.a < 0) e.n = 0; }
      else if (e.kind === "catcher") e.q = row.slice(4).filter((i) => i >= 0 && i < ITEM_COUNT);
    }
    for (const row of d.pipes ?? []) {
      const [t, x, y, fluid, amt] = row;
      const def = BUILDINGS[t];
      if (!def || !isPipe(def.kind) || g.pipeAt(x, y)) continue;
      const p = g.add(t, x, y, 0);
      p.born = -10;
      p.fluid = num(fluid, -1);
      p.amt = num(amt);
    }
    g.lastRecipe = g.lastRecipe.map((r, i) => (d.lastRecipe && RECIPES[d.lastRecipe[i]] ? d.lastRecipe[i] : r));
    g.hubEnt().born = -10;

    // What the factory delivered while the game was closed.
    g.savedRates = (d.rates ?? []).map((r) => num(r));
    const cap = trackValue("offline", g.tiers.offline) * 3600;
    const seconds = Math.min(cap, Math.max(0, (now - num(d.savedAt, now)) / 1000));
    if (seconds >= 60 && g.savedRates.length) {
      const gains: [number, number][] = [];
      for (let i = 0; i < ITEM_COUNT; i++) {
        const n = Math.floor((g.savedRates[i] ?? 0) * (seconds / 60) * OFFLINE_EFFICIENCY);
        if (n > 0) { g.stock[i] += n; g.total[i] += n; gains.push([i, n]); }
      }
      if (gains.length) g.away = { seconds, gains };
    }
    return g;
  }

  hubEnt(): Ent { return this.ents.find((e) => e.kind === "hub")!; }
}
