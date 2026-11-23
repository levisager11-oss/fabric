// The first-level walkthrough: which button to press next and where on the map to build. No DOM, so it is tested.
import { B, Cat, DX, DY, I, opp } from "./defs";
import { Ent, Game } from "./sim";

export interface Guide {
  text: string;                       // i18n key of the voice line
  cat: Cat | null;                    // build menu to open
  b: number;                          // building to choose, -1 for none
  marks: [number, number][];          // tiles to point at
  path: [number, number, number][];   // tiles to lay belt on, with the direction each belt should run
}

/** Where the chain of belts and machines that starts at e leads. */
interface Trace { belts: Ent[]; machines: Ent[]; hub: boolean; end: [number, number, number] | null }

function trace(g: Game, e: Ent): Trace {
  const out: Trace = { belts: [], machines: [], hub: false, end: null };
  let [x, y] = g.outTile(e);
  let dir = e.dir;
  const seen = new Set<Ent>();
  for (let n = 0; n < 400; n++) {
    const t = g.at(x, y);
    if (!t) { out.end = [x, y, dir]; return out; }
    if (seen.has(t)) return out;
    seen.add(t);
    if (t.kind === "hub") { out.hub = true; return out; }
    // Arriving against the way a belt runs, or into the back of a machine's output, goes nowhere.
    if (t.kind === "belt") {
      if (t.dir === opp(dir)) return out;
      out.belts.push(t);
      dir = t.dir;
      x += DX[dir]; y += DY[dir];
    } else if (t.kind === "crafter" || t.kind === "drill") {
      if (t.dir === opp(dir)) return out;
      out.machines.push(t);
      dir = t.dir;
      [x, y] = g.outTile(t);
    } else return out;
  }
  return out;
}

/**
 * The cheapest belt path from the start tiles into the hub: free tiles only, few turns. Each start is
 * [x, y, dir], dir being the way the item arrives there.
 */
export function beltPath(g: Game, starts: [number, number, number][]): [number, number, number][] {
  const hub = g.hubEnt();
  const R = 30, W = R * 2 + 1;
  const ox = hub.x + 1 - R, oy = hub.y + 1 - R;
  const inside = (x: number, y: number) => x >= ox && y >= oy && x < ox + W && y < oy + W;
  const id = (x: number, y: number, d: number) => (((y - oy) * W + (x - ox)) << 2) | d;
  const cost = new Map<number, number>();
  const prev = new Map<number, number>();
  const buckets: number[][] = [];
  const push = (s: number, c: number, from: number) => {
    const have = cost.get(s);
    if (have !== undefined && have <= c) return;
    cost.set(s, c);
    prev.set(s, from);
    (buckets[c] ??= []).push(s);
  };
  const free = (x: number, y: number) => inside(x, y) && !g.at(x, y) && g.canPlace(B.belt, x, y);
  for (const [x, y, d] of starts) if (free(x, y)) push(id(x, y, d), 0, -1);
  for (let c = 0; c < buckets.length && c < 4000; c++) {
    const list = buckets[c];
    if (!list) continue;
    for (const s of list) {
      if (cost.get(s) !== c) continue;
      const d = s & 3, k = s >> 2, x = ox + (k % W), y = oy + Math.floor(k / W);
      for (let nd = 0; nd < 4; nd++) {
        if (nd === opp(d)) continue;
        const nx = x + DX[nd], ny = y + DY[nd];
        const t = g.at(nx, ny);
        if (t && t.kind === "hub") {
          // Reached: walk back, giving each tile the direction towards the next one.
          const out: [number, number, number][] = [];
          let cur = s, next = nd;
          while (cur >= 0) {
            const ck = cur >> 2;
            out.push([ox + (ck % W), oy + Math.floor(ck / W), next]);
            next = cur & 3;
            cur = prev.get(cur)!;
          }
          return out.reverse();
        }
        if (free(nx, ny)) push(id(nx, ny, nd), c + 10 + (nd === d ? 0 : 3), s);
      }
    }
  }
  return [];
}

/** The nearest free iron ore tile to the hub. */
function ironSpot(g: Game): [number, number] | null {
  const hub = g.hubEnt();
  let best: [number, number] | null = null, bd = Infinity;
  for (let y = hub.y - 20; y <= hub.y + 22; y++) for (let x = hub.x - 20; x <= hub.x + 22; x++) {
    if (g.world.deposit(x, y) !== 1 || !g.canPlace(B.drill, x, y) || g.at(x, y)) continue;
    // Prefer ore with room around it for the belt.
    const d = Math.hypot(x - hub.x - 1, y - hub.y - 1) + (g.world.deposit(x + 1, y) === 1 ? 0.5 : 0);
    if (d < bd) { bd = d; best = [x, y]; }
  }
  return best;
}

/** What the player should do next during level 1, or null once the first ingots arrive. */
export function guide(g: Game): Guide | null {
  if (g.maxLevel > 1) return null;
  if (g.total[I.iron_ingot] > 0) return { text: "tut.5", cat: null, b: -1, marks: [], path: [] };
  const drill = g.ents.find((e) => e.kind === "drill" && e.item === I.iron_ore);
  if (!drill) {
    const spot = ironSpot(g);
    return { text: "tut.1", cat: "mine", b: B.drill, marks: spot ? [spot] : [], path: [] };
  }
  const tr = trace(g, drill);
  let path: [number, number, number][] = [];
  if (!tr.hub) {
    if (tr.end) path = beltPath(g, [tr.end]);
    // Nothing leads away from the drill yet: start from whichever side gets to the hub best.
    if (!tr.belts.length) {
      const starts: [number, number, number][] = [];
      for (let d = 0; d < 4; d++) {
        const save = drill.dir;
        drill.dir = d;
        const [x, y] = g.outTile(drill);
        drill.dir = save;
        starts.push([x, y, d]);
      }
      const p = beltPath(g, starts);
      if (p.length && (!path.length || p.length < path.length)) path = p;
    }
  }
  const smelter = tr.machines.find((m) => m.t === B.smelter);
  if (!tr.belts.length) return { text: "tut.2", cat: "logi", b: B.belt, marks: [], path };
  if (!smelter) {
    const b = tr.belts[Math.min(1, tr.belts.length - 1)];
    return { text: "tut.3", cat: "prod", b: B.smelter, marks: [[b.x, b.y]], path };
  }
  if (!tr.hub) {
    const end = tr.end;
    return { text: "tut.4", cat: "logi", b: B.belt, marks: end ? [[end[0], end[1]]] : [], path };
  }
  return { text: "tut.4", cat: null, b: -1, marks: [], path: [] };
}
