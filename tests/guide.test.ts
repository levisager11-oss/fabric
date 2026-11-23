import { describe, expect, it } from "vitest";
import { B, I, RECIPES } from "../src/defs";
import { guide } from "../src/guide";
import { Ent, Game } from "../src/sim";

const DT = 1 / 60;
function run(g: Game, seconds: number) {
  for (let i = 0; i < seconds * 60; i++) g.tick(DT);
}
const recipe = (id: string) => RECIPES.findIndex((r) => r.id === id);
const feed = (g: Game, belt: Ent, item: number) => (g as any).beltInsert(belt, item, belt.dir, 0) as boolean;

describe("machines", () => {
  it("an idle smelter fed copper ore switches to copper ingots", () => {
    const g = new Game();
    const hub = g.hubEnt();
    const belt = g.place(B.belt, hub.x - 3, hub.y, 1) as Ent;
    const sm = g.place(B.smelter, hub.x - 2, hub.y, 1) as Ent;
    g.place(B.belt, hub.x - 1, hub.y, 1);
    expect(sm.recipe).toBe(recipe("iron_ingot"));
    for (let i = 0; i < 3; i++) { feed(g, belt, I.copper_ore); run(g, 1); }
    run(g, 6);
    expect(sm.recipe).toBe(recipe("copper_ingot"));
    expect(g.stock[I.copper_ingot]).toBeGreaterThan(0);
    // The next smelter placed still starts on what the player chose last.
    expect(g.lastRecipe[B.smelter]).toBe(recipe("iron_ingot"));
  });

  it("remembers an item a machine cannot use", () => {
    const g = new Game();
    g.maxLevel = 2;
    const hub = g.hubEnt();
    const belt = g.place(B.belt, hub.x - 3, hub.y, 1) as Ent;
    const press = g.place(B.press, hub.x - 2, hub.y, 1) as Ent;
    feed(g, belt, I.copper_ore);
    run(g, 2);
    expect(press.rej).toBe(I.copper_ore);
    expect(belt.n).toBe(1);
  });

  it("turns a drill to feed a belt started next to it", () => {
    const g = new Game();
    let x = 0, y = 0;
    find: for (y = -10; y < 20; y++) for (x = -10; x < 20; x++) {
      if (g.world.deposit(x, y) === 1 && g.canPlace(B.belt, x, y + 1) && g.world.deposit(x, y + 1) === 0) break find;
    }
    const drill = g.place(B.drill, x, y, 1) as Ent;
    // Its output tile, to the east, is empty: starting a belt below turns it south.
    expect(g.faceOutputTo(x, y + 1)).toBe(2);
    expect(drill.dir).toBe(2);
    // Once its output leads somewhere, it is left alone.
    g.place(B.belt, x, y + 1, 2);
    expect(g.faceOutputTo(x - 1, y)).toBe(-1);
    expect(drill.dir).toBe(2);
  });
});

describe("walkthrough", () => {
  it("leads from an empty site to iron ingots in the hub", () => {
    const g = new Game();
    let gd = guide(g)!;
    expect(gd.text).toBe("tut.1");
    expect(gd.b).toBe(B.drill);
    const [mx, my] = gd.marks[0];
    expect(g.world.deposit(mx, my)).toBe(1);
    g.place(B.drill, mx, my, 1);

    gd = guide(g)!;
    expect(gd.text).toBe("tut.2");
    expect(gd.path.length).toBeGreaterThan(1);
    const path = gd.path;
    // The player starts the belt at the path's first tile, then follows it.
    const d = g.faceOutputTo(path[0][0], path[0][1]);
    expect(d).toBeGreaterThanOrEqual(0);
    for (const [x, y, dir] of path) expect(g.place(B.belt, x, y, dir)).toBeTruthy();

    gd = guide(g)!;
    expect(gd.text).toBe("tut.3");
    const [sx, sy] = gd.marks[0];
    const under = g.at(sx, sy)!;
    expect(under.kind).toBe("belt");
    g.place(B.smelter, sx, sy, under.dir);

    gd = guide(g)!;
    expect(gd.text).toBe("tut.4");
    expect(gd.path).toEqual([]);
    run(g, 30);
    expect(g.total[I.iron_ingot]).toBeGreaterThan(0);
    expect(guide(g)!.text).toBe("tut.5");
  });

  it("shows the rest of the way when a belt stops short", () => {
    const g = new Game();
    const [mx, my] = guide(g)!.marks[0];
    g.place(B.drill, mx, my, 1);
    const path = guide(g)!.path;
    g.faceOutputTo(path[0][0], path[0][1]);
    for (const [x, y, dir] of path.slice(0, 2)) g.place(B.belt, x, y, dir);
    const gd = guide(g)!;
    expect(gd.text).toBe("tut.3");
    const rest = gd.path;
    expect(rest.length).toBe(path.length - 2);
    expect(rest[rest.length - 1]).toEqual(path[path.length - 1]);
  });
});
