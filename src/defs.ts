// Static game data: items, fluids, buildings, recipes, levels, upgrades, achievements.
// Indices are stored in saves: only ever append to these lists, never reorder.

export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const opp = (d: number) => (d + 2) & 3;

export const GAME_TITLE = "Fabric";

// ---------- Items ----------
export const I = {
  iron_ore: 0, copper_ore: 1, silica: 2, carbon: 3, ice: 4, lumen: 5,
  iron_ingot: 6, copper_ingot: 7, glass: 8, silicon: 9, steel: 10,
  gear: 11, wire: 12, beam: 13, lens: 14,
  circuit: 15, motor: 16, hull: 17, laser: 18, processor: 19, cell: 20, canister: 21,
  thruster: 22, nav: 23, probe: 24,
  regolith: 25, titanium_ore: 26, uranium_ore: 27, brick: 28, titanium: 29, plate: 30, coil: 31,
  frame: 32, sensor: 33, fuel_rod: 34, shield: 35, actuator: 36, computer: 37, drone: 38,
  quantum: 39, engine: 40, satellite: 41, module: 42,
} as const;

export const ITEM_IDS: string[] = Object.keys(I);
export const ITEM_COUNT = ITEM_IDS.length;

// ---------- Fluids ----------
export const F = { water: 0, hydrogen: 1, propellant: 2, helium: 3, oxygen: 4, coolant: 5 } as const;
export const FLUID_IDS: string[] = Object.keys(F);
export const FLUID_COUNT = FLUID_IDS.length;

// ---------- Deposits (terrain overlay) ----------
// 0 none, 1 iron, 2 copper, 3 silica, 4 carbon, 5 ice, 6 lumen, 7 helium vent, 8 titanium, 9 uranium
export const DEPOSIT_ITEM = [-1, I.iron_ore, I.copper_ore, I.silica, I.carbon, I.ice, I.lumen, -1, I.titanium_ore, I.uranium_ore];
export const DEP_VENT = 7;

// ---------- Buildings ----------
export type Kind =
  | "belt" | "cross" | "splitter" | "sorter" | "drill" | "crafter" | "hub" | "pad"
  | "solar" | "burner" | "turbine" | "fusion" | "well" | "pipe" | "tank"
  | "crate" | "driver" | "catcher" | "trash" | "scoop" | "reactor" | "lamp" | "floor";
export type Cat = "logi" | "mine" | "prod" | "fluid" | "power";

export interface BuildDef {
  id: string;
  kind: Kind;
  size: number;      // square footprint
  cat: Cat | null;   // null: not in the build menu (hub)
  power: number;     // kW demand while working; for generators: kW produced
  unlock: number;    // level that must be reached before it can be built (1 = from the start)
  drag: boolean;     // dragging places one per tile
  light: number;     // 0 none, otherwise index into the renderer's light colours
}

export const B = {
  belt: 0, cross: 1, splitter: 2, sorter: 3, drill: 4, smelter: 5, press: 6, assembler: 7,
  manufacturer: 8, melter: 9, electrolyzer: 10, refinery: 11, pipe: 12, tank: 13, well: 14,
  solar: 15, burner: 16, turbine: 17, fusion: 18, hub: 19, pad: 20,
  arc: 21, wiremill: 22, etcher: 23, photonics: 24, kiln: 25, centrifuge: 26, shipyard: 27, cryo: 28,
  heavy: 29, scoop: 30, crate: 31, driver: 32, catcher: 33, trash: 34, scaffold: 35, reactor: 36, lamp: 37,
} as const;

// light: 1 warm, 2 cold, 3 fire, 4 green, 5 pink
export const BUILDINGS: BuildDef[] = [
  { id: "belt", kind: "belt", size: 1, cat: "logi", power: 0, unlock: 1, drag: true, light: 0 },
  { id: "cross", kind: "cross", size: 1, cat: "logi", power: 0, unlock: 4, drag: false, light: 0 },
  { id: "splitter", kind: "splitter", size: 1, cat: "logi", power: 0, unlock: 2, drag: false, light: 0 },
  { id: "sorter", kind: "sorter", size: 1, cat: "logi", power: 0, unlock: 5, drag: false, light: 0 },
  { id: "drill", kind: "drill", size: 1, cat: "mine", power: 10, unlock: 1, drag: true, light: 0 },
  { id: "smelter", kind: "crafter", size: 1, cat: "prod", power: 20, unlock: 1, drag: false, light: 3 },
  { id: "press", kind: "crafter", size: 1, cat: "prod", power: 20, unlock: 2, drag: false, light: 0 },
  { id: "assembler", kind: "crafter", size: 1, cat: "prod", power: 40, unlock: 4, drag: false, light: 1 },
  { id: "manufacturer", kind: "crafter", size: 1, cat: "prod", power: 100, unlock: 15, drag: false, light: 5 },
  { id: "melter", kind: "crafter", size: 1, cat: "fluid", power: 30, unlock: 11, drag: false, light: 2 },
  { id: "electrolyzer", kind: "crafter", size: 1, cat: "fluid", power: 80, unlock: 11, drag: false, light: 2 },
  { id: "refinery", kind: "crafter", size: 1, cat: "fluid", power: 60, unlock: 13, drag: false, light: 3 },
  { id: "pipe", kind: "pipe", size: 1, cat: "fluid", power: 0, unlock: 11, drag: true, light: 0 },
  { id: "tank", kind: "tank", size: 1, cat: "fluid", power: 0, unlock: 11, drag: false, light: 0 },
  { id: "well", kind: "well", size: 1, cat: "mine", power: 50, unlock: 19, drag: false, light: 4 },
  { id: "solar", kind: "solar", size: 2, cat: "power", power: 40, unlock: 3, drag: true, light: 0 },
  { id: "burner", kind: "burner", size: 1, cat: "power", power: 150, unlock: 6, drag: false, light: 3 },
  { id: "turbine", kind: "turbine", size: 1, cat: "power", power: 600, unlock: 13, drag: false, light: 2 },
  { id: "fusion", kind: "fusion", size: 2, cat: "power", power: 8000, unlock: 19, drag: false, light: 4 },
  { id: "hub", kind: "hub", size: 3, cat: null, power: 100, unlock: 1, drag: false, light: 1 },
  { id: "pad", kind: "pad", size: 3, cat: "prod", power: 0, unlock: 18, drag: false, light: 1 },
  { id: "arc", kind: "crafter", size: 1, cat: "prod", power: 60, unlock: 6, drag: false, light: 2 },
  { id: "wiremill", kind: "crafter", size: 1, cat: "prod", power: 20, unlock: 3, drag: false, light: 0 },
  { id: "etcher", kind: "crafter", size: 1, cat: "prod", power: 60, unlock: 7, drag: false, light: 4 },
  { id: "photonics", kind: "crafter", size: 1, cat: "prod", power: 60, unlock: 12, drag: false, light: 5 },
  { id: "kiln", kind: "crafter", size: 1, cat: "prod", power: 40, unlock: 14, drag: false, light: 3 },
  { id: "centrifuge", kind: "crafter", size: 1, cat: "prod", power: 150, unlock: 17, drag: false, light: 4 },
  { id: "shipyard", kind: "crafter", size: 2, cat: "prod", power: 300, unlock: 18, drag: false, light: 1 },
  { id: "cryo", kind: "crafter", size: 1, cat: "fluid", power: 80, unlock: 16, drag: false, light: 2 },
  { id: "heavy", kind: "drill", size: 2, cat: "mine", power: 50, unlock: 9, drag: false, light: 0 },
  { id: "scoop", kind: "scoop", size: 1, cat: "mine", power: 15, unlock: 9, drag: true, light: 0 },
  { id: "crate", kind: "crate", size: 1, cat: "logi", power: 0, unlock: 5, drag: false, light: 0 },
  { id: "driver", kind: "driver", size: 1, cat: "logi", power: 0, unlock: 10, drag: false, light: 0 },
  { id: "catcher", kind: "catcher", size: 1, cat: "logi", power: 0, unlock: 10, drag: false, light: 0 },
  { id: "trash", kind: "trash", size: 1, cat: "logi", power: 0, unlock: 8, drag: false, light: 0 },
  { id: "scaffold", kind: "floor", size: 1, cat: "logi", power: 0, unlock: 10, drag: true, light: 0 },
  { id: "reactor", kind: "reactor", size: 2, cat: "power", power: 2500, unlock: 17, drag: false, light: 2 },
  { id: "lamp", kind: "lamp", size: 1, cat: "power", power: 0, unlock: 3, drag: false, light: 1 },
];

export const CATS: Cat[] = ["logi", "mine", "prod", "fluid", "power"];

export const PIPE_CAP = 100;
export const TANK_CAP = 4000;
export const HUB_POWER = 100;
export const BURNER_SECONDS = 8;      // one carbon burns this long at full load
export const ROD_SECONDS = 60;        // one fuel rod
export const TURBINE_RATE = 8;        // hydrogen per second at full load
export const REACTOR_COOLANT = 4;     // coolant per second at full load
export const FUSION_RATE = 4;         // helium-3 per second at full load
export const WELL_RATE = 12;          // helium-3 per second
export const PAD_CANISTERS = 2;
export const PAD_LAUNCH_TIME = 2.5;
export const PAD_POINTS: Record<number, number> = { [I.probe]: 1, [I.satellite]: 4, [I.module]: 12 };
export const LAUNCH_POINTS_PER_CORE = 20;
export const CRATE_CAP = 200;
export const DRIVER_RANGE = 9;

// ---------- Recipes ----------
export interface Recipe {
  id: string;
  machine: number;                 // building index
  inp: [number, number][];         // [item, count]
  fin: [number, number][];         // [fluid, amount]
  out?: [number, number];
  fout?: [number, number];
  time: number;                    // seconds
  unlock: number;                  // level
}

const R = (id: string, machine: number, unlock: number, time: number, inp: [number, number][], out: [number, number] | null,
  fin: [number, number][] = [], fout?: [number, number]): Recipe =>
  ({ id, machine, unlock, time, inp, fin, out: out ?? undefined, fout });

export const RECIPES: Recipe[] = [
  R("iron_ingot", B.smelter, 1, 2, [[I.iron_ore, 1]], [I.iron_ingot, 1]),
  R("copper_ingot", B.smelter, 1, 2, [[I.copper_ore, 1]], [I.copper_ingot, 1]),
  R("glass", B.smelter, 5, 3, [[I.silica, 2]], [I.glass, 1]),
  R("brick", B.smelter, 9, 3, [[I.regolith, 2]], [I.brick, 1]),
  R("steel", B.arc, 6, 4, [[I.iron_ingot, 2], [I.carbon, 1]], [I.steel, 1]),
  R("silicon", B.arc, 6, 4, [[I.silica, 2], [I.carbon, 1]], [I.silicon, 1]),
  R("titanium", B.arc, 14, 5, [[I.titanium_ore, 2], [I.carbon, 1]], [I.titanium, 1]),
  R("gear", B.press, 2, 2, [[I.iron_ingot, 2]], [I.gear, 1]),
  R("plate", B.press, 2, 1.5, [[I.iron_ingot, 1]], [I.plate, 1]),
  R("beam", B.press, 7, 3, [[I.steel, 2]], [I.beam, 1]),
  R("lens", B.press, 7, 3, [[I.glass, 2]], [I.lens, 1]),
  R("wire", B.wiremill, 3, 2, [[I.copper_ingot, 1]], [I.wire, 2]),
  R("coil", B.wiremill, 8, 3, [[I.wire, 3]], [I.coil, 1]),
  R("motor", B.assembler, 4, 3, [[I.gear, 1], [I.wire, 2]], [I.motor, 1]),
  R("frame", B.assembler, 8, 4, [[I.beam, 1], [I.plate, 2]], [I.frame, 1]),
  R("canister", B.assembler, 13, 3, [[I.steel, 1]], [I.canister, 1], [[F.propellant, 40]]),
  R("hull", B.assembler, 14, 5, [[I.frame, 1], [I.titanium, 2]], [I.hull, 1]),
  R("circuit", B.etcher, 7, 3, [[I.wire, 2], [I.silicon, 1]], [I.circuit, 1]),
  R("processor", B.etcher, 11, 5, [[I.circuit, 2], [I.silicon, 1]], [I.processor, 1], [[F.water, 20]]),
  R("sensor", B.etcher, 12, 4, [[I.lens, 1], [I.circuit, 1]], [I.sensor, 1]),
  R("quantum", B.etcher, 16, 8, [[I.processor, 1], [I.lumen, 2]], [I.quantum, 1], [[F.coolant, 20]]),
  R("laser", B.photonics, 12, 4, [[I.lens, 1], [I.lumen, 2]], [I.laser, 1]),
  R("cell", B.photonics, 12, 4, [[I.lumen, 2], [I.coil, 1], [I.glass, 1]], [I.cell, 1]),
  R("shield", B.kiln, 14, 5, [[I.brick, 2], [I.titanium, 1]], [I.shield, 1]),
  R("thruster", B.manufacturer, 15, 8, [[I.motor, 1], [I.hull, 2], [I.canister, 1]], [I.thruster, 1]),
  R("nav", B.manufacturer, 15, 8, [[I.processor, 1], [I.laser, 1], [I.sensor, 1]], [I.nav, 1]),
  R("actuator", B.manufacturer, 15, 6, [[I.motor, 1], [I.frame, 1], [I.coil, 1]], [I.actuator, 1]),
  R("computer", B.manufacturer, 16, 8, [[I.processor, 2], [I.frame, 1]], [I.computer, 1], [[F.coolant, 20]]),
  R("drone", B.manufacturer, 18, 8, [[I.motor, 1], [I.cell, 1], [I.sensor, 1]], [I.drone, 1]),
  R("fuel_rod", B.centrifuge, 17, 6, [[I.uranium_ore, 2], [I.steel, 1]], [I.fuel_rod, 1]),
  R("probe", B.shipyard, 18, 12, [[I.thruster, 1], [I.nav, 1], [I.cell, 2]], [I.probe, 1]),
  R("engine", B.shipyard, 19, 15, [[I.thruster, 2], [I.shield, 1], [I.fuel_rod, 1]], [I.engine, 1]),
  R("satellite", B.shipyard, 19, 15, [[I.computer, 1], [I.sensor, 2], [I.cell, 2], [I.actuator, 1]], [I.satellite, 1]),
  R("module", B.shipyard, 20, 20, [[I.hull, 2], [I.computer, 1], [I.quantum, 1], [I.engine, 1]], [I.module, 1]),
  R("water", B.melter, 11, 2, [[I.ice, 1]], null, [], [F.water, 30]),
  R("hydrogen", B.electrolyzer, 11, 2, [], null, [[F.water, 30]], [F.hydrogen, 20]),
  R("oxygen", B.electrolyzer, 11, 2, [], null, [[F.water, 30]], [F.oxygen, 20]),
  R("propellant", B.refinery, 13, 3, [], null, [[F.hydrogen, 20], [F.oxygen, 10]], [F.propellant, 20]),
  R("coolant", B.cryo, 16, 3, [], null, [[F.water, 30], [F.hydrogen, 10]], [F.coolant, 30]),
];

export const RECIPES_BY_MACHINE: number[][] = BUILDINGS.map((_, bi) =>
  RECIPES.map((r, ri) => (r.machine === bi ? ri : -1)).filter((ri) => ri >= 0),
);

// What an item is worth: its raw materials plus the work put in. Drives generated goals and the output score.
export const ITEM_VALUE: number[] = new Array(ITEM_COUNT).fill(1);
export const FLUID_VALUE: number[] = new Array(FLUID_COUNT).fill(0.05);
(function computeValues() {
  for (let pass = 0; pass < 8; pass++) {
    for (const r of RECIPES) {
      let v = r.time * 0.25;
      for (const [i, n] of r.inp) v += ITEM_VALUE[i] * n;
      for (const [f, n] of r.fin) v += FLUID_VALUE[f] * n;
      if (r.out) ITEM_VALUE[r.out[0]] = v / r.out[1];
      else if (r.fout) FLUID_VALUE[r.fout[0]] = v / r.fout[1];
    }
  }
})();

// ---------- Levels ----------
export interface LevelGoal { need: [number, number][] }

/** Hand-made levels: index 0 is level 1. Completing level n unlocks everything with unlock = n + 1. */
export const LEVELS: LevelGoal[] = [
  { need: [[I.iron_ingot, 30]] },
  { need: [[I.gear, 40], [I.copper_ingot, 40]] },
  { need: [[I.wire, 60], [I.plate, 40]] },
  { need: [[I.motor, 40]] },
  { need: [[I.glass, 60], [I.plate, 60]] },
  { need: [[I.steel, 60], [I.silicon, 40]] },
  { need: [[I.circuit, 60], [I.beam, 40]] },
  { need: [[I.frame, 40], [I.lens, 40], [I.coil, 40]] },
  { need: [[I.brick, 80], [I.motor, 60]] },
  { need: [[I.circuit, 100], [I.frame, 60]] },
  { need: [[I.processor, 40]] },
  { need: [[I.laser, 40], [I.cell, 40], [I.sensor, 40]] },
  { need: [[I.canister, 60]] },
  { need: [[I.hull, 40], [I.shield, 40]] },
  { need: [[I.thruster, 30], [I.nav, 30], [I.actuator, 30]] },
  { need: [[I.computer, 30], [I.quantum, 30]] },
  { need: [[I.fuel_rod, 40], [I.computer, 40]] },
  { need: [[I.probe, 20], [I.drone, 30]] },
  { need: [[I.engine, 20], [I.satellite, 20]] },
  { need: [[I.module, 20]] },
];

// Goods the endless levels ask for.
const GOAL_POOL = [
  I.motor, I.frame, I.circuit, I.processor, I.laser, I.cell, I.sensor, I.canister, I.hull, I.shield, I.thruster, I.nav,
  I.actuator, I.computer, I.quantum, I.fuel_rod, I.drone, I.probe, I.engine, I.satellite, I.module,
];

function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** The goal of a level (1-based). Levels beyond the hand-made ones are generated and grow forever. */
export function levelGoal(level: number): LevelGoal {
  if (level <= LEVELS.length) return LEVELS[level - 1];
  const k = level - LEVELS.length;
  const budget = 6000 * Math.pow(1.16, k);
  const count = 2 + (k % 3 === 0 ? 1 : 0);
  const need: [number, number][] = [];
  for (let j = 0; j < count; j++) {
    let item = GOAL_POOL[Math.floor(hash2(level, j) * GOAL_POOL.length)];
    while (need.some((n) => n[0] === item)) item = GOAL_POOL[(GOAL_POOL.indexOf(item) + 1) % GOAL_POOL.length];
    const amount = Math.max(10, Math.round(budget / count / ITEM_VALUE[item] / 10) * 10);
    need.push([item, amount]);
  }
  return { need };
}

/** Cores paid for completing a level. */
export const levelCores = (level: number) => 1 + Math.floor(level / 10);

export const UNLOCK_UPGRADES = 3;
export const UNLOCK_CLAIMS = 5;
export const UNLOCK_RELOCATE = 15;

// ---------- Upgrades: every track goes on forever (belts stop where the simulation does) ----------
export type Track = "belt" | "drill" | "craft" | "power" | "value" | "offline";
export const TRACKS: Track[] = ["belt", "drill", "craft", "power", "value", "offline"];
export const TRACK_MAX: Partial<Record<Track, number>> = { belt: 20, offline: 22 };

export function trackValue(track: Track, tier: number): number {
  switch (track) {
    case "belt": return 2 + 0.5 * tier;            // tiles per second
    case "drill": return 1 + 0.25 * tier;
    case "craft": return 1 + 0.2 * tier;
    case "power": return 1 + 0.25 * tier;
    case "value": return 1 + 0.1 * tier;           // each delivery counts for this much
    case "offline": return 2 + tier;               // hours
  }
}
export const trackCost = (tier: number) => 1 + Math.floor(tier * 0.75);

/** Beacons earned by relocating at this level. Each one speeds up all production for good. */
export const beaconsFor = (level: number) => (level < UNLOCK_RELOCATE ? 0 : 1 + Math.floor((level - UNLOCK_RELOCATE) / 4));
export const BEACON_BONUS = 0.15;
export const OFFLINE_EFFICIENCY = 0.5;

export function claimCost(n: number): [number, number][] {
  const amt = (base: number) => Math.round((base * Math.pow(1 + n, 1.15)) / 5) * 5;
  if (n < 3) return [[I.iron_ingot, amt(30)]];
  if (n < 7) return [[I.gear, amt(10)], [I.plate, amt(12)]];
  if (n < 12) return [[I.steel, amt(8)], [I.motor, amt(5)]];
  if (n < 20) return [[I.circuit, amt(5)], [I.frame, amt(4)]];
  return [[I.processor, amt(2.5)], [I.hull, amt(2)]];
}

// ---------- Achievements (ids as in toki.json) ----------
export const ACHIEVEMENTS = [
  "first-delivery", "belt-100", "sunlight", "upgrade-1", "claim-1", "claim-10", "plumber",
  "level-10", "megawatt", "fusion", "first-launch", "level-20", "launch-100",
  "level-30", "level-50", "relocate", "long-shot", "critical", "builder-500", "output-1k",
] as const;
export type AchievementId = (typeof ACHIEVEMENTS)[number];
