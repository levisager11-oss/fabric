// The HUD: chips, build bar, panels, the voice line. Plain DOM over the canvas, styled as pixel art.
import {
  B, BEACON_BONUS, BUILDINGS, BURNER_SECONDS, CATS, CRATE_CAP, Cat, FLUID_IDS, I, ITEM_COUNT, ITEM_IDS,
  LAUNCH_POINTS_PER_CORE, LEVELS, PAD_POINTS, PIPE_CAP, RECIPES, RECIPES_BY_MACHINE, ROD_SECONDS, Recipe, TANK_CAP,
  TRACKS, Track, UNLOCK_CLAIMS, UNLOCK_RELOCATE, UNLOCK_UPGRADES, beaconsFor, claimCost, levelCores, levelGoal,
  trackCost, trackValue,
} from "./defs";
import { Lang, getLang, t } from "./i18n";
import { TOOL_ERASE, TOOL_NONE, View } from "./render";
import { Away, Ent, Game } from "./sim";
import { Atlas } from "./sprites";
import { sfx } from "./audio";

export interface AppApi {
  game: Game;
  view: View;
  atlas: Atlas;
  settings: { sound: boolean; lang: Lang };
  setTool(tool: number): void;
  rotate(): void;
  select(e: Ent | null): void;
  removeSel(): void;
  copySel(): void;
  reset(): void;
  relocate(): void;
  applySettings(): void;
  begin(): void;
}

/** Icons are tiny pixel grids too. */
function pix(rows: string): string {
  const r = rows.trim().split(/\s+/);
  let rects = "";
  r.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === "#") rects += `<rect x="${x}" y="${y}" width="1" height="1"/>`; });
  return `<svg class="px" viewBox="0 0 ${r[0].length} ${r.length}" shape-rendering="crispEdges">${rects}</svg>`;
}
const ICON = {
  menu: pix("####### ....... ####### ....... #######"),
  close: pix("#.....# .#...#. ..#.#.. ...#... ..#.#.. .#...#. #.....#"),
  bolt: pix("...##. ..##.. .####. ..##.. .##... ##...."),
  rotate: pix(".####.# #....## #...### #...... #.....# .#####."),
  erase: pix("..###.. ####### .#####. .#.#.#. .#.#.#. .#####."),
  lock: pix(".###. #...# #...# ##### ##.## #####"),
  check: pix("......# .....#. #...#.. .#.#... ..#...."),
  copy: pix("####... #..#### #..#..# ####..# ...#..# ...####"),
  core: pix("..#.. .###. ##### .###. ..#.."),
  beacon: pix("..#.. .#.#. #.#.# ..#.. ..#.. .###."),
};
const CAT_ICON: Record<Cat, number> = { logi: B.belt, mine: B.drill, prod: B.smelter, fluid: B.pipe, power: B.solar };

const $ = (id: string) => document.getElementById(id)!;

/**
 * Runs the handler when something inside el is tapped. After a touch drag on the canvas, browsers can
 * swallow the next click, so a finger that goes down and up in one place counts on its own.
 */
function onTap(el: HTMLElement, handler: (ev: Event) => void): void {
  let down: { x: number; y: number; t: EventTarget | null } | null = null;
  let handledAt = 0;
  el.addEventListener("pointerdown", (ev) => { down = { x: ev.clientX, y: ev.clientY, t: ev.target }; });
  el.addEventListener("pointerup", (ev) => {
    const d = down;
    down = null;
    if (!d || ev.pointerType === "mouse" || d.t !== ev.target || Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 10) return;
    handledAt = performance.now();
    handler(ev);
  });
  el.addEventListener("click", (ev) => { if (performance.now() - handledAt > 500) handler(ev); });
}
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

export function fmt(n: number): string {
  n = Math.floor(n + 1e-6);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e4) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
export function fmtTime(s: number): string {
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(sec).padStart(2, "0");
}

const itemName = (i: number) => t("item." + ITEM_IDS[i]);
const fluidName = (f: number) => t("fluid." + FLUID_IDS[f]);
const bName = (b: number) => t("b." + BUILDINGS[b].id);
const itemIc = (i: number) => `<i class="i it${i}"></i>`;
const fluidIc = (f: number) => `<i class="i fl${f}"></i>`;
const bIc = (b: number) => `<i class="i bd${b}"></i>`;

function costHtml(cost: [number, number][]): string {
  return cost.map(([i, n]) => `<span class="cost" data-k="has:${i}:${n}" data-m="c" title="${esc(itemName(i))}">${itemIc(i)}${fmt(n)}</span>`).join("");
}
function recipeHtml(r: Recipe, mul: number): string {
  const parts: string[] = r.inp.map(([i, n]) => `<span class="rq">${n}${itemIc(i)}</span>`);
  for (const [f, n] of r.fin) parts.push(`<span class="rq">${n}${fluidIc(f)}</span>`);
  const out = r.out ? `<span class="rq">${r.out[1]}${itemIc(r.out[0])}</span>` : `<span class="rq">${r.fout![1]}${fluidIc(r.fout![0])}</span>`;
  const perMin = ((r.out ? r.out[1] : r.fout![1]) * 60 * mul) / r.time;
  return `<span class="rflow">${parts.join('<span class="plus">+</span>')}<span class="arrow">&gt;</span>${out}</span><span class="rrate">${fmt(perMin)}${t("ui.perMin")}</span>`;
}
const recipeName = (r: Recipe) => (r.out ? itemName(r.out[0]) : fluidName(r.fout![0]));
const recipeIc = (r: Recipe) => (r.out ? itemIc(r.out[0]) : fluidIc(r.fout![0]));

function trackText(track: Track, tier: number): string {
  const v = trackValue(track, tier);
  if (track === "belt") return v + "/s";
  if (track === "offline") return v + " h";
  return "×" + v.toFixed(2).replace(/0$/, "");
}

export class UI {
  private sheet = $("sheet");
  private tray = $("tray");
  private bar = $("bar");
  private modal = $("modal");
  private voice = $("voice");
  private toasts = $("toasts");
  private banner = $("banner");
  private title = $("title");
  private kind = "";
  private dyn: (() => Record<string, string | number | boolean>) | null = null;
  private cat: Cat | null = null;
  private lastToast = "";
  private lastToastAt = 0;
  private voiceText = "";
  private voiceTimer = 0;
  private voiceUntil = 0;
  private claimKey = 0;
  private shownCores = -1;

  constructor(private app: AppApi) {
    this.injectIcons();
    onTap(this.bar, (ev) => this.onBar(ev));
    onTap(this.tray, (ev) => this.onTray(ev));
    onTap(this.sheet, (ev) => this.onSheet(ev));
    onTap(this.modal, (ev) => {
      const el = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!el) return;
      sfx("tap");
      if (el.dataset.act === "resetYes") this.app.reset();
      if (el.dataset.act === "relocateYes") this.app.relocate();
      this.modal.hidden = true;
    });
    onTap(this.title, (ev) => {
      const el = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
      if (!el) return;
      if (el.dataset.act === "lang") { this.app.settings.lang = getLang() === "de" ? "en" : "de"; this.app.applySettings(); return; }
      this.title.hidden = true;
      this.app.begin();
    });
    onTap($("goal"), () => this.toggle("goals"));
    onTap($("power"), () => this.toggle("power"));
    onTap($("cores"), () => this.toggle("upgrades"));
    onTap($("bMenu"), () => this.toggle("menu"));
    this.renderAll();
  }

  private injectIcons(): void {
    const a = this.app.atlas;
    let css = "";
    a.itemUrl.forEach((u, i) => (css += `.it${i}{background-image:url(${u})}`));
    a.fluidUrl.forEach((u, i) => (css += `.fl${i}{background-image:url(${u})}`));
    a.buildUrl.forEach((u, i) => (css += `.bd${i}{background-image:url(${u})}`));
    css += `.portrait{background-image:url(${a.portraitUrl})}`;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
  }

  /** Everything that holds translated text. */
  renderAll(): void {
    $("bMenu").innerHTML = ICON.menu;
    $("bMenu").setAttribute("aria-label", t("ui.menu"));
    $("goal").innerHTML = '<span class="gnum"></span><span class="gtxt"><span class="gt"></span><span class="bar"><span></span></span></span>';
    $("power").innerHTML = ICON.bolt + '<span class="pw"></span>';
    $("cores").innerHTML = ICON.core + '<span class="cn"></span><span class="dot" hidden></span>';
    $("cores").setAttribute("aria-label", t("ui.upgrades"));
    this.voice.innerHTML = `<i class="portrait"></i><div><b>${t("voice")}</b><span class="vt"></span></div>`;
    this.voiceText = "";
    const g = this.app.game;
    const fresh = g.time < 1 && g.maxLevel === 1;
    this.title.innerHTML = `<div class="tcard"><div class="logo">FAB<span>RIC</span></div><p>${t("ui.tagline")}</p>
      <button class="btn primary big" data-act="play">${fresh ? t("ui.play") : t("ui.resume")}</button>
      <button class="btn ghost" data-act="lang">${getLang() === "de" ? "Deutsch" : "English"}</button></div>`;
    this.renderBar();
    this.renderTray();
    if (this.kind) this.open(this.kind);
    this.refresh();
  }

  // ---------- Build bar ----------
  private renderBar(): void {
    const v = this.app.view;
    let h = "";
    for (const c of CATS) h += `<button class="bb${this.cat === c ? " on" : ""}" data-cat="${c}">${bIc(CAT_ICON[c])}<span>${t("cat." + c)}</span></button>`;
    h += `<button class="bb sm" data-act="rotate" aria-label="${t("ui.rotate")}">${ICON.rotate}<span>${t("ui.rotate")}</span></button>`;
    h += `<button class="bb sm${v.tool === TOOL_ERASE ? " on danger" : ""}" data-act="erase" aria-label="${t("ui.erase")}">${ICON.erase}<span>${t("ui.erase")}</span></button>`;
    this.bar.innerHTML = h;
  }

  private renderTray(): void {
    if (!this.cat) { this.tray.hidden = true; return; }
    const g = this.app.game, v = this.app.view;
    let h = "";
    const order = BUILDINGS.map((_, i) => i).filter((i) => BUILDINGS[i].cat === this.cat).sort((a, b) => BUILDINGS[a].unlock - BUILDINGS[b].unlock);
    order.forEach((i) => {
      const def = BUILDINGS[i];
      const locked = !g.unlocked(i);
      h += `<button class="tb${v.tool === i ? " on" : ""}${locked ? " locked" : ""}" data-b="${i}" ${locked ? "disabled" : ""}>${bIc(i)}<span>${bName(i)}</span>${locked ? `<em>${ICON.lock}${def.unlock}</em>` : ""}</button>`;
    });
    const tool = v.tool >= 0 ? BUILDINGS[v.tool] : null;
    this.tray.innerHTML = `<div class="tscroll">${h}</div>` + (tool ? `<p class="tdesc">${t("b." + tool.id + ".d")}${tool.power && tool.cat !== "power" ? ` <b>${tool.power} kW</b>` : ""}</p>` : "");
    this.tray.hidden = false;
  }

  /** Called when the tool changes. */
  syncTool(): void {
    const v = this.app.view;
    if (v.tool >= 0) {
      this.cat = BUILDINGS[v.tool].cat;
      if (this.kind) this.close();
    } else if (v.tool === TOOL_ERASE) {
      this.cat = null;
      if (this.kind) this.close();
    }
    this.renderBar();
    this.renderTray();
  }

  openCat(i: number): void {
    const c = CATS[i];
    if (!c) return;
    this.cat = this.cat === c ? null : c;
    const tool = this.app.view.tool;
    if (tool !== TOOL_NONE && (!this.cat || tool < 0 || BUILDINGS[tool].cat !== c)) this.app.setTool(TOOL_NONE);
    if (this.cat && this.kind) this.close();
    this.renderBar();
    this.renderTray();
  }

  private onBar(ev: Event): void {
    const el = (ev.target as HTMLElement).closest("button") as HTMLElement | null;
    if (!el) return;
    sfx("tap");
    if (el.dataset.cat) this.openCat(CATS.indexOf(el.dataset.cat as Cat));
    else if (el.dataset.act === "rotate") this.app.rotate();
    else if (el.dataset.act === "erase") {
      this.cat = null;
      this.app.setTool(this.app.view.tool === TOOL_ERASE ? TOOL_NONE : TOOL_ERASE);
    }
  }

  private onTray(ev: Event): void {
    const el = (ev.target as HTMLElement).closest("button[data-b]") as HTMLElement | null;
    if (!el) return;
    sfx("tap");
    const b = Number(el.dataset.b);
    this.app.setTool(this.app.view.tool === b ? TOOL_NONE : b);
  }

  // ---------- Panels ----------
  private toggle(kind: string): void {
    sfx("tap");
    if (this.kind === kind) this.close();
    else this.open(kind);
  }

  isOpen(kind?: string): boolean { return kind ? this.kind === kind : !!this.kind; }

  close(): void {
    this.kind = "";
    this.dyn = null;
    this.sheet.hidden = true;
    this.sheet.innerHTML = "";
    if (this.app.view.sel) this.app.select(null);
  }

  open(kind: string, arg?: number): void {
    const g = this.app.game;
    let title = "", body = "";
    this.dyn = null;
    if (kind !== "info" && this.app.view.sel) { this.kind = ""; this.app.select(null); }
    if (kind === "claim" && arg !== undefined) this.claimKey = arg;
    switch (kind) {
      case "goals": [title, body] = this.goalsHtml(g); break;
      case "upgrades": [title, body] = this.upgradesHtml(g); break;
      case "power": [title, body] = this.powerHtml(); break;
      case "menu": [title, body] = this.menuHtml(); break;
      case "claim": [title, body] = this.claimHtml(g); break;
      case "info": {
        const e = this.app.view.sel;
        if (!e) return this.close();
        [title, body] = this.infoHtml(g, e);
        break;
      }
      default: return;
    }
    this.kind = kind;
    if (this.cat || this.app.view.tool !== TOOL_NONE) {
      this.cat = null;
      if (this.app.view.tool !== TOOL_NONE) this.app.setTool(TOOL_NONE);
      else { this.renderBar(); this.renderTray(); }
      this.kind = kind;
    }
    this.sheet.innerHTML = `<div class="sh-head"><h2>${title}</h2><button class="x" data-act="close" aria-label="${t("ui.cancel")}">${ICON.close}</button></div><div class="sh-body">${body}</div>`;
    this.sheet.hidden = false;
    this.apply();
  }

  private unlocksHtml(level: number, rich: boolean): string {
    let h = "";
    BUILDINGS.forEach((def, i) => {
      if (def.unlock !== level || !def.cat) return;
      h += rich ? `<div class="unl">${bIc(i)}<div><b>${bName(i)}</b><span>${t("b." + def.id + ".d")}</span></div></div>` : `<span class="chip2">${bIc(i)}${bName(i)}</span>`;
    });
    let chips = "";
    RECIPES.forEach((r) => { if (r.unlock === level && BUILDINGS[r.machine].unlock < level) chips += `<span class="chip2">${recipeIc(r)}${recipeName(r)}</span>`; });
    if (level === UNLOCK_CLAIMS) chips += `<span class="chip2">${t("ui.claim")}</span>`;
    if (level === UNLOCK_UPGRADES) chips += `<span class="chip2">${t("ui.upgrades")}</span>`;
    if (level === UNLOCK_RELOCATE) chips += `<span class="chip2">${t("ui.relocate")}</span>`;
    return rich ? h + (chips ? `<div class="chips">${chips}</div>` : "") : h + chips;
  }

  private inventoryHtml(g: Game): string {
    let h = "";
    for (let i = 0; i < ITEM_COUNT; i++) if (g.total[i] > 0) h += `<span class="inv" title="${esc(itemName(i))}">${itemIc(i)}<b data-k="stock:${i}"></b></span>`;
    return h ? `<h3>${t("ui.stock")}</h3><div class="invs">${h}</div>` : "";
  }

  private voiceLine(g: Game): string { return t(g.level <= LEVELS.length ? "v." + g.level : "v.end"); }

  private goalsHtml(g: Game): [string, string] {
    const goal = levelGoal(g.level);
    let h = `<p class="sub">${this.voiceLine(g)}</p>`;
    for (const [i, n] of goal.need) {
      h += `<div class="req">${itemIc(i)}<div class="reqm"><div class="reqt"><span>${itemName(i)}</span><span><b data-k="stock:${i}"></b> / ${fmt(n)} <small data-k="rate:${i}"></small></span></div><div class="bar"><span data-k="prog:${i}:${n}" data-m="w"></span></div></div></div>`;
    }
    const cores = levelCores(g.level);
    h += `<div class="row"><span>${t("ui.reward")}</span><span class="corev">${ICON.core}${cores}</span></div>`;
    const un = this.unlocksHtml(g.level + 1, false);
    if (un) h += `<h3>${t("ui.unlocks")}</h3><div class="chips">${un}</div>`;
    h += `<div class="stats"><div><span>${t("ui.output")}</span><b data-k="output"></b></div><div><span>${t("ui.best")}</span><b data-k="best"></b></div></div>`;
    h += this.inventoryHtml(g);
    this.dyn = () => ({ output: fmt(g.output()), best: fmt(g.bestOutput) });
    return [`${t("ui.level")} ${g.level}`, h];
  }

  private upgradesHtml(g: Game): [string, string] {
    let h = `<div class="row big"><span>${t("ui.cores")}</span><span class="corev">${ICON.core}<b data-k="cores"></b></span></div>`;
    if (g.maxLevel < UNLOCK_UPGRADES) h += `<p class="sub">${t("ui.upLocked")}</p>`;
    else {
      for (const tr of TRACKS) {
        const tier = g.tiers[tr], st = g.canBuy(tr);
        h += `<div class="track"><div class="trm"><b>${t("u." + tr)}</b><span>${t("u." + tr + ".d")}</span><span class="trv">${trackText(tr, tier)}${st === "max" ? "" : ` <em>&gt; ${trackText(tr, tier + 1)}</em>`}</span></div>`;
        h += st === "max" ? `<span class="maxed">${t("ui.max")}</span>` : `<button class="btn buy" data-act="buy" data-t="${tr}" data-k="buy:${tr}" data-m="d">${ICON.core}${trackCost(tier)}</button>`;
        h += `</div>`;
      }
    }
    // Relocation
    const gain = beaconsFor(g.level);
    h += `<h3>${t("ui.relocate")}</h3><p class="sub">${t("ui.relocateD")}</p><p class="sub">${t("ui.relocateEach")}</p>`;
    h += `<div class="row"><span>${t("ui.relocateHave")}</span><span class="corev beacon">${ICON.beacon}${g.beacons}${g.beacons ? ` <em>+${Math.round(g.beacons * BEACON_BONUS * 100)}%</em>` : ""}</span></div>`;
    if (g.canRelocate()) h += `<div class="row"><span>${t("ui.relocateGain")}</span><span class="corev beacon">${ICON.beacon}+${gain}</span></div><div class="row end"><button class="btn danger" data-act="relocate">${t("ui.relocateBtn")}</button></div>`;
    else h += `<p class="sub">${t("ui.relocateLocked")}</p>`;
    this.dyn = () => {
      const o: Record<string, string | boolean> = { cores: fmt(g.cores) };
      for (const tr of TRACKS) o["buy:" + tr] = g.canBuy(tr) === "ready";
      return o;
    };
    return [t("ui.upgrades"), h];
  }

  private powerHtml(): [string, string] {
    this.dyn = () => {
      const g = this.app.game;
      return { supply: fmt(g.supply) + " kW", demand: fmt(g.demand) + " kW", sat: t("ui.sat", { p: Math.round(g.sat * 100) }) };
    };
    return [t("ui.power"), `<div class="stats"><div><span>${t("ui.supply")}</span><b data-k="supply"></b></div><div><span>${t("ui.demand")}</span><b data-k="demand"></b></div></div><p class="sub" data-k="sat"></p>`];
  }

  private menuHtml(): [string, string] {
    const s = this.app.settings, g = this.app.game;
    this.dyn = () => ({ time: fmtTime(this.app.game.time), best: fmt(this.app.game.bestOutput) });
    const touch = matchMedia("(pointer: coarse)").matches;
    return [t("ui.menu"), `
      <div class="stats"><div><span>${t("ui.time")}</span><b data-k="time"></b></div><div><span>${t("ui.best")}</span><b data-k="best"></b></div>
      <div><span>${t("ui.bestLevel")}</span><b>${g.maxLevel}</b></div><div><span>${t("ui.site")}</span><b>${g.world.seed + 1}</b></div></div>
      <div class="row"><span>${t("ui.sound")}</span><button class="btn" data-act="sound">${s.sound ? t("ui.on") : t("ui.off")}</button></div>
      <div class="row"><span>${t("ui.lang")}</span><button class="btn" data-act="lang">${s.lang === "de" ? "Deutsch" : "English"}</button></div>
      <h3>${t("ui.controls")}</h3><p class="sub">${t("ui.controlsTouch")}</p>${touch ? "" : `<p class="sub">${t("ui.controlsKeys")}</p>`}
      <div class="row end"><button class="btn danger" data-act="reset">${t("ui.reset")}</button></div>`];
  }

  private claimHtml(g: Game): [string, string] {
    if (g.maxLevel < UNLOCK_CLAIMS) return [t("ui.claim"), `<p class="sub">${t("ui.claimLocked")}</p>`];
    this.dyn = () => ({ claim: g.claimState(this.claimKey) === "ready" });
    return [t("ui.claim"), `<p class="sub">${t("ui.claimD")}</p><div class="row"><span class="costs">${costHtml(claimCost(g.claims))}</span><button class="btn primary" data-act="claim" data-k="claim" data-m="d">${t("ui.claimBtn")}</button></div>${this.inventoryHtml(g)}`];
  }

  private status(g: Game, e: Ent): string {
    switch (e.kind) {
      case "crafter": {
        if (e.recipe < 0) return t("ui.noRecipe");
        if (e.working) return g.sat < 0.999 ? t("ui.status.power") : t("ui.status.work");
        const r = RECIPES[e.recipe];
        const full = (r.out && e.out + r.out[1] > Math.max(4, r.out[1] * 2)) || (r.fout && e.fout + r.fout[1] > r.fout[1] * 3);
        return full ? t("ui.status.full") : t("ui.status.wait");
      }
      case "drill": case "scoop": case "well": return e.active ? (g.sat < 0.999 ? t("ui.status.power") : t("ui.status.work")) : t("ui.status.full");
      case "burner": case "turbine": case "fusion": case "reactor": return e.active ? t("ui.status.work") : t("ui.status.fuel");
      case "pad": return e.launchT >= 0 ? t("ui.status.work") : t("ui.status.wait");
      case "driver": return e.next ? t("ui.status.ok") : t("ui.status.link");
      default: return "";
    }
  }

  private infoHtml(g: Game, e: Ent): [string, string] {
    const def = BUILDINGS[e.t];
    let h = `<p class="sub">${t("b." + def.id + ".d")}</p>`;
    const dyn: (() => Record<string, string | number | boolean>)[] = [];
    const gen = def.cat === "power" && e.kind !== "lamp";
    if (["crafter", "drill", "scoop", "well", "burner", "turbine", "fusion", "reactor", "pad", "driver"].includes(e.kind)) {
      const kw = gen ? `+${fmt(def.power * trackValue("power", g.tiers.power))} kW` : def.power ? `${def.power} kW` : "";
      h += `<div class="status"><span class="led" data-k="led" data-m="c"></span><span data-k="status"></span><em>${kw}</em></div>`;
      dyn.push(() => ({ status: this.status(g, e), led: e.kind === "driver" ? !e.next : !e.active && e.launchT < 0 }));
    }
    if (e.kind === "solar") h += `<div class="status"><span class="led"></span><span>${t("ui.status.work")}</span><em>+${fmt(def.power * trackValue("power", g.tiers.power))} kW</em></div>`;
    if (e.kind === "crafter") {
      const list = RECIPES_BY_MACHINE[e.t].filter((r) => g.recipeUnlocked(r));
      const mul = trackValue("craft", g.tiers.craft) * (1 + g.beacons * BEACON_BONUS);
      h += `<div class="bar thin"><span data-k="prog" data-m="w"></span></div>`;
      dyn.push(() => ({ prog: e.working ? e.prog * 100 : 0 }));
      if (list.length > 1) h += `<h3>${t("ui.recipe")}</h3>`;
      h += `<div class="recipes">`;
      for (const ri of list) {
        const r = RECIPES[ri];
        h += `<button class="rc${e.recipe === ri ? " on" : ""}" data-act="recipe" data-i="${ri}"><b>${recipeName(r)}</b>${recipeHtml(r, mul)}</button>`;
      }
      h += `</div>`;
    } else if (e.kind === "drill" || e.kind === "scoop") {
      const per = (e.kind === "scoop" ? 20.4 : 30 * e.mult) * trackValue("drill", g.tiers.drill) * (1 + g.beacons * BEACON_BONUS);
      h += `<div class="row"><span>${t("ui.mine")}</span><span class="rq">${itemIc(e.item)}${itemName(e.item)} · ${fmt(per)}${t("ui.perMin")}</span></div>`;
    } else if (e.kind === "sorter") {
      h += `<h3>${t("ui.filter")}</h3><div class="filters"><button class="fbtn txt${e.filter < 0 ? " on" : ""}" data-act="filter" data-i="-1">${t("ui.filterNone")}</button>`;
      for (let i = 0; i < ITEM_COUNT; i++) {
        if (g.total[i] > 0 || e.filter === i || i < 2) h += `<button class="fbtn${e.filter === i ? " on" : ""}" data-act="filter" data-i="${i}" title="${esc(itemName(i))}">${itemIc(i)}</button>`;
      }
      h += `</div>`;
    } else if (e.kind === "hub") {
      h += this.inventoryHtml(g);
    } else if (e.kind === "crate") {
      h += `<div class="row"><span>${t("ui.holds")}</span><span class="rq"><b data-k="cn"></b> / ${CRATE_CAP}</span></div><div class="bar thin"><span data-k="cw" data-m="w"></span></div>`;
      dyn.push(() => ({ cn: e.n > 0 ? `${itemName(e.a)} ${e.n}` : t("ui.empty"), cw: (e.n / CRATE_CAP) * 100 }));
    } else if (e.kind === "pad") {
      h += `<div class="row"><span>${t("ui.payload")}</span><span class="rq" data-k="payload"></span></div><div class="row"><span>${itemName(I.canister)}</span><span class="rq">${itemIc(I.canister)}<b data-k="p1"></b> / 8</span></div>`;
      h += `<div class="chips">${Object.keys(PAD_POINTS).map((k) => `<span class="chip2">${itemIc(Number(k))}${itemName(Number(k))} +${PAD_POINTS[Number(k)]}</span>`).join("")}</div>`;
      h += `<div class="row"><span>${t("ui.nextCore")}</span><span><b data-k="pts"></b> / ${LAUNCH_POINTS_PER_CORE}</span></div><div class="bar thin"><span data-k="ptw" data-m="w"></span></div><div class="row"><span>${t("ui.launches")}</span><b data-k="launches"></b></div>`;
      dyn.push(() => ({ payload: e.a >= 0 ? itemName(e.a) : e.launchT >= 0 ? itemName(e.b) : "-", p1: e.inBuf[0], pts: g.launchPts, ptw: (g.launchPts / LAUNCH_POINTS_PER_CORE) * 100, launches: fmt(g.launches) }));
    } else if (e.kind === "burner" || e.kind === "reactor") {
      const item = e.kind === "burner" ? I.carbon : I.fuel_rod, secs = e.kind === "burner" ? BURNER_SECONDS : ROD_SECONDS;
      h += `<div class="row"><span>${t("ui.uses")}</span><span class="rq">${itemIc(item)}<b data-k="fuel"></b> / 5${e.kind === "reactor" ? ` + ${fluidIc(5)}${fluidName(5)}` : ""}</span></div><div class="bar thin"><span data-k="burn" data-m="w"></span></div>`;
      dyn.push(() => ({ fuel: e.inBuf[0], burn: Math.min(100, (e.fuel / secs) * 100) }));
    } else if (e.kind === "turbine" || e.kind === "fusion") {
      const f = e.kind === "turbine" ? 1 : 3;
      h += `<div class="row"><span>${t("ui.uses")}</span><span class="rq">${fluidIc(f)}${fluidName(f)}</span></div>`;
    } else if (e.kind === "well") {
      h += `<div class="row"><span>${t("ui.gives")}</span><span class="rq">${fluidIc(3)}${fluidName(3)}</span></div>`;
    } else if (e.kind === "pipe" || e.kind === "tank") {
      h += `<div class="row"><span data-k="fluid"></span><span><b data-k="vol"></b> / <span data-k="cap"></span></span></div><div class="bar thin"><span data-k="volw" data-m="w"></span></div>`;
      dyn.push(() => {
        const net = e.net;
        if (!net) return { fluid: t("ui.empty"), vol: 0, cap: e.kind === "tank" ? TANK_CAP : PIPE_CAP, volw: 0 };
        return { fluid: net.type < 0 ? t("ui.empty") : fluidName(net.type), vol: fmt(net.vol), cap: fmt(net.cap), volw: (net.vol / net.cap) * 100 };
      });
    }
    h += `<div class="actions">`;
    if (!["pipe", "tank", "hub", "pad", "solar", "lamp", "trash", "cross", "reactor", "fusion", "well", "burner", "turbine"].includes(e.kind)) h += `<button class="btn" data-act="rotate">${ICON.rotate}${t("ui.rotate")}</button>`;
    if (e.kind === "pipe" || e.kind === "tank") h += `<button class="btn" data-act="drain">${t("ui.drain")}</button>`;
    if (def.cat) h += `<button class="btn" data-act="copy">${ICON.copy}${t("ui.copy")}</button>`;
    if (e.kind !== "hub") h += `<button class="btn danger" data-act="remove">${ICON.erase}${t("ui.delete")}</button>`;
    h += `</div>`;
    this.dyn = () => Object.assign({}, ...dyn.map((f) => f()));
    return [`${bIc(e.t)}${bName(e.t)}`, h];
  }

  private onSheet(ev: Event): void {
    const el = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
    if (!el) return;
    const g = this.app.game, sel = this.app.view.sel;
    const i = Number(el.dataset.i);
    switch (el.dataset.act) {
      case "close": sfx("tap"); this.close(); break;
      case "recipe": if (sel) { g.setRecipe(sel, i); sfx("tap"); this.open("info"); } break;
      case "filter": if (sel) { sel.filter = i; sfx("tap"); this.open("info"); } break;
      case "rotate": this.app.rotate(); break;
      case "copy": this.app.copySel(); break;
      case "remove": this.app.removeSel(); break;
      case "drain": if (sel) { g.drain(sel); sfx("remove"); } break;
      case "buy": if (g.buy(el.dataset.t as Track)) this.open("upgrades"); else sfx("error"); break;
      case "claim": if (g.claim(this.claimKey)) this.close(); else sfx("error"); break;
      case "sound": this.app.settings.sound = !this.app.settings.sound; this.app.applySettings(); sfx("tap"); break;
      case "lang": this.app.settings.lang = getLang() === "de" ? "en" : "de"; this.app.applySettings(); break;
      case "reset":
        sfx("tap");
        this.showModal(`<h2>${t("ui.reset")}</h2><p>${t("ui.resetAsk")}</p><div class="mrow"><button class="btn" data-act="closeModal">${t("ui.no")}</button><button class="btn danger" data-act="resetYes">${t("ui.resetYes")}</button></div>`);
        break;
      case "relocate":
        sfx("tap");
        this.showModal(`<h2>${t("ui.relocateAsk")}</h2><p>${t("ui.relocateD")}</p><div class="row"><span>${t("ui.relocateGain")}</span><span class="corev beacon">${ICON.beacon}+${beaconsFor(g.level)}</span></div><div class="mrow"><button class="btn" data-act="closeModal">${t("ui.no")}</button><button class="btn danger" data-act="relocateYes">${t("ui.relocateBtn")}</button></div>`);
        break;
    }
  }

  // ---------- Live values ----------
  private apply(): void {
    if (!this.kind) return;
    const g = this.app.game;
    const vals = this.dyn ? this.dyn() : {};
    this.sheet.querySelectorAll<HTMLElement>("[data-k]").forEach((el) => {
      const k = el.dataset.k!;
      let v: string | number | boolean | undefined = vals[k];
      if (v === undefined) {
        const p = k.split(":");
        const item = Number(p[1]);
        if (p[0] === "stock") v = fmt(g.stock[item]);
        else if (p[0] === "has") v = g.stock[item] < Number(p[2]);
        else if (p[0] === "prog") v = Math.min(100, (g.stock[item] / Number(p[2])) * 100);
        else if (p[0] === "rate") { const r = g.itemRate(item); v = r ? `+${fmt(r)}${t("ui.perMin")}` : ""; }
        else return;
      }
      switch (el.dataset.m) {
        case "w": el.style.width = v + "%"; break;
        case "d": (el as HTMLButtonElement).disabled = !v; break;
        case "c": el.classList.toggle("miss", !!v); break;
        default: { const s = String(v); if (el.textContent !== s) el.textContent = s; }
      }
    });
  }

  /** A few times a second. */
  refresh(): void {
    const g = this.app.game;
    const goal = $("goal");
    const need = levelGoal(g.level).need;
    let sum = 0;
    for (const [i, n] of need) sum += Math.min(1, g.stock[i] / n);
    (goal.querySelector(".gnum") as HTMLElement).textContent = String(g.level);
    (goal.querySelector(".gt") as HTMLElement).innerHTML = need.map(([i, n]) => `${itemIc(i)}<span class="${g.stock[i] >= n ? "ok" : ""}">${fmt(Math.min(g.stock[i], n))}/${fmt(n)}</span>`).join("");
    (goal.querySelector(".bar span") as HTMLElement).style.width = (sum / need.length) * 100 + "%";
    const pw = $("power");
    (pw.querySelector(".pw") as HTMLElement).textContent = `${fmt(g.demand)}/${fmt(g.supply)}`;
    pw.classList.toggle("low", g.sat < 0.999);
    const cb = $("cores");
    cb.hidden = g.maxLevel < UNLOCK_UPGRADES && g.cores === 0;
    if (g.cores !== this.shownCores) {
      if (this.shownCores >= 0 && g.cores > this.shownCores) { cb.classList.remove("bump"); void cb.offsetWidth; cb.classList.add("bump"); }
      this.shownCores = g.cores;
      (cb.querySelector(".cn") as HTMLElement).textContent = fmt(g.cores);
    }
    (cb.querySelector(".dot") as HTMLElement).hidden = !TRACKS.some((tr) => g.canBuy(tr) === "ready");
    this.apply();
  }

  /** The voice line: typed out letter by letter, shown for a while after it changes. */
  say(text: string, sticky: boolean): void {
    const now = performance.now();
    if (text !== this.voiceText) {
      this.voiceText = text;
      clearInterval(this.voiceTimer);
      const el = this.voice.querySelector(".vt") as HTMLElement;
      el.textContent = "";
      let n = 0;
      this.voiceTimer = window.setInterval(() => {
        n += 2;
        el.textContent = text.slice(0, n);
        if (n % 6 === 0) sfx("type");
        if (n >= text.length) clearInterval(this.voiceTimer);
      }, 28);
      this.voiceUntil = now + 9000 + text.length * 40;
    }
    this.voice.hidden = !text || (!sticky && now > this.voiceUntil) || this.isOpen() || !this.title.hidden;
  }

  toast(text: string): void {
    const now = performance.now();
    if (text === this.lastToast && now - this.lastToastAt < 2500) return;
    this.lastToast = text;
    this.lastToastAt = now;
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild!.remove();
    setTimeout(() => el.remove(), 2800);
  }

  private showModal(html: string): void {
    this.modal.innerHTML = `<div class="card">${html}</div>`;
    this.modal.hidden = false;
  }

  /** A level was completed: banner always, a card when something new is cleared for use. */
  levelUp(level: number, cores: number): void {
    this.banner.innerHTML = `<b>${t("ui.levelUp", { n: level })}</b><span>${ICON.core}${t(cores === 1 ? "ui.core1" : "ui.coreN", { n: cores })}</span>`;
    this.banner.hidden = false;
    this.banner.classList.remove("show");
    void this.banner.offsetWidth;
    this.banner.classList.add("show");
    setTimeout(() => { this.banner.hidden = true; }, 3200);
    const un = this.unlocksHtml(level, true);
    // Only when this level is reached for the first time: after relocating everything is cleared already.
    if (un && level === this.app.game.maxLevel && level <= LEVELS.length + 1) {
      this.showModal(`<div class="kicker">${t("ui.levelUp", { n: level })}</div><h2>${t("ui.new")}</h2>${un}<button class="btn primary wide" data-act="closeModal">${t("ui.ok")}</button>`);
    }
    this.renderTray();
    if (this.kind) this.open(this.kind);
  }

  awayReport(a: Away): void {
    const rows = a.gains.slice().sort((x, y) => y[1] - x[1]).slice(0, 12).map(([i, n]) => `<span class="inv">${itemIc(i)}<b>+${fmt(n)}</b></span>`).join("");
    this.showModal(`<div class="kicker">${t("ui.away")}</div><p>${t("ui.awayD", { t: fmtTime(a.seconds) })}</p><div class="invs">${rows}</div><button class="btn primary wide" data-act="closeModal">${t("ui.ok")}</button>`);
  }

  voiceFor(g: Game): string { return this.voiceLine(g); }
}
