// Starts the game: loop, input, feedback, saving, and the calls to Toki.
import "@fontsource/vt323/400.css";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "./style.css";
import { B, BUILDINGS, DX, DY, GAME_TITLE, RECIPES } from "./defs";
import { Lang, detectLang, setLang, t } from "./i18n";
import { DIRLESS, Renderer, TOOL_ERASE, TOOL_NONE, View } from "./render";
import { Ent, Game, GameEvent, SaveData } from "./sim";
import { chunkKey } from "./world";
import { guide } from "./guide";
import { AppApi, UI } from "./ui";
import { setSound, sfx, unlockAudio } from "./audio";
import { toki } from "./toki";

const SAVE_KEY = "fabric-save";
const SET_KEY = "fabric-settings";
const STEP = 1 / 60;

interface Stroke { x: number; y: number; pre: boolean; inDir: number; n: number }

class App implements AppApi {
  game!: Game;
  r: Renderer;
  ui: UI;
  view: View = { tool: TOOL_NONE, dir: 1, hover: null, sel: null, guide: null };
  settings: { sound: boolean; lang: Lang } = { sound: true, lang: detectLang() };
  get atlas() { return this.r.atlas; }

  private canvas = document.getElementById("c") as HTMLCanvasElement;
  private pointers = new Map<number, { x: number; y: number }>();
  // aim: a finger is down with a tool chosen, but nothing is built until it moves or lifts, so a second finger
  // can still turn the gesture into a pinch without leaving a stray building behind.
  private mode: "none" | "tap" | "pan" | "stroke" | "pinch" | "wait" | "aim" = "none";
  private aimAt = { x: 0, y: 0 };
  private start = { x: 0, y: 0 };
  private moved = false;
  private rightButton = false;
  private pinch = { d: 1, x: 0, y: 0 };
  private stroke: Stroke | null = null;
  private keys = new Set<string>();
  private hoverFree: { x: number; y: number } | null = null;
  private vel = { x: 0, y: 0 };
  private last = 0;
  private acc = 0;
  private uiAt = 0;
  private scoreTimer = 0;
  private lastLaunchSound = 0;
  private started = false;

  constructor() {
    try {
      const s = JSON.parse(localStorage.getItem(SET_KEY) || "null");
      if (s && typeof s === "object") {
        if (typeof s.sound === "boolean") this.settings.sound = s.sound;
        if (s.lang === "de" || s.lang === "en") this.settings.lang = s.lang;
      }
    } catch { /* default settings */ }
    setLang(this.settings.lang);
    setSound(this.settings.sound);
    document.documentElement.lang = this.settings.lang;
    document.title = GAME_TITLE;

    this.loadGame();
    this.r = new Renderer(this.canvas);
    this.resetCamera();
    this.ui = new UI(this);
    this.bindInput();
    for (const id of this.game.ach) toki.achievement(id);

    window.addEventListener("resize", () => this.r.resize());
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.save(); else this.last = 0; });
    window.addEventListener("pagehide", () => this.save());
    setInterval(() => this.save(), 20000);
    requestAnimationFrame((now) => this.frame(now));
  }

  // ---------- Game state ----------
  private loadGame(): void {
    let game: Game | null = null;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) game = Game.load(JSON.parse(raw) as SaveData, Date.now());
    } catch { game = null; }
    this.game = game ?? new Game();
    this.hook();
  }

  private hook(): void {
    this.game.on = (ev: GameEvent, data?: unknown) => this.onGame(ev, data);
  }

  /** Everything the factory does that should be seen, heard or reported. */
  private onGame(ev: GameEvent, data?: unknown): void {
    const g = this.game, r = this.r;
    switch (ev) {
      case "place": {
        const e = data as { x: number; y: number; size: number };
        r.burst(e.x + e.size / 2, e.y + e.size / 2, "BCDa", 4 + e.size * 4, 30 + e.size * 8);
        break;
      }
      case "remove": {
        const e = data as { x: number; y: number; size: number };
        r.burst(e.x + e.size / 2, e.y + e.size / 2, "34b5", 6 + e.size * 5, 40, 30);
        break;
      }
      case "craft": {
        const e = data as Ent;
        const [ox, oy] = g.outTile(e);
        r.burst((e.x + e.size / 2 + ox + 0.5) / 2, (e.y + e.size / 2 + oy + 0.5) / 2, "fg7", 2, 16);
        sfx("craft");
        break;
      }
      case "deliver": {
        const hub = g.hubEnt();
        if (Math.random() < 0.35) r.burst(hub.x + 1.5 + (Math.random() - 0.5) * 2.4, hub.y + 0.6, "o7n", 1, 10, 24);
        break;
      }
      case "shot": sfx("shot"); break;
      case "land": { const e = data as Ent; r.burst(e.x + 0.5, e.y + 0.5, "o7", 3, 22); sfx("land"); break; }
      case "level": {
        const d = data as { level: number; cores: number };
        const hub = g.hubEnt();
        sfx("level");
        r.shakeBy(5); r.flashBy(0.5);
        r.ring(hub.x + 1.5, hub.y + 1.5, 90, "g"); r.ring(hub.x + 1.5, hub.y + 1.5, 50, "f");
        r.burst(hub.x + 1.5, hub.y + 1.5, "fgo7e", 60, 90, 60);
        this.ui.levelUp(d.level, d.cores);
        toki.score(g.maxLevel);
        this.save();
        break;
      }
      case "achievement": toki.achievement(data as string); break;
      case "launch": {
        r.addRocket(data as Ent);
        r.shakeBy(3);
        const now = performance.now();
        if (now - this.lastLaunchSound > 1500) { this.lastLaunchSound = now; sfx("launch"); }
        break;
      }
      case "core": sfx("core"); break;
      case "upgrade": {
        const hub = g.hubEnt();
        sfx("upgrade");
        r.ring(hub.x + 1.5, hub.y + 1.5, 70, "o");
        r.burst(hub.x + 1.5, hub.y + 1.5, "o7n", 30, 70, 40);
        this.save();
        break;
      }
      case "claim": sfx("claim"); r.flashBy(0.25); r.shakeBy(2); this.save(); break;
      case "best":
        // Output climbs in small steps: send the latest once things settle.
        clearTimeout(this.scoreTimer);
        this.scoreTimer = window.setTimeout(() => toki.score(this.game.bestOutput, "output"), 4000);
        break;
    }
  }

  save(): void {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.game.serialize(Date.now()))); } catch { /* storage full or blocked */ }
  }

  private swapGame(g: Game): void {
    this.game = g;
    this.hook();
    this.view.sel = null;
    this.view.tool = TOOL_NONE;
    this.ui.close();
    this.ui.syncTool();
    this.ui.renderAll();
    this.resetCamera();
    this.save();
  }

  reset(): void {
    try { localStorage.removeItem(SAVE_KEY); } catch { /* blocked */ }
    this.swapGame(new Game());
  }

  relocate(): void {
    if (!this.game.canRelocate()) return;
    this.swapGame(this.game.relocate());
    this.r.flashBy(0.9);
    sfx("claim");
  }

  applySettings(): void {
    setLang(this.settings.lang);
    setSound(this.settings.sound);
    document.documentElement.lang = this.settings.lang;
    try { localStorage.setItem(SET_KEY, JSON.stringify(this.settings)); } catch { /* blocked */ }
    if (this.settings.sound) unlockAudio();
    this.ui.renderAll();
  }

  /** The title screen was dismissed. */
  begin(): void {
    this.started = true;
    unlockAudio();
    sfx("unlock");
    if (this.game.away) { this.ui.awayReport(this.game.away); this.game.away = null; }
  }

  private resetCamera(): void {
    this.r.cam.x = 5.5;
    this.r.cam.y = 6.5;
  }

  // ---------- Tools ----------
  setTool(tool: number): void {
    this.view.tool = tool;
    this.view.hover = null;
    this.stroke = null;
    if (tool !== TOOL_NONE && this.view.sel) this.select(null);
    this.ui.syncTool();
  }

  select(e: Ent | null): void {
    this.view.sel = e;
    if (e) this.ui.open("info");
    else if (this.ui.isOpen("info")) this.ui.close();
  }

  rotate(): void {
    const sel = this.view.sel;
    if (sel) this.game.rotate(sel);
    else this.view.dir = (this.view.dir + 1) & 3;
    sfx("rotate");
    this.ui.syncDir();
  }

  removeSel(): void {
    const sel = this.view.sel;
    if (!sel) return;
    if (this.game.remove(sel)) sfx("remove");
    this.select(null);
  }

  copySel(): void {
    const sel = this.view.sel;
    if (!sel || !BUILDINGS[sel.t].cat) return;
    if (sel.kind === "crafter" && sel.recipe >= 0) this.game.lastRecipe[sel.t] = sel.recipe;
    if (!DIRLESS.has(sel.kind)) this.view.dir = sel.dir;
    this.select(null);
    this.setTool(sel.t);
  }

  private placed(): void {
    const n = this.stroke ? this.stroke.n++ : 0;
    sfx("place", 1 + Math.min(n, 14) * 0.05);
  }

  private tryPlace(tool: number, x: number, y: number, quiet: boolean): boolean {
    const g = this.game;
    // A building dropped onto a belt faces the way the belt runs.
    const under = g.at(x, y);
    const dir = under && under.kind === "belt" && tool !== B.belt ? under.dir : this.view.dir;
    if (g.place(tool, x, y, dir)) { this.placed(); return true; }
    if (quiet) return false;
    const there = g.at(x, y) ?? (BUILDINGS[tool].kind === "pipe" || BUILDINGS[tool].kind === "tank" ? g.pipeAt(x, y) : null);
    if (there && there.t === tool) {
      // Tapping a building with its own tool turns it.
      if (!DIRLESS.has(there.kind)) {
        g.rotate(there);
        this.view.dir = there.dir;
        this.ui.syncDir();
        sfx("rotate");
      }
      return false;
    }
    const kind = BUILDINGS[tool].kind;
    sfx("error");
    let why = "ui.notHere";
    if (!g.isClaimed(x, y)) why = "ui.notClaimed";
    else if (there || g.pipeAt(x, y)) why = "ui.occupied";
    else if (kind === "floor") why = "ui.needSpace";
    else if (kind === "drill" && !there && g.isGround(x, y)) why = "ui.needDeposit";
    else if (kind === "well" && !there && g.isGround(x, y)) why = "ui.needVent";
    this.ui.toast(t(why));
    return false;
  }

  private erase(x: number, y: number): void {
    const e = this.game.at(x, y);
    if (e && e.kind === "hub") return;
    if (this.game.removeAt(x, y)) sfx("remove");
  }

  private strokeStart(x: number, y: number): void {
    const g = this.game, v = this.view;
    this.stroke = { x, y, pre: false, inDir: -1, n: 0 };
    if (v.tool === TOOL_ERASE) return this.erase(x, y);
    if (v.tool === B.belt) {
      const cur = g.at(x, y);
      this.stroke.pre = !!cur && cur.kind === "belt";
      if (!cur) {
        // Starting next to a machine that outputs nowhere: turn it to feed this belt, and run the belt onwards.
        const d = g.canPlace(B.belt, x, y) ? g.faceOutputTo(x, y) : -1;
        if (d >= 0) { v.dir = d; this.ui.syncDir(); }
        this.tryPlace(B.belt, x, y, false);
      }
      return;
    }
    this.tryPlace(v.tool, x, y, false);
  }

  private strokeTo(x: number, y: number): void {
    const s = this.stroke;
    if (!s) return;
    const g = this.game, v = this.view;
    let guard = 0;
    while ((s.x !== x || s.y !== y) && guard++ < 300) {
      const dx = x - s.x, dy = y - s.y;
      const d = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 1 : 3) : dy > 0 ? 2 : 0;
      const nx = s.x + DX[d], ny = s.y + DY[d];
      if (v.tool === TOOL_ERASE) this.erase(nx, ny);
      else if (v.tool === B.belt) {
        const cur = g.at(s.x, s.y);
        if (cur && cur.kind === "belt") {
          // Drawing straight across an older belt builds a crossover instead of cutting it.
          if (s.pre && s.inDir === d && ((cur.dir ^ d) & 1) && g.unlocked(B.cross)) g.place(B.cross, s.x, s.y, 0);
          else g.place(B.belt, s.x, s.y, d);
        } else if (!cur) g.place(B.belt, s.x, s.y, d);
        const next = g.at(nx, ny);
        s.pre = !!next && next.kind === "belt";
        v.dir = d;
        if (!next && g.place(B.belt, nx, ny, d)) this.placed();
        s.inDir = d;
      } else if (v.tool >= 0 && BUILDINGS[v.tool].drag) this.tryPlace(v.tool, nx, ny, true);
      s.x = nx;
      s.y = ny;
    }
  }

  private tap(x: number, y: number): void {
    const g = this.game;
    const e = g.at(x, y) ?? g.pipeAt(x, y);
    if (e) { sfx("tap"); this.select(e); return; }
    if (!g.isClaimed(x, y)) {
      const key = chunkKey(x >> 4, y >> 4);
      if (g.claimState(key) !== "far") { sfx("tap"); this.select(null); this.ui.open("claim", key); return; }
    }
    this.select(null);
    if (this.ui.isOpen()) this.ui.close();
  }

  // ---------- Input ----------
  private tileAt(sx: number, sy: number): [number, number] {
    const [wx, wy] = this.r.toWorld(sx, sy);
    const size = this.view.tool >= 0 ? BUILDINGS[this.view.tool].size : 1;
    return [Math.floor(wx - (size - 1) / 2), Math.floor(wy - (size - 1) / 2)];
  }

  private bindInput(): void {
    const cv = this.canvas;
    const pos = (ev: MouseEvent) => ({ x: ev.clientX, y: ev.clientY });

    cv.addEventListener("pointerdown", (ev) => {
      unlockAudio();
      try { cv.setPointerCapture(ev.pointerId); } catch { /* pointer already gone */ }
      const p = pos(ev);
      this.pointers.set(ev.pointerId, p);
      this.vel.x = this.vel.y = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.mode = "pinch";
        this.stroke = null;
        this.view.hover = null;
        return;
      }
      if (this.pointers.size > 2) return;
      this.start = p;
      this.moved = false;
      this.rightButton = ev.pointerType === "mouse" && ev.button !== 0;
      if (this.rightButton) this.mode = "pan";
      else if (this.view.tool !== TOOL_NONE) {
        const [tx, ty] = this.tileAt(p.x, p.y);
        this.view.hover = { x: tx, y: ty };
        if (ev.pointerType === "mouse") {
          this.mode = "stroke";
          this.strokeStart(tx, ty);
        } else {
          this.mode = "aim";
          this.aimAt = { x: tx, y: ty };
        }
      } else this.mode = "tap";
    });

    cv.addEventListener("pointermove", (ev) => {
      const p = pos(ev);
      const prev = this.pointers.get(ev.pointerId);
      if (!prev) {
        // Mouse moving without a button: show where the building would go.
        if (ev.pointerType === "mouse") {
          const [tx, ty] = this.tileAt(p.x, p.y);
          if (this.view.tool !== TOOL_NONE) this.view.hover = { x: tx, y: ty };
          else this.hoverFree = { x: tx, y: ty };
        }
        return;
      }
      this.pointers.set(ev.pointerId, p);
      if (this.mode === "pinch" && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.r.cam.x -= (mx - this.pinch.x) / this.r.z;
        this.r.cam.y -= (my - this.pinch.y) / this.r.z;
        this.r.zoomAt(mx, my, d / this.pinch.d);
        this.pinch = { d, x: mx, y: my };
        return;
      }
      if (Math.hypot(p.x - this.start.x, p.y - this.start.y) > 8) this.moved = true;
      if (this.mode === "tap" && this.moved) this.mode = "pan";
      if (this.mode === "aim") {
        const [tx, ty] = this.tileAt(p.x, p.y);
        const tool = this.view.tool;
        if (this.moved && (tool === TOOL_ERASE || (tool >= 0 && BUILDINGS[tool].drag))) {
          // A line tool: build from where the finger went down to where it is now.
          this.mode = "stroke";
          this.strokeStart(this.aimAt.x, this.aimAt.y);
        } else {
          // A single building follows the finger and is placed where it lifts.
          this.view.hover = { x: tx, y: ty };
          return;
        }
      }
      if (this.mode === "pan") {
        const dx = (p.x - prev.x) / this.r.z, dy = (p.y - prev.y) / this.r.z;
        this.r.cam.x -= dx;
        this.r.cam.y -= dy;
        // Remember the speed so the view glides on after the finger lifts.
        this.vel.x = this.vel.x * 0.5 - dx * 30;
        this.vel.y = this.vel.y * 0.5 - dy * 30;
      } else if (this.mode === "stroke") {
        const [tx, ty] = this.tileAt(p.x, p.y);
        this.view.hover = { x: tx, y: ty };
        this.strokeTo(tx, ty);
      }
    });

    const up = (ev: PointerEvent) => {
      if (!this.pointers.has(ev.pointerId)) return;
      const p = pos(ev);
      this.pointers.delete(ev.pointerId);
      if (this.mode === "pinch") {
        // Ignore the finger that is still down until it lifts too.
        this.mode = this.pointers.size ? "wait" : "none";
        return;
      }
      if (this.pointers.size) return;
      if (ev.type === "pointerup") {
        if (this.mode === "tap") {
          const [wx, wy] = this.r.toWorld(p.x, p.y);
          this.tap(Math.floor(wx), Math.floor(wy));
        } else if (this.mode === "aim" && this.view.hover) {
          this.strokeStart(this.view.hover.x, this.view.hover.y);
        } else if (this.mode === "pan" && this.rightButton && !this.moved) {
          // A right click puts the tool away.
          if (this.view.tool !== TOOL_NONE) this.setTool(TOOL_NONE);
          else this.select(null);
        }
      }
      // A tap on a belt with the belt tool, without drawing anything, turns it.
      const st = this.stroke;
      if (ev.type === "pointerup" && st && st.pre && st.inDir < 0 && this.view.tool === B.belt) {
        const b = this.game.at(st.x, st.y);
        if (b && b.kind === "belt") {
          this.game.rotate(b);
          this.view.dir = b.dir;
          this.ui.syncDir();
          sfx("rotate");
        }
      }
      if (this.mode !== "pan") this.vel.x = this.vel.y = 0;
      this.stroke = null;
      if (ev.pointerType !== "mouse") this.view.hover = null;
      this.mode = "none";
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("pointerleave", (ev) => { if (ev.pointerType === "mouse" && !this.pointers.size) { this.view.hover = null; this.hoverFree = null; } });
    cv.addEventListener("contextmenu", (ev) => ev.preventDefault());
    cv.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      const k = ev.ctrlKey ? 0.012 : ev.deltaMode === 1 ? 0.06 : 0.0022;
      this.r.zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * k));
    }, { passive: false });

    window.addEventListener("keydown", (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey || !this.started) return;
      const k = ev.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) { this.keys.add(k); ev.preventDefault(); return; }
      if (ev.repeat) return;
      unlockAudio();
      if (k === "r") this.rotate();
      else if (k === "x") this.setTool(this.view.tool === TOOL_ERASE ? TOOL_NONE : TOOL_ERASE);
      else if (k === "escape") { if (this.view.tool !== TOOL_NONE) this.setTool(TOOL_NONE); else { this.select(null); this.ui.close(); } }
      else if (k === "delete" || k === "backspace") this.removeSel();
      else if (k === "q") {
        const h = this.view.tool === TOOL_NONE ? this.hoverFree : this.view.hover;
        const e = this.view.sel ?? (h ? this.game.at(h.x, h.y) ?? this.game.pipeAt(h.x, h.y) : null);
        if (e && BUILDINGS[e.t].cat) { this.view.sel = e; this.copySel(); } else this.setTool(TOOL_NONE);
      } else if (k >= "1" && k <= "5") this.ui.openCat(Number(k) - 1);
    });
    window.addEventListener("keyup", (ev) => this.keys.delete(ev.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
  }

  // ---------- Loop ----------
  private voiceText(): [string, boolean] {
    const g = this.game;
    const gd = guide(g);
    this.view.guide = gd;
    this.ui.hint(gd ? gd.cat : null, gd ? gd.b : -1);
    if (!gd) return [this.ui.voiceFor(g), false];
    return [t(gd.text), true];
  }

  private frame(now: number): void {
    requestAnimationFrame((n) => this.frame(n));
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : STEP;
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= STEP && n < 6) { this.game.tick(STEP); this.acc -= STEP; n++; }
    if (n === 6) this.acc = 0;

    const cam = this.r.cam;
    if (this.keys.size) {
      const sp = (720 / this.r.z) * dt;
      if (this.keys.has("a") || this.keys.has("arrowleft")) cam.x -= sp;
      if (this.keys.has("d") || this.keys.has("arrowright")) cam.x += sp;
      if (this.keys.has("w") || this.keys.has("arrowup")) cam.y -= sp;
      if (this.keys.has("s") || this.keys.has("arrowdown")) cam.y += sp;
    }
    if (this.mode === "none" && (Math.abs(this.vel.x) > 0.05 || Math.abs(this.vel.y) > 0.05)) {
      cam.x += this.vel.x * dt;
      cam.y += this.vel.y * dt;
      const f = Math.pow(0.004, dt);
      this.vel.x *= f;
      this.vel.y *= f;
    }
    // The selected building may have been removed.
    const sel = this.view.sel;
    if (sel && this.game.at(sel.x, sel.y) !== sel && this.game.pipeAt(sel.x, sel.y) !== sel) this.select(null);

    this.r.draw(this.game, this.view, now / 1000, dt);
    if (now - this.uiAt > 200) {
      this.uiAt = now;
      this.ui.refresh();
      const [text, sticky] = this.voiceText();
      this.ui.say(text, sticky);
    }
  }
}

const app = new App();
if (import.meta.env.DEV) Object.assign(window, { app, RECIPES });
