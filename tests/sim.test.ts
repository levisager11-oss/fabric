import { describe, expect, it } from "vitest";
import { B, F, I, ITEM_VALUE, LEVELS, RECIPES, levelGoal, trackCost } from "../src/defs";
import { Ent, Game } from "../src/sim";
import { chunkKey } from "../src/world";

const DT = 1 / 60;
function run(g: Game, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) g.tick(DT);
}
/** A deposit tile the player owns, with `free` empty rock tiles to its east. */
function findDeposit(g: Game, type: number, free = 3): [number, number] {
  for (let y = -60; y < 80; y++) for (let x = -60; x < 80; x++) {
    if (g.world.deposit(x, y) !== type || !g.owned(x, y)) continue;
    let ok = true;
    for (let i = 1; i <= free; i++) if (g.world.deposit(x + i, y) !== 0 || !g.owned(x + i, y)) ok = false;
    if (ok) return [x, y];
  }
  throw new Error("no deposit " + type);
}
function claimAround(g: Game, r = 4) {
  for (let cy = -r; cy <= r; cy++) for (let cx = -r; cx <= r; cx++) g.claimed.add(chunkKey(cx, cy));
}
const recipe = (id: string) => RECIPES.findIndex((r) => r.id === id);
const put = (g: Game, t: number, x: number, y: number, d = 1) => g.place(t, x, y, d) as Ent;
const feed = (g: Game, belt: Ent, item: number) => (g as any).beltInsert(belt, item, belt.dir, 0) as boolean;

describe("factory", () => {
  it("mines, smelts and piles ingots up on a dead-end belt", () => {
    const g = new Game();
    const [x, y] = findDeposit(g, 1, 4);
    expect(g.place(B.drill, x, y, 1)).toBeTruthy();
    expect(g.place(B.belt, x + 1, y, 1)).toBeTruthy();
    const sm = put(g, B.smelter, x + 2, y);
    expect(sm.recipe).toBe(recipe("iron_ingot"));
    g.place(B.belt, x + 3, y, 1);
    run(g, 20);
    const out = g.at(x + 3, y)!;
    expect(out.n).toBe(2);
    expect(out.a).toBe(I.iron_ingot);
  });

  it("completes level 1 from hub deliveries and pays a core", () => {
    const g = new Game();
    const hub = g.hubEnt();
    const belt = put(g, B.belt, hub.x - 1, hub.y + 1);
    let levels = 0;
    g.on = (ev) => { if (ev === "level") levels++; };
    for (let i = 0; i < LEVELS[0].need[0][1]; i++) { feed(g, belt, I.iron_ingot); run(g, 0.6); }
    expect(g.level).toBe(2);
    expect(levels).toBe(1);
    expect(g.cores).toBe(1);
    expect(g.stock[I.iron_ingot]).toBe(0);
    expect(g.ach.has("first-delivery")).toBe(true);
    expect(g.unlocked(B.press)).toBe(true);
    expect(g.unlocked(B.assembler)).toBe(false);
  });

  it("keeps spacing on a blocked belt line", () => {
    const g = new Game();
    const hub = g.hubEnt();
    const y = hub.y + 5, x = hub.x - 3;
    for (let i = 0; i < 5; i++) g.place(B.belt, x + i, y, 1);
    const first = g.at(x, y)!;
    for (let k = 0; k < 40; k++) { feed(g, first, I.gear); run(g, 0.1); }
    for (let i = 0; i < 5; i++) expect(g.at(x + i, y)!.n).toBe(2);
    const last = g.at(x + 4, y)!;
    expect(last.ap).toBeCloseTo(0.75);
    expect(last.ap - last.bp).toBeCloseTo(0.5);
  });

  it("splits evenly", () => {
    const g = new Game();
    g.maxLevel = 30;
    const hub = g.hubEnt();
    const x = hub.x - 3, y = hub.y + 6;
    const src = put(g, B.belt, x, y);
    g.place(B.splitter, x + 1, y, 1);
    const a = put(g, B.belt, x + 2, y);
    const up = put(g, B.belt, x + 1, y - 1, 0);
    const down = put(g, B.belt, x + 1, y + 1, 2);
    let fed = 0;
    for (let k = 0; k < 400 && fed < 6; k++) { if (src.n === 0 && feed(g, src, I.gear)) fed++; run(g, 0.05); }
    run(g, 2);
    expect(a.n).toBe(2); expect(up.n).toBe(2); expect(down.n).toBe(2);
  });

  it("melts ice, pipes water and makes hydrogen", () => {
    const g = new Game();
    g.maxLevel = 30;
    claimAround(g);
    const [x, y] = findDeposit(g, 5, 5);
    g.place(B.drill, x, y, 1);
    const melter = put(g, B.melter, x + 1, y);
    expect(melter.recipe).toBe(recipe("water"));
    g.place(B.pipe, x + 2, y, 0);
    g.place(B.pipe, x + 3, y, 0);
    const el = put(g, B.electrolyzer, x + 4, y);
    expect(el.recipe).toBe(recipe("hydrogen"));
    g.place(B.tank, x + 5, y, 0);
    g.tiers.power = 20; (g as any).applyUpgrades();
    run(g, 30);
    const pipe = g.pipeAt(x + 2, y)!;
    expect(pipe.net!.type).toBe(F.water);
    const tank = g.pipeAt(x + 5, y)!;
    expect(tank.net).not.toBe(pipe.net);
    expect(tank.net!.type).toBe(F.hydrogen);
    expect(tank.net!.vol).toBeGreaterThan(50);
    expect(el.nets.length).toBe(2);
    expect(g.ach.has("plumber")).toBe(true);
  });

  it("slows machines down when power is short", () => {
    const g = new Game();
    g.maxLevel = 30;
    const [x, y] = findDeposit(g, 1, 1);
    let drills = 0;
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) if (g.place(B.drill, x + i, y + j, 1)) drills++;
    expect(drills).toBeGreaterThan(10);
    run(g, 1);
    expect(g.demand).toBeGreaterThan(g.supply);
    expect(g.sat).toBeCloseTo(g.supply / g.demand);
  });

  it("throws items from a mass driver to a catcher across open space", () => {
    const g = new Game();
    g.maxLevel = 30;
    const hub = g.hubEnt();
    const x = hub.x - 6, y = hub.y + 4;
    const src = put(g, B.belt, x, y);
    g.place(B.driver, x + 1, y, 1);
    g.place(B.catcher, x + 6, y, 1);
    const out = put(g, B.belt, x + 7, y);
    for (let k = 0; k < 6; k++) { feed(g, src, I.gear); run(g, 0.6); }
    run(g, 3);
    expect(out.n).toBe(2);
    expect(g.shots.length).toBe(0);
    expect(g.ach.has("long-shot")).toBe(true);
  });

  it("builds scaffolds over open space and stores items in crates", () => {
    const g = new Game();
    g.maxLevel = 30;
    claimAround(g, 6);
    let spot: [number, number] | null = null;
    for (let y = -90; y < 90 && !spot; y++) for (let x = -90; x < 90 && !spot; x++) if (!g.world.ground(x, y) && g.isClaimed(x, y)) spot = [x, y];
    expect(spot).toBeTruthy();
    const [sx, sy] = spot!;
    expect(g.canPlace(B.belt, sx, sy)).toBe(false);
    expect(g.place(B.scaffold, sx, sy, 0)).toBe(true);
    expect(g.place(B.belt, sx, sy, 1)).toBeTruthy();
    const hub = g.hubEnt();
    const belt = put(g, B.belt, hub.x - 6, hub.y + 6);
    const crate = put(g, B.crate, hub.x - 5, hub.y + 6);
    for (let k = 0; k < 5; k++) { feed(g, belt, I.gear); run(g, 0.6); }
    expect(crate.n).toBe(5);
    expect(crate.a).toBe(I.gear);
  });

  it("survives a save and load, and pays out offline progress", () => {
    const g = new Game();
    g.maxLevel = 30;
    claimAround(g);
    const [x, y] = findDeposit(g, 1, 4);
    g.place(B.drill, x, y, 1);
    g.place(B.belt, x + 1, y, 1);
    g.place(B.smelter, x + 2, y, 1);
    g.place(B.pipe, x + 1, y + 1, 0);
    g.place(B.tank, x + 2, y + 1, 0);
    const srt = put(g, B.sorter, x + 3, y);
    srt.filter = I.iron_ingot;
    // Something that reaches the hub, so there is a rate to extrapolate.
    const hub = g.hubEnt();
    const belt = put(g, B.belt, hub.x - 1, hub.y + 1);
    for (let k = 0; k < 70; k++) { feed(g, belt, I.gear); run(g, 1); }
    const t0 = 1_000_000;
    const data = JSON.parse(JSON.stringify(g.serialize(t0)));
    const h = Game.load(data, t0 + 3600 * 1000);
    expect(h.ents.length).toBe(g.ents.length);
    expect(h.pipes.length).toBe(2);
    expect(h.at(x + 3, y)!.filter).toBe(I.iron_ingot);
    expect(h.at(x + 2, y)!.recipe).toBe(g.at(x + 2, y)!.recipe);
    expect(h.away).toBeTruthy();
    expect(h.away!.seconds).toBe(3600);
    // About 60 gears a minute at half efficiency for an hour.
    const gears = h.away!.gains.find(([i]) => i === I.gear)![1];
    expect(gears).toBeGreaterThan(1500);
    expect(gears).toBeLessThan(2100);
    run(h, 5);
    // Loading the same save without time passing gives nothing.
    expect(Game.load(data, t0).away).toBeNull();
  });

  it("generates endless levels that keep growing", () => {
    const worth = (l: number) => levelGoal(l).need.reduce((s, [i, n]) => s + n * ITEM_VALUE[i], 0);
    expect(levelGoal(21).need.length).toBeGreaterThanOrEqual(2);
    expect(worth(40)).toBeGreaterThan(worth(25) * 3);
    expect(levelGoal(500).need.every(([, n]) => isFinite(n) && n > 0)).toBe(true);
    expect(JSON.stringify(levelGoal(33))).toBe(JSON.stringify(levelGoal(33)));
  });

  it("buys upgrades without a cap and relocates with beacons", () => {
    const g = new Game();
    g.maxLevel = 30; g.level = 23; g.cores = 1000;
    const before = g.beltSpeed;
    expect(g.buy("belt")).toBe(true);
    expect(g.beltSpeed).toBeGreaterThan(before);
    for (let i = 0; i < 40; i++) g.buy("craft");
    expect(g.tiers.craft).toBeGreaterThan(20);
    expect(trackCost(30)).toBeGreaterThan(trackCost(3));
    for (let i = 0; i < 40; i++) g.buy("belt");
    expect(g.canBuy("belt")).toBe("max");
    expect(g.canRelocate()).toBe(true);
    const h = g.relocate();
    expect(h.beacons).toBe(3);
    expect(h.level).toBe(1);
    expect(h.maxLevel).toBe(30);
    expect(h.world.seed).toBe(1);
    expect(h.ents.length).toBe(1);
    expect(h.unlocked(B.shipyard)).toBe(true);
    expect(h.cores).toBe(0);
    run(h, 1);
  });

  it("launches payloads for cores", () => {
    const g = new Game();
    g.maxLevel = 30;
    const hub = g.hubEnt();
    const pad = put(g, B.pad, hub.x - 6, hub.y + 5, 0);
    for (let i = 0; i < 5; i++) { pad.a = I.satellite; pad.inBuf[0] = 2; run(g, 3); }
    expect(g.launches).toBe(5);
    expect(g.cores).toBe(1);
    expect(g.launchPts).toBe(0);
  });
});
