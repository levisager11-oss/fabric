// Small synthesised sound effects: square and triangle waves, in keeping with the pixels.
let ctx: AudioContext | null = null;
let enabled = true;
const lastAt: Record<string, number> = {};

export function setSound(on: boolean): void { enabled = on; }

/** Browsers only allow sound after the player touched the page. */
export function unlockAudio(): void {
  if (!enabled) return;
  try {
    if (!ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === "suspended") void ctx.resume();
  } catch { /* no sound on this device */ }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slide = 0): void {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noiseBurst(dur: number, vol: number, from: number, to: number): void {
  if (!ctx) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(from, ctx.currentTime);
  f.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
  src.connect(f).connect(g).connect(ctx.destination);
  src.start();
}

export type Sfx =
  | "place" | "remove" | "error" | "tap" | "rotate" | "level" | "launch" | "upgrade" | "claim" | "type" | "core"
  | "shot" | "land" | "craft" | "unlock";

/** pitch lets a run of the same sound climb, as when a belt is dragged out tile by tile. */
export function sfx(name: Sfx, pitch = 1): void {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const now = performance.now();
  const gap = name === "craft" ? 140 : name === "type" ? 50 : name === "land" || name === "shot" ? 110 : 40;
  if (now - (lastAt[name] ?? 0) < gap) return;
  lastAt[name] = now;
  switch (name) {
    case "place": tone(330 * pitch, 0.06, "square", 0.045); tone(495 * pitch, 0.07, "triangle", 0.07, 0.03); noiseBurst(0.05, 0.04, 900, 300); break;
    case "remove": tone(220, 0.09, "square", 0.04, 0, -110); noiseBurst(0.09, 0.05, 500, 150); break;
    case "error": tone(110, 0.16, "square", 0.045); break;
    case "tap": tone(660, 0.035, "square", 0.03); break;
    case "rotate": tone(392, 0.05, "square", 0.035, 0, 180); break;
    case "type": tone(880 + Math.random() * 80, 0.018, "square", 0.012); break;
    case "craft": tone(1318, 0.03, "triangle", 0.012); break;
    case "shot": tone(520, 0.12, "square", 0.02, 0, 600); break;
    case "land": tone(180, 0.06, "triangle", 0.03, 0, -60); break;
    case "core": tone(1047, 0.1, "square", 0.04); tone(1568, 0.22, "square", 0.04, 0.08); break;
    case "upgrade": [392, 523, 659, 1047].forEach((f, i) => tone(f, 0.12, "square", 0.04, i * 0.06)); break;
    case "unlock": tone(523, 0.1, "triangle", 0.06); tone(784, 0.18, "triangle", 0.06, 0.09); break;
    case "claim": noiseBurst(0.5, 0.06, 200, 1600); [262, 392, 523].forEach((f, i) => tone(f, 0.2, "square", 0.04, i * 0.1)); break;
    case "level":
      [392, 523, 659, 784, 1047].forEach((f, i) => { tone(f, 0.22, "square", 0.045, i * 0.09); tone(f / 2, 0.22, "triangle", 0.06, i * 0.09); });
      tone(1568, 0.5, "square", 0.035, 0.5);
      noiseBurst(0.35, 0.05, 2000, 400);
      break;
    case "launch": noiseBurst(1.8, 0.14, 250, 2600); tone(70, 1.6, "sawtooth", 0.05, 0, 300); break;
  }
}
