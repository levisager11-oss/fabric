// Pixel art, drawn in code from a fixed palette: 16 art pixels per tile, items are 8x8.
import { B, BUILDINGS, FLUID_COUNT, I, ITEM_COUNT, RECIPES } from "./defs";
import { CH, Chunk, hash, noise } from "./world";

export const T = 16;
export const IT = 8;
export const BELT_FRAMES = 4;
export const BUILD_FRAMES = 3; // 0 idle, 1 and 2 alternate while working

// One character per colour. '.' is transparent.
const PAL: Record<string, string> = {
  "0": "#0b0c14", "1": "#1a1c2c", "2": "#2b2e44", "3": "#414664", "4": "#5f6b8a", "5": "#8b9bb4", "6": "#c0cbdc", "7": "#f4f4e6",
  a: "#3e2731", b: "#733e39", c: "#b86f50", d: "#e8a05c", e: "#f77622", f: "#feae34", g: "#fee761", h: "#a22633", i: "#e43b44",
  j: "#265c42", k: "#3e8948", l: "#63c74d", m: "#124e89", n: "#0099db", o: "#2ce8f5", p: "#68386c", q: "#b55088", r: "#f6757a",
  s: "#5a6988", t: "#3a4466", u: "#262b44", v: "#181425", w: "#ffffff", y: "#c9a37a", z: "#ead4aa",
  A: "#2a1b22", B: "#4b3039", C: "#5c3a41", D: "#6f4a4d", T: "#9a8fd0",
};
const RGB: Record<string, [number, number, number]> = {};
for (const k in PAL) RGB[k] = [parseInt(PAL[k].slice(1, 3), 16), parseInt(PAL[k].slice(3, 5), 16), parseInt(PAL[k].slice(5, 7), 16)];
export const color = (ch: string) => PAL[ch];

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** A small pixel buffer of palette characters. */
class Px {
  d: string[];
  constructor(public w: number, public h: number) { this.d = new Array(w * h).fill("."); }
  set(x: number, y: number, c: string): void {
    if (c !== "." && x >= 0 && y >= 0 && x < this.w && y < this.h) this.d[y * this.w + x] = c === " " ? "." : c;
  }
  rect(x: number, y: number, w: number, h: number, c: string): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  box(x: number, y: number, w: number, h: number, c: string): void {
    for (let i = 0; i < w; i++) { this.set(x + i, y, c); this.set(x + i, y + h - 1, c); }
    for (let j = 0; j < h; j++) { this.set(x, y + j, c); this.set(x + w - 1, y + j, c); }
  }
  disc(cx: number, cy: number, r: number, c: string): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.set(x, y, c);
    }
  }
  ring(cx: number, cy: number, r: number, c: string, w = 1): void {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r && d > r - w) this.set(x, y, c);
    }
  }
  /** Rows of palette characters, separated by whitespace. */
  glyph(x: number, y: number, rows: string, map?: Record<string, string>): void {
    rows.trim().split(/\s+/).forEach((row, j) => {
      for (let i = 0; i < row.length; i++) { const ch = row[i]; this.set(x + i, y + j, map ? map[ch] ?? ch : ch); }
    });
  }
  blit(src: Px, x: number, y: number): void {
    for (let j = 0; j < src.h; j++) for (let i = 0; i < src.w; i++) this.set(x + i, y + j, src.d[j * src.w + i]);
  }
  /** Quarter turns clockwise (square buffers). */
  rot(k: number): Px {
    let p: Px = this;
    for (let n = 0; n < (k & 3); n++) {
      const q = new Px(p.h, p.w);
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) q.d[x * q.w + (q.w - 1 - y)] = p.d[y * p.w + x];
      p = q;
    }
    return p;
  }
  flipX(): Px {
    const q = new Px(this.w, this.h);
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) q.d[y * this.w + (this.w - 1 - x)] = this.d[y * this.w + x];
    return q;
  }
  toCanvas(): HTMLCanvasElement {
    const cv = makeCanvas(this.w, this.h);
    const ctx = cv.getContext("2d")!;
    const img = ctx.createImageData(this.w, this.h);
    for (let i = 0; i < this.d.length; i++) {
      const c = RGB[this.d[i]];
      if (!c) continue;
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }
}

// ---------- Items ----------
const ORE = "........ ..LL.... .LMMD.L. .MMDDLLM ..DD.LMD .LL..MDD LMMD.DD. .DD.....";
const INGOT = "........ ........ .LLLLLL. LLLLLLLM MMMMMMMD MMMMMMDD .DDDDDD. ........";
const DROP = "...L.... ..LM.... ..LMM... .LMMMD.. .LMMMD.. .MMMDD.. ..MDD... ........";
const tri = (L: string, M: string, D: string) => ({ L, M, D });

const ITEM_ART: [string, Record<string, string>?][] = [];
ITEM_ART[I.iron_ore] = [ORE, tri("6", "5", "4")];
ITEM_ART[I.copper_ore] = [ORE, tri("d", "c", "b")];
ITEM_ART[I.silica] = [ORE, tri("7", "z", "y")];
ITEM_ART[I.carbon] = [ORE, tri("5", "3", "1")];
ITEM_ART[I.ice] = [ORE, tri("7", "o", "n")];
ITEM_ART[I.titanium_ore] = [ORE, tri("7", "T", "p")];
ITEM_ART[I.uranium_ore] = [ORE, tri("g", "l", "j")];
ITEM_ART[I.lumen] = ["...r.... ..rqr... ..rqq.r. .rqqprqr .rqqprqp .qqpp.qp ..pp..p. ........"];
ITEM_ART[I.regolith] = ["........ ........ ...cc... ..cbbc.. .cbbcbb. cbbabbba bbabbaba .aaaaaa."];
ITEM_ART[I.iron_ingot] = [INGOT, tri("7", "6", "5")];
ITEM_ART[I.copper_ingot] = [INGOT, tri("d", "c", "b")];
ITEM_ART[I.steel] = [INGOT, tri("5", "s", "t")];
ITEM_ART[I.titanium] = [INGOT, tri("7", "T", "p")];
ITEM_ART[I.glass] = ["........ .777776. .7o6666. .76o666. .666o66. .6666o5. .655555. ........"];
ITEM_ART[I.silicon] = ["..3333.. .34T433. 34T44432 3T444432 34444322 33443222 .332222. ..2222.."];
ITEM_ART[I.brick] = ["........ .cccccc. cdcccccb ccccbccb bbbbbbba cccbcccb ccccccba .bbbbba."];
ITEM_ART[I.gear] = [".6.66.6. 66666665 .66..65. 66....65 66....55 .66..55. 66655555 .6.55.5."];
ITEM_ART[I.wire] = ["..dddd.. .dccccd. dc.dd.cb dcd..dcb dcd..dcb dc.dd.cb .cccccb. ..bbbb.."];
ITEM_ART[I.plate] = ["........ ........ 77666666 76666665 66566565 66666655 55555554 ........"];
ITEM_ART[I.coil] = ["..5555.. .dcdcdc. .cdcdcd. .dcdcdc. .cdcdcd. .dcdcdc. .cbcbcb. ..4444.."];
ITEM_ART[I.beam] = ["........ .555555. .5ssss5. ...5s... ...5s... .5ssss5. .ssssst. ........"];
ITEM_ART[I.lens] = ["..oooo.. .o7ooon. o77oooon o7oooonn oooooonn ooooonnn .oonnnn. ..nnnn.."];
ITEM_ART[I.circuit] = ["........ .kkkkkk. klkgkklk kkkgkkkk kggg.2kk kkkk22kj kjkkkkjj .jjjjjj."];
ITEM_ART[I.motor] = ["........ .5555... 566c5566 566c5.66 544c4.66 544c4466 .4444... ........"];
ITEM_ART[I.frame] = ["55555555 5s....s5 5.s..s.5 5..ss..4 5..ss..4 5.s..s.4 5s....s4 54444444"];
ITEM_ART[I.sensor] = ["........ .kkkkkk. kk0oo0kk k0o7oo0k k0oooo0j kk0oo0jj .kjjjjj. ........"];
ITEM_ART[I.hull] = [".666666. 67777776 67677676 67777776 66666665 65666565 65555555 .555555."];
ITEM_ART[I.laser] = ["......ii .....ir. .333i7.. 3443i... 34433... 33433... .333.... ........"];
ITEM_ART[I.processor] = [".f.f.f.. f222222f .2oooo2. f2o77o2f .2o77o2. f2oooo2f .222222. .f.f.f.."];
ITEM_ART[I.cell] = ["..5665.. .222222. .2rrrr2. .2rqqr2. .2qqqq2. .2qppq2. .222222. ........"];
ITEM_ART[I.canister] = ["..5665.. ..4554.. .eeeeee. .efeeeb. .000000. .eeeeeb. .eebbbb. ..bbbb.."];
ITEM_ART[I.thruster] = ["..5665.. ..5445.. .556444. .564443. 56644433 .gfffe.. ..gfe... ...f...."];
ITEM_ART[I.nav] = ["..oooo.. .o....o. o..nn..o o.n77n.o o.n77n.n o..nn..n .o....n. ..onnn.."];
ITEM_ART[I.probe] = ["...7.... ...5.... nn.ff.nn mnfggfnm mnfgffnm nn.ff.nn ...ee... ........"];
ITEM_ART[I.fuel_rod] = ["..5555.. ..4444.. ..2ll2.. ..2gl2.. ..2ll2.. ..2lk2.. ..4444.. ..5555.."];
ITEM_ART[I.shield] = ["..2222.. .233332. 23333332 23344332 e3344332 ee33332b .ee222b. ..eebb.."];
ITEM_ART[I.actuator] = ["....55.. ...5445. ..54.55. .54..... 54...ff. 54..f..f 4444.... 4444...."];
ITEM_ART[I.computer] = ["55555555 52222224 52oo.o24 52o.oo24 52222224 54444444 .3f3l33. .333333."];
ITEM_ART[I.drone] = ["66....66 6.5..5.6 ..5445.. ..4ii4.. ..4444.. ..5445.. 6.5..5.6 66....66"];
ITEM_ART[I.quantum] = [".o.o.o.. o111111o .1qrrq1. o1r77r1o .1r77r1. o1qrrq1o .111111. .o.o.o.."];
ITEM_ART[I.engine] = [".555555. .544443. ..5443.. .554433. 55444333 .o7oo7o. ..o77o.. ...oo..."];
ITEM_ART[I.satellite] = ["......77 .....76. nn..66.. mn.666.7 mn5665.. nn.55... ..5..5.. .5....5."];
ITEM_ART[I.module] = [".666666. 67777776 67o77o76 67777776 66666665 6f6556f5 65555554 .544445."];

// Light, mid, dark per fluid: water, hydrogen, propellant, helium-3, oxygen, coolant
const FLUID_TRI = [tri("o", "n", "m"), tri("7", "6", "5"), tri("g", "e", "b"), tri("g", "l", "k"), tri("7", "o", "s"), tri("7", "T", "p")];
export const FLUID_COLORS = FLUID_TRI.map((t) => PAL[t.M]);
export const ITEM_COLORS: string[] = [];

function itemPx(i: number): Px {
  const p = new Px(IT, IT);
  const art = ITEM_ART[i];
  if (art) p.glyph(0, 0, art[0], art[1]);
  else p.rect(2, 2, 4, 4, "i");
  return p;
}

// ---------- Belts ----------
/** Belt tile moving north. shape 0 straight, 1 entering from the west, 2 from the east. */
function beltPx(shape: number, frame: number): Px {
  const p = new Px(T, T);
  if (shape === 0) {
    p.rect(1, 0, 14, T, "2");
    for (let y = 0; y < T; y++) {
      if (((y + frame) & 3) === 0) p.rect(3, y, 10, 1, "3");
      if (((y + frame) & 7) === 2) { p.set(7, y, "4"); p.set(8, y, "4"); p.set(6, y + 1, "4"); p.set(9, y + 1, "4"); }
    }
    p.rect(1, 0, 1, T, "0"); p.rect(14, 0, 1, T, "0");
    p.rect(2, 0, 1, T, "5"); p.rect(13, 0, 1, T, "4");
    return p;
  }
  // Corner: in from the west, out to the north.
  p.rect(0, 1, 15, 14, "2");
  p.rect(1, 0, 14, 2, "2");
  for (let y = 0; y < 13; y++) for (let x = 0; x < 13; x++) {
    if (x < 3 && y < 3) continue;
    if (((x - y + frame) & 3) === 0) p.set(x, y, "3");
  }
  p.rect(14, 0, 1, 15, "0"); p.rect(13, 0, 1, 14, "4");
  p.rect(0, 14, 15, 1, "0"); p.rect(0, 13, 14, 1, "4");
  p.rect(0, 0, 2, 2, "0"); p.rect(2, 0, 1, 2, "5"); p.rect(0, 2, 3, 1, "5");
  return shape === 2 ? p.flipX() : p;
}

// ---------- Buildings ----------
interface Casing { top: string; hi: string; face: string; lo: string }
const STEEL: Casing = { top: "3", hi: "4", face: "2", lo: "1" };
const DARK: Casing = { top: "2", hi: "3", face: "u", lo: "1" };

/** A machine body seen from above and slightly from the front: a top surface and a front face. */
function casing(p: Px, x: number, y: number, w: number, h: number, c: Casing = STEEL, faceH = 3): void {
  p.rect(x, y, w, h, "0");
  p.rect(x + 1, y + 1, w - 2, h - faceH - 2, c.top);
  p.rect(x + 1, y + 1, w - 2, 1, c.hi);
  p.rect(x + 1, y + 1, 1, h - faceH - 2, c.hi);
  p.rect(x + 1, y + h - faceH - 1, w - 2, faceH, c.face);
  p.rect(x + 1, y + h - faceH - 1, w - 2, 1, c.lo);
  for (const [cx, cy] of [[x, y], [x + w - 1, y], [x, y + h - 1], [x + w - 1, y + h - 1]]) p.set(cx, cy, " ");
}

/** Amber notch on the side a building hands its output to. */
function port(p: Px, size: number, dir: number): void {
  const n = size * T, a = 6;
  if (dir === 0) { p.rect(a, 0, 4, 2, "f"); p.rect(a + 1, 0, 2, 1, "g"); }
  else if (dir === 1) { p.rect(n - 2, a, 2, 4, "f"); p.rect(n - 1, a + 1, 1, 2, "g"); }
  else if (dir === 2) { p.rect(n - a - 4, n - 2, 4, 2, "f"); p.rect(n - a - 3, n - 1, 2, 1, "g"); }
  else { p.rect(0, n - a - 4, 2, 4, "f"); p.rect(0, n - a - 3, 1, 2, "g"); }
}

interface Style { trim: string; hi: string; face: "fire" | "spark" | "bars" | "spool" | "lights" | "liquid" | "stripes"; glow: string[]; extra?: string }
const CRAFTERS: Record<number, Style> = {
  [B.smelter]: { trim: "e", hi: "f", face: "fire", glow: ["e", "f", "g"], extra: "chimney" },
  [B.arc]: { trim: "n", hi: "o", face: "spark", glow: ["n", "o", "7"] },
  [B.press]: { trim: "5", hi: "6", face: "bars", glow: ["5", "6", "7"] },
  [B.wiremill]: { trim: "c", hi: "d", face: "spool", glow: ["c", "d", "b"] },
  [B.assembler]: { trim: "k", hi: "l", face: "lights", glow: ["l", "g", "k"] },
  [B.etcher]: { trim: "j", hi: "l", face: "liquid", glow: ["l", "k", "j"] },
  [B.photonics]: { trim: "q", hi: "r", face: "lights", glow: ["r", "7", "q"] },
  [B.kiln]: { trim: "b", hi: "c", face: "fire", glow: ["h", "i", "e"], extra: "chimney" },
  [B.manufacturer]: { trim: "p", hi: "q", face: "lights", glow: ["q", "r", "f"], extra: "rivets" },
  [B.centrifuge]: { trim: "g", hi: "7", face: "stripes", glow: ["g", "l", "7"] },
  [B.melter]: { trim: "n", hi: "o", face: "liquid", glow: ["o", "n", "m"] },
  [B.electrolyzer]: { trim: "6", hi: "7", face: "spark", glow: ["7", "o", "6"] },
  [B.refinery]: { trim: "e", hi: "g", face: "liquid", glow: ["e", "f", "b"], extra: "chimney" },
  [B.cryo]: { trim: "T", hi: "7", face: "liquid", glow: ["T", "7", "p"] },
  [B.shipyard]: { trim: "f", hi: "g", face: "lights", glow: ["f", "o", "g"], extra: "rivets" },
};

/** Where the renderer draws the product on a crafter: [x, y, scale] in art pixels. */
export const screenOf = (size: number): [number, number, number] => (size > 1 ? [8, 5, 2] : [4, 2, 1]);

function crafterPx(t: number, dir: number, frame: number): Px {
  const size = BUILDINGS[t].size, n = size * T, st = CRAFTERS[t];
  const faceH = size > 1 ? 5 : 3;
  const p = new Px(n, n);
  casing(p, 0, 0, n, n, STEEL, faceH);
  const fy = n - faceH;
  // Coloured side strips say which machine this is.
  p.rect(1, 2, 2, fy - 5, st.trim); p.rect(1, 2, 1, fy - 5, st.hi);
  p.rect(n - 3, 2, 2, fy - 5, st.trim); p.rect(n - 3, 2, 1, fy - 5, st.hi);
  // Screen that shows what is being made: the renderer draws the item into it.
  const [sx, sy, sc] = screenOf(size), sw = IT * sc + 2;
  p.rect(sx - 1, sy - 1, sw, sw, "0"); p.rect(sx, sy, sw - 2, sw - 2, "1");
  const on = frame > 0, alt = frame === 2;
  const g = st.glow, w = n - 4;
  switch (st.face) {
    case "fire":
      for (let i = 0; i < w; i += 2) {
        p.set(2 + i, fy + 1, on ? g[(i / 2 + (alt ? 1 : 0)) % 2] : "a");
        p.set(2 + i, fy, on ? g[2 - ((i / 2 + (alt ? 0 : 1)) % 2)] : "a");
      }
      break;
    case "spark":
      p.rect(2, fy, w, 1, "1");
      if (on) for (let i = alt ? 1 : 3; i < w; i += 4) { p.set(2 + i, fy, g[2]); p.set(3 + i, fy + 1, g[1]); }
      break;
    case "bars": {
      const len = !on ? 3 : alt ? 5 : 1;
      p.rect(2, fy, len, 2, g[1]); p.rect(n - 2 - len, fy, len, 2, g[1]);
      p.rect(2, fy + 1, len, 1, g[0]); p.rect(n - 2 - len, fy + 1, len, 1, g[0]);
      break;
    }
    case "spool":
      for (const cx of [4, n - 5]) {
        p.rect(cx - 2, fy - 1, 4, 3, g[0]); p.rect(cx - 2, fy - 1, 4, 1, g[1]);
        p.set(cx - (on && alt ? 1 : 0), fy, "1");
      }
      p.rect(6, fy, n - 12, 1, on ? g[1] : g[2]);
      break;
    case "lights":
      for (let i = 0; i < w; i += 3) p.set(2 + i, fy, !on ? "1" : (Math.floor(i / 3) + (alt ? 1 : 0)) % 3 === 0 ? g[1] : g[0]);
      break;
    case "liquid":
      p.rect(2, fy - 1, w, 2, "1");
      for (let i = 0; i < w; i++) p.set(2 + i, fy - ((i + (alt ? 1 : 0)) % 4 < 2 && on ? 1 : 0), i % 5 === 0 && on ? g[0] : g[1]);
      p.rect(2, fy, w, 1, g[2]);
      break;
    case "stripes":
      for (let i = 0; i < w; i++) p.set(2 + i, fy, (i + (on ? (alt ? 2 : 1) : 0)) % 4 < 2 ? g[0] : "0");
      break;
  }
  if (st.extra === "chimney") {
    p.rect(n - 6, 0, 4, 3, "0"); p.rect(n - 5, 0, 2, 2, on ? (alt ? "f" : "e") : "a");
  } else if (st.extra === "rivets") {
    p.set(1, 1, "f"); p.set(n - 2, 1, "f");
  }
  p.set(n - 3, fy - 2, on ? "l" : "h"); // status lamp
  port(p, size, dir);
  return p;
}

function plate(c1 = "2", c2 = "3"): Px {
  const p = new Px(T, T);
  p.rect(1, 1, 14, 14, "0");
  p.rect(2, 2, 12, 12, c1);
  p.rect(2, 2, 12, 1, c2); p.rect(2, 2, 1, 12, c2);
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14]]) p.set(x, y, " ");
  return p;
}
const ARROW_N = "..f.. .fff. fffff";

function buildingPx(t: number, dir: number, frame: number): Px {
  const def = BUILDINGS[t];
  const n = def.size * T;
  const on = frame > 0, alt = frame === 2;
  if (CRAFTERS[t]) return crafterPx(t, dir, frame);
  let p = new Px(n, n);
  switch (t) {
    case B.cross:
      p.blit(beltPx(0, 0), 0, 0);
      p.blit(beltPx(0, 0).rot(1), 0, 0);
      p.rect(3, 3, 10, 10, "0"); p.rect(4, 4, 8, 8, "3"); p.rect(4, 4, 8, 1, "4"); p.rect(4, 4, 1, 8, "4");
      p.rect(7, 5, 2, 6, "f"); p.rect(5, 7, 6, 2, "f");
      return p;
    case B.splitter:
      p = plate();
      p.rect(1, 10, 14, 5, "0"); p.rect(2, 10, 12, 4, "1");   // belt mouth at the back
      p.rect(3, 3, 10, 8, "3"); p.rect(3, 3, 10, 1, "4");
      p.glyph(6, 4, ARROW_N);
      p.glyph(10, 5, "f.. ff. fff ff. f..");
      p.glyph(3, 5, "..f .ff fff .ff ..f");
      return p.rot(dir);
    case B.sorter:
      p = plate();
      p.rect(1, 13, 14, 2, "0");
      p.rect(3, 4, 10, 10, "0"); p.rect(4, 5, 8, 8, "1");     // screen for the chosen item
      p.glyph(6, 1, "..g.. .ggg.");
      p = p.rot(dir);
      // The screen must stay upright: redraw it in the middle after turning.
      p.rect(3, 3, 10, 10, "0"); p.rect(4, 4, 8, 8, "1");
      return p;
    case B.crate:
      casing(p, 0, 0, T, T, { top: "b", hi: "c", face: "a", lo: "A" });
      p.rect(1, 6, 14, 1, "a"); p.rect(2, 1, 1, 11, "a"); p.rect(13, 1, 1, 11, "a");
      p.rect(3, 1, 10, 10, "0"); p.rect(4, 2, 8, 8, "1");
      p.rect(2, 13, 12, 1, "b");
      port(p, 1, dir);
      return p;
    case B.driver:
      p = plate("u", "2");
      p.rect(4, 3, 8, 11, "0"); p.rect(5, 4, 6, 9, "1");
      for (let k = 0; k < 3; k++) {
        const y = 10 - k * 3 - (on ? 1 : 0);
        const c = on && k === (alt ? 2 : 1) ? "7" : "o";
        p.set(7, y, c); p.set(8, y, c); p.set(6, y + 1, c); p.set(9, y + 1, c);
      }
      p.rect(5, 1, 6, 2, "o"); p.rect(6, 0, 4, 1, "7");
      return p.rot(dir);
    case B.catcher:
      p = plate("u", "2");
      p.ring(8, 8, 6, "o"); p.ring(8, 8, 3.5, "n"); p.disc(8, 8, 1.5, on ? "7" : "1");
      port(p, 1, dir);
      return p;
    case B.trash:
      p = plate("1", "2");
      for (let i = 0; i < 12; i++) { p.set(2 + i, 2, (i >> 1) & 1 ? "g" : "0"); p.set(2 + i, 13, (i >> 1) & 1 ? "0" : "g"); }
      p.disc(8, 8, 4, "0"); p.ring(8, 8, 4.8, "3");
      return p;
    case B.drill: case B.heavy: case B.scoop: {
      const faceH = def.size > 1 ? 5 : 3;
      casing(p, 0, 0, n, n, STEEL, faceH);
      const cy = (n - faceH) / 2, cx = n / 2;
      const r = def.size > 1 ? 9 : 4.5;
      p.rect(1, 1, 2, 2, "f"); p.rect(n - 3, 1, 2, 2, "f");
      p.disc(cx, cy, r + 1, "0"); p.disc(cx, cy, r, t === B.scoop ? "a" : "1");
      if (t === B.scoop) {
        p.glyph(cx - 3, cy - 3 + (on && alt ? 1 : 0), "..55.. .5665. 566665 .5445. ..44..");
      } else {
        // The bit: a cross that turns while the drill runs.
        const len = Math.floor(r) - 1;
        for (let i = -len; i < len; i++) {
          if (on && alt) { p.set(cx + i, cy + i, "6"); p.set(cx + i, cy - i - 1, "5"); }
          else { p.set(cx + i, cy, "6"); p.set(cx + i, cy - 1, "6"); p.set(cx, cy + i, "5"); p.set(cx - 1, cy + i, "5"); }
        }
        p.disc(cx, cy, def.size > 1 ? 2.5 : 1.5, "f");
      }
      p.set(n - 3, n - faceH - 2, on ? "l" : "h");
      for (let i = 2; i < n - 2; i += 3) p.set(i, n - 2, on && (i / 3 + (alt ? 1 : 0)) % 2 < 1 ? "c" : "1");
      port(p, def.size, dir);
      return p;
    }
    case B.well:
      casing(p, 0, 0, T, T);
      p.disc(8, 6, 5, "0"); p.disc(8, 6, 4, "j");
      for (let y = 3; y < 10; y += 2) p.rect(5, y, 6, 1, on ? (alt ? "g" : "l") : "k");
      p.set(13, 10, on ? "l" : "h");
      p.rect(2, 13, 12, 1, "k");
      return p;
    case B.tank:
      p.disc(8, 8, 7.5, "0"); p.disc(8, 8, 6.5, "4"); p.disc(8, 7.5, 5.5, "5");
      p.disc(8, 8, 4.5, "0"); p.disc(8, 8, 3.5, "1");
      p.set(4, 4, "6"); p.set(5, 3, "6");
      return p;
    case B.solar:
      p.rect(1, 1, 30, 30, "0");
      p.rect(2, 2, 28, 26, "m");
      for (let y = 2; y < 28; y++) for (let x = 2; x < 30; x++) {
        if ((x - 2) % 7 === 6 || (y - 2) % 9 === 8) p.set(x, y, "1");
        else if ((x + y) % 11 === 0) p.set(x, y, "n");
      }
      p.rect(2, 2, 28, 1, "n");
      p.rect(2, 28, 28, 2, "2"); p.rect(14, 28, 4, 2, "f");
      for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30]]) p.set(x, y, " ");
      return p;
    case B.burner:
      casing(p, 0, 0, T, T, { top: "3", hi: "4", face: "a", lo: "1" });
      p.rect(1, 2, 2, 8, "b"); p.rect(13, 2, 2, 8, "b");
      p.rect(4, 1, 8, 9, "0"); p.rect(5, 2, 6, 7, on ? "h" : "A");
      if (on) p.glyph(5, 3, alt ? "..f... .fef.. .egef. feggef eggge. .egge." : "...f.. ..fef. .fege. .eggef feggge .egge.");
      for (let i = 2; i < 14; i += 2) p.set(i, 13, on ? (alt ? "e" : "f") : "a");
      return p;
    case B.turbine:
      casing(p, 0, 0, T, T);
      p.disc(8, 6, 5.5, "0"); p.disc(8, 6, 4.5, "1");
      if (on && alt) p.glyph(4, 2, "6......6 .6....6. ..6..6.. ...55... ...55... ..6..6.. .6....6. 6......6");
      else p.glyph(4, 2, "...66... ...66... ...66... 66655666 66655666 ...66... ...66... ...66...");
      p.rect(2, 13, 12, 1, on ? "o" : "t"); p.set(13, 10, on ? "l" : "h");
      return p;
    case B.reactor: case B.fusion: {
      const col = t === B.reactor ? ["o", "n", "7"] : ["l", "k", "g"];
      casing(p, 0, 0, n, n, DARK, 5);
      for (let i = 2; i < n - 2; i++) p.set(i, n - 3, (i >> 1) & 1 ? "g" : "0");
      p.disc(16, 13, 11, "0"); p.disc(16, 13, 10, "3"); p.disc(16, 13, 8, "0");
      p.disc(16, 13, 7, on ? col[1] : "u");
      if (on) { p.ring(16, 13, alt ? 7 : 5, col[0], 2); p.disc(16, 13, alt ? 2 : 3, col[2]); }
      else p.disc(16, 13, 2, "2");
      if (t === B.fusion) p.ring(16, 13, 10, on ? col[0] : "4", 1);
      for (const [x, y] of [[3, 3], [28, 3], [3, 23], [28, 23]]) { p.rect(x - 1, y - 1, 3, 3, "0"); p.set(x, y, on ? col[0] : "4"); }
      return p;
    }
    case B.lamp:
      p.disc(8, 12, 3, "0"); p.disc(8, 12, 2, "3");
      p.rect(7, 5, 2, 7, "0"); p.rect(7, 6, 1, 6, "5");
      p.disc(8, 4, 3, "0"); p.disc(8, 4, 2, "g"); p.set(7, 3, "7");
      return p;
    case B.hub:
      casing(p, 0, 0, n, n, STEEL, 6);
      // Arrows on every side: deliveries go in anywhere.
      for (let k = 0; k < 3; k++) {
        const a = k * T + 6;
        p.glyph(a - 1, 2, "ooooo .ooo. ..o..");
        p.glyph(2, a - 1, "o.. oo. ooo oo. o..");
        p.glyph(n - 5, a - 1, "..o .oo ooo .oo ..o");
      }
      p.disc(24, 21, 13, "0"); p.disc(24, 21, 12, "4"); p.disc(24, 20.5, 11, "5");
      p.disc(24, 21, 9, "0"); p.disc(24, 21, 8, "m");
      p.disc(24, 21, 6, "n"); p.disc(23, 20, 4, alt ? "7" : "o"); p.disc(22, 19, 1.5, "7");
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 + 0.39;
        p.set(Math.round(24 + Math.cos(a) * 10.5 - 0.5), Math.round(21 + Math.sin(a) * 10.5 - 0.5), i % 2 === frame % 2 ? "f" : "b");
      }
      // Antenna and beacon
      p.rect(40, 4, 1, 8, "6"); p.rect(38, 11, 5, 2, "0"); p.rect(39, 2, 3, 3, "0"); p.set(40, 3, frame === 1 ? "i" : "h");
      for (let i = 3; i < n - 3; i += 4) p.set(i, n - 3, (i >> 2) % 2 === frame % 2 ? "f" : "b");
      p.rect(20, n - 5, 8, 3, "0"); p.rect(21, n - 4, 6, 1, "o");
      return p;
    case B.pad:
      p.rect(2, 2, 44, 44, "0");
      p.rect(3, 3, 42, 42, "u"); p.rect(3, 3, 42, 1, "2"); p.rect(3, 3, 1, 42, "2");
      for (let i = 0; i < 44; i++) {
        const c = (i >> 2) & 1 ? "g" : "0";
        p.set(2 + i, 2, c); p.set(2 + i, 45, c); p.set(2, 2 + i, c); p.set(45, 2 + i, c);
      }
      p.ring(24, 24, 16, "3", 1); p.ring(24, 24, 11, "g", 1); p.disc(24, 24, 7, "1");
      p.rect(23, 9, 2, 6, "g"); p.rect(23, 33, 2, 6, "g"); p.rect(9, 23, 6, 2, "g"); p.rect(33, 23, 6, 2, "g");
      for (const [x, y] of [[6, 6], [41, 6], [6, 41], [41, 41]]) { p.rect(x - 1, y - 1, 3, 3, "0"); p.set(x, y, frame === 1 ? "i" : "h"); }
      return p;
  }
  return p;
}

function pipePx(mask: number, tri3: { L: string; M: string; D: string } | null): Px {
  const p = new Px(T, T);
  const arm = (d: number, c: string, half: number) => {
    if (d === 0) p.rect(8 - half, 0, half * 2, 8, c);
    else if (d === 1) p.rect(8, 8 - half, 8, half * 2, c);
    else if (d === 2) p.rect(8 - half, 8, half * 2, 8, c);
    else p.rect(0, 8 - half, 8, half * 2, c);
  };
  for (const [c, half] of [["0", 3], ["4", 2]] as [string, number][]) {
    for (let d = 0; d < 4; d++) if (mask & (1 << d)) arm(d, c, half);
    p.rect(8 - half - 1, 8 - half - 1, half * 2 + 2, half * 2 + 2, c);
  }
  // The fluid's colour runs through the middle.
  for (let d = 0; d < 4; d++) if (mask & (1 << d)) arm(d, tri3 ? tri3.M : "2", 1);
  p.rect(6, 6, 4, 4, tri3 ? tri3.M : "2");
  p.set(5, 5, "6"); p.set(6, 5, "5"); p.set(5, 6, "5");
  if (tri3) { p.set(7, 7, tri3.L); p.set(8, 7, tri3.L); }
  return p;
}

function floorPx(): Px {
  const p = new Px(T, T);
  p.rect(0, 0, T, T, "u");
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    if (x % 4 === 0 || y % 4 === 0) p.set(x, y, "1");
    else if (x % 4 === 1 && y % 4 === 1) p.set(x, y, "3");
  }
  p.box(0, 0, T, T, "0"); p.rect(1, 1, 14, 1, "t");
  return p;
}

function rocketPx(flame: number): Px {
  const p = new Px(T, 32);
  p.glyph(3, 2, `
    ....77.... ...7667... ...6666... ..666666.. ..66oo66.. ..6o77o6.. ..6o77o6.. ..66oo66.. ..666666..
    ..655556.. ..666666.. ..666665.. ..666665.. .i666665i. .i666655i. ii666655ii ii655555ii i.444444.i`);
  if (flame === 1) p.glyph(5, 20, "gggggg .gffg. .gffg. ..fe.. ..fe.. ..e...");
  if (flame === 2) p.glyph(5, 20, "gggggg gffffg .feef. .feef. ..ee.. ..ee.. ...e.. ..e...");
  return p;
}

const PORTRAIT = `
  ....00000000.... ...0555555550... ..056666666650.. .05666666666650. .05600000000650. 0560111111110650
  0560117o11110650 05601o1111110650 0560111111110650 .05601111110650. .05660000006650. ..055666666550..
  ...0055555500... ..0ee04444044e0. .0eeee0440eeee0. .0eeeee00eeeee0.`;

// ---------- Atlas ----------
export interface Atlas {
  items: HTMLCanvasElement;                 // one row, IT px each
  belts: HTMLCanvasElement;                 // column = shape*4+dir, row = frame
  build: HTMLCanvasElement[];               // per building: column = dir, row = frame
  pipes: HTMLCanvasElement;                 // column = mask, row = fluid+1
  floor: HTMLCanvasElement;
  rocket: HTMLCanvasElement;                // three frames side by side: no flame, small, large
  lights: HTMLCanvasElement[];              // by BuildDef.light
  itemUrl: string[];
  fluidUrl: string[];
  buildUrl: string[];
  portraitUrl: string;
}

const LIGHT_TINT = ["", "#ffd9a0", "#a0e8ff", "#ff9a4a", "#b8ff8a", "#ff9ad8"];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** A stepped, dithered glow: pixel art has no smooth gradients. */
function lightSprite(tint: string): HTMLCanvasElement {
  const n = 64, cv = makeCanvas(n, n), ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  const r = parseInt(tint.slice(1, 3), 16), g = parseInt(tint.slice(3, 5), 16), b = parseInt(tint.slice(5, 7), 16);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / (n / 2);
    if (d >= 1) continue;
    const v = (1 - d) * 4 + (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * 0.9;
    const level = Math.max(0, Math.min(4, Math.round(v)));
    const k = (y * n + x) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = [0, 40, 85, 140, 200][level];
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

export function buildAtlas(): Atlas {
  const items = makeCanvas(IT * ITEM_COUNT, IT);
  const ic = items.getContext("2d")!;
  const itemUrl: string[] = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    const p = itemPx(i);
    const cv = p.toCanvas();
    ic.drawImage(cv, i * IT, 0);
    itemUrl.push(cv.toDataURL());
    // The most common bright colour stands in for the item when zoomed far out.
    const seen: Record<string, number> = {};
    for (const ch of p.d) if (ch !== "." && !"0123".includes(ch)) seen[ch] = (seen[ch] ?? 0) + 1;
    ITEM_COLORS[i] = PAL[Object.keys(seen).sort((a, b) => seen[b] - seen[a])[0] ?? "6"];
  }
  const fluidUrl: string[] = [];
  for (let f = 0; f < FLUID_COUNT; f++) {
    const p = new Px(IT, IT);
    p.glyph(0, 0, DROP, FLUID_TRI[f]);
    fluidUrl.push(p.toCanvas().toDataURL());
  }

  const belts = makeCanvas(T * 12, T * BELT_FRAMES);
  const bc = belts.getContext("2d")!;
  for (let f = 0; f < BELT_FRAMES; f++) for (let shape = 0; shape < 3; shape++) for (let dir = 0; dir < 4; dir++) {
    bc.drawImage(beltPx(shape, f).rot(dir).toCanvas(), (shape * 4 + dir) * T, f * T);
  }

  const build: HTMLCanvasElement[] = [];
  const buildUrl: string[] = [];
  for (let t = 0; t < BUILDINGS.length; t++) {
    const def = BUILDINGS[t], n = def.size * T;
    if (t === B.belt || t === B.pipe || t === B.scaffold) {
      const p = t === B.belt ? beltPx(0, 0).rot(1) : t === B.pipe ? pipePx(10, FLUID_TRI[0]) : floorPx();
      if (t === B.belt) p.blit(itemPx(I.gear), 4, 4);
      build[t] = p.toCanvas();
      buildUrl[t] = build[t].toDataURL();
      continue;
    }
    const cv = makeCanvas(n * 4, n * BUILD_FRAMES);
    const c = cv.getContext("2d")!;
    for (let f = 0; f < BUILD_FRAMES; f++) for (let dir = 0; dir < 4; dir++) c.drawImage(buildingPx(t, dir, f).toCanvas(), dir * n, f * n);
    build[t] = cv;
    // Menu icon: the building facing east, with what it typically makes on its screen.
    const icon = buildingPx(t, 1, 0);
    const first = RECIPES.find((r) => r.machine === t && r.out);
    if (first && def.size === 1) icon.blit(itemPx(first.out![0]), 4, 2);
    buildUrl[t] = icon.toCanvas().toDataURL();
  }

  const pipes = makeCanvas(T * 16, T * (FLUID_COUNT + 1));
  const pc = pipes.getContext("2d")!;
  for (let f = 0; f <= FLUID_COUNT; f++) for (let mask = 0; mask < 16; mask++) {
    pc.drawImage(pipePx(mask, f === 0 ? null : FLUID_TRI[f - 1]).toCanvas(), mask * T, f * T);
  }

  const rocket = makeCanvas(T * 3, 32);
  const rc = rocket.getContext("2d")!;
  for (let f = 0; f < 3; f++) rc.drawImage(rocketPx(f).toCanvas(), f * T, 0);

  const portrait = new Px(16, 16);
  portrait.glyph(0, 0, PORTRAIT);

  return {
    items, belts, build, pipes, floor: floorPx().toCanvas(), rocket,
    lights: LIGHT_TINT.map((tint) => (tint ? lightSprite(tint) : makeCanvas(1, 1))),
    itemUrl, fluidUrl, buildUrl, portraitUrl: portrait.toCanvas().toDataURL(),
  };
}

// ---------- Terrain ----------
// Light, mid, dark per deposit type
const DEP_TRI: (string[] | null)[] = [
  null, ["6", "5", "4"], ["d", "c", "b"], ["7", "z", "y"], ["5", "3", "1"], ["7", "o", "n"], ["r", "q", "p"], ["g", "l", "k"],
  ["7", "T", "p"], ["g", "l", "j"],
];

// Two ground tints per deposit type
const DEP_STAIN: string[][] = [[], ["t", "s"], ["b", "c"], ["D", "y"], ["v", "1"], ["m", "n"], ["p", "q"], ["j", "k"], ["p", "T"], ["j", "k"]];

/** One chunk of ground: 256x256 pixels, generated when it first comes into view. */
export function drawChunk(chunk: Chunk, groundAt: (x: number, y: number) => boolean, depositAt: (x: number, y: number) => number): HTMLCanvasElement {
  const n = CH * T;
  const cv = makeCanvas(n, n);
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(n, n);
  const put = (x: number, y: number, ch: string) => {
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    const c = RGB[ch], k = (y * n + x) * 4;
    img.data[k] = c[0]; img.data[k + 1] = c[1]; img.data[k + 2] = c[2]; img.data[k + 3] = 255;
  };
  const x0 = chunk.cx * CH, y0 = chunk.cy * CH;
  const SHADES = ["A", "a", "a", "B", "C"];
  for (let j = 0; j < CH; j++) {
    for (let i = 0; i < CH; i++) {
      if (!chunk.ground[(j << 4) | i]) continue;
      const tx = x0 + i, ty = y0 + j;
      const up = groundAt(tx, ty - 1), down = groundAt(tx, ty + 1), left = groundAt(tx - 1, ty), right = groundAt(tx + 1, ty);
      for (let py = 0; py < T; py++) {
        for (let px = 0; px < T; px++) {
          const wx = tx * T + px, wy = ty * T + py;
          const v = noise(wx / 46, wy / 46, 3) * 0.55 + noise(wx / 13, wy / 13, 5) * 0.3 + hash(wx, wy, 7) * 0.15;
          let ch = SHADES[Math.max(0, Math.min(4, Math.floor((v - 0.22) * 8)))];
          const h = hash(wx, wy, 11);
          if (h < 0.006) ch = "D"; else if (h > 0.994) ch = "v";
          // Cliff where the rock ends: a lit edge on top, a dark face below.
          if (!up && py === 0) ch = "D";
          if (!left && px === 0) ch = "C";
          if (!right && px === T - 1) ch = "A";
          if (!down && py >= T - 4) ch = py === T - 4 ? "A" : py === T - 1 ? "0" : "v";
          put(i * T + px, j * T + py, ch);
        }
      }
    }
  }
  // Craters
  for (let k = 0; k < 5; k++) {
    const cx = Math.floor(hash(chunk.cx, chunk.cy, 40 + k) * n), cy = Math.floor(hash(chunk.cx, chunk.cy, 50 + k) * n);
    const r = 5 + Math.floor(hash(chunk.cx, chunk.cy, 60 + k) * 12);
    let clear = true;
    for (const [ax, ay] of [[cx - r, cy - r], [cx + r, cy - r], [cx - r, cy + r], [cx + r, cy + r], [cx, cy]]) {
      if (ax < 0 || ay < 0 || ax >= n || ay >= n || !chunk.ground[((ay >> 4) << 4) | (ax >> 4)]) clear = false;
    }
    if (!clear) continue;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.hypot(x, y * 1.25);
      if (d > r) continue;
      if (d > r - 1.2) put(cx + x, cy + y, y < 0 ? "v" : "D");
      else if (d > r - 2.6 && y < 0) put(cx + x, cy + y, "A");
      else if (hash(cx + x, cy + y, 3) < 0.5) put(cx + x, cy + y, "A");
    }
  }
  // Deposits: clusters of small rocks
  for (let j = 0; j < CH; j++) {
    for (let i = 0; i < CH; i++) {
      const dep = chunk.deposit[(j << 4) | i];
      const tri3 = DEP_TRI[dep];
      if (!tri3) continue;
      const tx = x0 + i, ty = y0 + j;
      if (dep === 7) {
        for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
          const d = Math.hypot(x - 7.5, y - 7.5);
          if (d < 6.2 && d > 4.6) put(i * T + x, j * T + y, y < 8 ? "k" : "j");
          else if (d <= 4.6) put(i * T + x, j * T + y, d < 2 ? "g" : d < 3.4 ? "l" : "0");
        }
        continue;
      }
      // Stain the ground in the mineral's colour so a patch reads as an area.
      for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
        const hh = hash(tx * T + x, ty * T + y, 17);
        if (hh < 0.4) put(i * T + x, j * T + y, DEP_STAIN[dep][hh < 0.13 ? 1 : 0]);
      }
      const same = (dx: number, dy: number) => depositAt(tx + dx, ty + dy) === dep;
      const lo = (side: boolean) => (side ? 0 : 2), hi = (side: boolean) => (side ? 13 : 11);
      const rocks = 6 + Math.floor(hash(tx, ty, 21) * 4);
      for (let k = 0; k < rocks; k++) {
        // Keep rocks off the edges that border bare ground so patches look clustered.
        const rx = lo(same(-1, 0)) + Math.floor(hash(tx, ty, 30 + k) * (hi(same(1, 0)) - lo(same(-1, 0))));
        const ry = lo(same(0, -1)) + Math.floor(hash(tx, ty, 40 + k) * (hi(same(0, 1)) - lo(same(0, -1))));
        const X = i * T + rx, Y = j * T + ry;
        if (hash(tx, ty, 50 + k) < 0.45) {
          put(X + 1, Y, tri3[0]); put(X + 2, Y, tri3[0]);
          put(X, Y + 1, tri3[0]); put(X + 1, Y + 1, tri3[1]); put(X + 2, Y + 1, tri3[1]); put(X + 3, Y + 1, tri3[2]);
          put(X, Y + 2, tri3[1]); put(X + 1, Y + 2, tri3[2]); put(X + 2, Y + 2, tri3[2]); put(X + 3, Y + 2, tri3[2]);
          put(X + 1, Y + 3, "v"); put(X + 2, Y + 3, "v"); put(X + 3, Y + 3, "v");
        } else {
          put(X, Y, tri3[0]); put(X + 1, Y, tri3[1]);
          put(X, Y + 1, tri3[1]); put(X + 1, Y + 1, tri3[2]);
          put(X, Y + 2, "v"); put(X + 1, Y + 2, "v");
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
