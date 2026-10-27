import { drawGlow, drawSphere, ring } from "../../core/glowSprites";
import { hash, smoothstep } from "./cloud";
import { FUSION_START, stateAt, STORY_DURATION } from "./timeline";

/**
 * The view inside the core, shown in an inset. It is drawn in its own CORE_W × CORE_H frame (the
 * caller sets the transform and clip). Before fusion, hot protons crowd in and speed up as the core
 * heats, but pairs that meet bounce apart: their electric repulsion wins. From FUSION_START one
 * proton–proton chain plays out at the centre (p + p → D, D + p → ³He, ³He + ³He → ⁴He), then
 * fusions flash all over as the core settles into steady burning. Everything is a function of
 * story time. Nuclei are drawn enormously enlarged.
 */

export const CORE_W = 960;
export const CORE_H = 540;
/** Real width of the inset's field of view: a few times the spacing of nuclei in the core. */
export const CORE_FIELD_M = 1e-9;
const CX = CORE_W / 2;
const CY = CORE_H / 2;
const R = 22;
/** How much larger than life the nuclei are drawn (a proton's radius is ~0.84 × 10⁻¹⁵ m). */
export const NUCLEUS_ENLARGEMENT = (R * CORE_FIELD_M) / CORE_W / 0.84e-15;
const PROTON = "#ff8a5c";
const NEUTRON = "#b9c6dc";
const POSITRON = "#ff3fd0";
const PROTONS = 60;
const ELECTRONS = 90;

type Pt = [number, number];

function lerp(a: Pt, b: Pt, f: number): Pt {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** Position along a path of [time, point] keys, eased between keys. */
function along(keys: [number, Pt][], t: number): Pt {
  if (t <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i][0]) {
      const f = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return lerp(keys[i - 1][1], keys[i][1], f * f * (3 - 2 * f));
    }
  }
  return keys[keys.length - 1][1];
}

function nucleus(ctx: CanvasRenderingContext2D, x: number, y: number, members: boolean[], r: number, spin: number, alpha: number): void {
  const n = members.length;
  const spread = n === 1 ? 0 : r * (n === 2 ? 0.85 : 1.05);
  members.forEach((neutron, i) => {
    const a = spin + (i * 2 * Math.PI) / n;
    drawSphere(ctx, neutron ? NEUTRON : PROTON, x + Math.cos(a) * spread, y + Math.sin(a) * spread * 0.8, r, alpha);
  });
}

function flash(ctx: CanvasRenderingContext2D, x: number, y: number, age: number, size: number, color: string): void {
  if (age < 0 || age > 0.8) {
    return;
  }
  const f = age / 0.8;
  drawGlow(ctx, color, x, y, size * (0.5 + 1.6 * f), (1 - f) ** 1.5, 0.3);
  ring(ctx, color, x, y, size * (0.4 + 2.2 * f), (1 - f) * 0.7, 2);
}

function streak(ctx: CanvasRenderingContext2D, from: Pt, angle: number, length: number, color: string, alpha: number): void {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(from[0] + Math.cos(angle) * length, from[1] + Math.sin(angle) * length);
  ctx.stroke();
}

/**
 * Thermal speed grows as √T. The particles' travel is the running integral of that speed, so they
 * speed up smoothly as the core heats instead of jumping when the temperature changes.
 */
const PACE_STEP = 0.05;
let paceTable: Float64Array | null = null;

function travelled(story: number): number {
  if (!paceTable) {
    const n = Math.ceil(STORY_DURATION / PACE_STEP) + 2;
    paceTable = new Float64Array(n);
    for (let i = 1; i < n; i += 1) {
      const t = stateAt((i - 0.5) * PACE_STEP).coreTempK;
      paceTable[i] = paceTable[i - 1] + PACE_STEP * Math.min(1.15, Math.max(0.3, Math.sqrt(t / 1.5e7)));
    }
  }
  const x = Math.max(0, story) / PACE_STEP;
  const i = Math.min(paceTable.length - 2, Math.floor(x));
  return paceTable[i] + (paceTable[i + 1] - paceTable[i]) * (x - i);
}

/** Before fusion: pairs of protons meet, slow and turn back (their repulsion wins), every few seconds. */
const BOUNCE_FIRST = 58.6;
const BOUNCE_EVERY = 2.8;
const BOUNCE_LENGTH = 2.2;

function drawBounces(ctx: CanvasRenderingContext2D, story: number, vis: number, logT: number): void {
  // Hotter protons push in closer before turning back.
  const closeness = smoothstep(6.2, 7, logT);
  const gap = 46 + 110 * (1 - closeness);
  for (let k = 0; ; k += 1) {
    const start = BOUNCE_FIRST + k * BOUNCE_EVERY;
    if (start > FUSION_START - 1.4) {
      break;
    }
    const tau = (story - start) / BOUNCE_LENGTH;
    if (tau < 0 || tau > 1) {
      continue;
    }
    const cx = CX + (hash(k, 101) - 0.5) * 320;
    const cy = CY + (hash(k, 102) - 0.5) * 170;
    const phi = hash(k, 103) * Math.PI;
    // Separation shrinks, stops, and grows again: the shape of a head-on bounce off a repulsion.
    const d = gap + (420 - gap) * (2 * tau - 1) ** 2;
    const dx = (Math.cos(phi) * d) / 2;
    const dy = (Math.sin(phi) * d) / 2;
    const fade = Math.sqrt(Math.sin(Math.PI * tau)) * vis;
    drawSphere(ctx, PROTON, cx - dx, cy - dy, R, fade);
    drawSphere(ctx, PROTON, cx + dx, cy + dy, R, fade);
    const near = 1 - Math.min(1, Math.abs(tau - 0.5) / 0.14);
    if (near > 0) {
      drawGlow(ctx, "#ffd3b8", cx, cy, 26 + 14 * near, 0.35 * near * vis, 0.4);
    }
  }
}

/**
 * The same three steps happening all around the hero chain, smaller and dimmer: pairs of nuclei
 * close in, fuse with a flash, and the product drifts off. Each reaction k starts at a fixed time
 * and place, so scrubbing and export stay exact.
 */
const BG_SCALE = 0.55;
const BG_APPROACH = 1.2;
const BG_AFTER = 1.5;
const BG_STEPS: { a: boolean[]; b: boolean[]; product: boolean[]; spares: number; color: string }[] = [
  { a: [false], b: [false], product: [false, true], spares: 0, color: "#fff2d6" },
  { a: [false, true], b: [false], product: [false, false, true], spares: 0, color: "#e6f0ff" },
  { a: [false, false, true], b: [false, true, false], product: [false, true, false, true], spares: 2, color: "#ffe2b8" }
];

function drawBackgroundFusions(ctx: CanvasRenderingContext2D, t: number, vis: number, gentle: boolean): void {
  const every = gentle ? 1.6 : 0.75;
  const first = 0.6;
  const r = R * BG_SCALE;
  const newest = Math.floor((t - first) / every);
  for (let k = Math.max(0, newest - 6); k <= newest; k += 1) {
    const start = first + k * every + hash(k, 201) * every * 0.6;
    const age = t - start;
    if (age < 0 || age > BG_APPROACH + BG_AFTER) {
      continue;
    }
    const step = BG_STEPS[k % BG_STEPS.length];
    // Somewhere around the centre, never on top of the hero chain.
    let cx = 70 + hash(k, 202) * (CORE_W - 140);
    let cy = 60 + hash(k, 203) * (CORE_H - 120);
    const off = Math.hypot(cx - CX, cy - CY);
    if (off < 190) {
      const push = 190 / Math.max(1, off);
      cx = CX + (cx - CX) * push;
      cy = CY + (cy - CY) * push;
    }
    const phi = hash(k, 204) * Math.PI * 2;
    const ux = Math.cos(phi);
    const uy = Math.sin(phi);
    const depth = 0.6 + 0.4 * hash(k, 205);
    if (age < BG_APPROACH) {
      const f = age / BG_APPROACH;
      const sep = 230 * (1 - f * f * (3 - 2 * f)) + r * 1.4;
      const fade = Math.min(1, f * 4) * vis * 0.75 * depth;
      nucleus(ctx, cx - (ux * sep) / 2, cy - (uy * sep) / 2, step.a, r, age * 1.4 + k, fade);
      nucleus(ctx, cx + (ux * sep) / 2, cy + (uy * sep) / 2, step.b, r, -age * 1.2 - k, fade);
    } else {
      const after = age - BG_APPROACH;
      const f = after / BG_AFTER;
      const fade = (1 - f) * vis * 0.75 * depth;
      flash(ctx, cx, cy, after, 24 * depth, step.color);
      const drift = 60 * f;
      nucleus(ctx, cx - uy * drift, cy + ux * drift, step.product, r, after * 0.9 + k, fade);
      for (let q = 0; q < step.spares; q += 1) {
        const side = q === 0 ? 1 : -1;
        drawSphere(ctx, PROTON, cx + ux * side * 220 * f, cy + uy * side * 220 * f, r, fade);
      }
    }
  }
}

/**
 * Draws the core view in its local frame (additively over a dark backing the caller provides) and
 * returns the line of text to show under it.
 */
export function drawCoreView(ctx: CanvasRenderingContext2D, story: number, vis: number, gentle: boolean, coreTempK: number): string | null {
  if (vis <= 0) {
    return null;
  }
  const t = story - FUSION_START;
  const logT = Math.log10(coreTempK);
  const heat = smoothstep(4.5, 8.5, t);
  const warmth = smoothstep(6, 7.2, logT);
  const distance = travelled(story);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // Hot plasma glow: dull red while the core heats, bright orange once fusion takes hold.
  const g = ctx.createRadialGradient(CX, CY, 30, CX, CY, CORE_W * 0.7);
  g.addColorStop(0, `rgba(255, ${Math.round(110 + 60 * warmth)}, ${Math.round(60 + 30 * warmth)}, ${(0.18 + 0.2 * warmth + 0.3 * heat) * vis})`);
  g.addColorStop(1, `rgba(150, 50, 20, ${(0.1 + 0.08 * warmth + 0.2 * heat) * vis})`);
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CORE_W, CORE_H);

  // Protons and electrons stream past in straight lines, wrapping at the edges. More of them
  // crowd in as mass piles onto the star, and all of them speed up as it heats.
  const crowd = 26 + (PROTONS - 26) * smoothstep(56, 68, story);
  for (let i = 0; i < PROTONS; i += 1) {
    const present = Math.min(1, Math.max(0, crowd - i));
    if (present <= 0) {
      continue;
    }
    const speed = 160 + 220 * hash(i, 1);
    const a = hash(i, 2) * Math.PI * 2;
    const x = (((hash(i, 3) * CORE_W + Math.cos(a) * speed * distance) % CORE_W) + CORE_W) % CORE_W;
    const y = (((hash(i, 4) * CORE_H + Math.sin(a) * speed * distance) % CORE_H) + CORE_H) % CORE_H;
    const depth = 0.5 + 0.5 * hash(i, 5);
    const alpha = vis * depth * present;
    streak(ctx, [x, y], a + Math.PI, 26 * depth * (0.5 + 0.5 * warmth), "#ffb48a", 0.25 * alpha);
    drawSphere(ctx, PROTON, x, y, 9 * depth, 0.55 * alpha);
  }
  for (let i = 0; i < ELECTRONS; i += 1) {
    const speed = 500 + 400 * hash(i, 11);
    const a = hash(i, 12) * Math.PI * 2;
    const x = (((hash(i, 13) * CORE_W + Math.cos(a) * speed * distance) % CORE_W) + CORE_W) % CORE_W;
    const y = (((hash(i, 14) * CORE_H + Math.sin(a) * speed * distance) % CORE_H) + CORE_H) % CORE_H;
    drawGlow(ctx, "#a6dcff", x, y, 5, 0.5 * vis, 0.45);
  }

  let label: string | null = null;
  if (t < 0) {
    drawBounces(ctx, story, vis, logT);
    label = logT < 6.85 ? "too cold: protons repel each other" : "nearly 10 million K: they get closer";
    ctx.restore();
    return label;
  }

  // The hero chain at the centre.
  // Step 1 (t 0–1.5): two protons meet → deuterium + positron + neutrino.
  const p1 = along([[0, [CX - 700, CY - 120]], [1.5, [CX - 18, CY]]], t);
  const p2 = along([[0, [CX + 720, CY + 160]], [1.5, [CX + 18, CY]]], t);
  if (t < 1.5) {
    drawSphere(ctx, PROTON, p1[0], p1[1], R, vis);
    drawSphere(ctx, PROTON, p2[0], p2[1], R, vis);
    label = "10 million K: protons hit hard enough to fuse";
  }
  flash(ctx, CX, CY, t - 1.5, 40, "#fff2d6");
  if (t >= 1.5) {
    const age = t - 1.5;
    // Positron and neutrino fly off.
    const pos: Pt = [CX + age * 420, CY - age * 300];
    if (age < 2.5) {
      drawGlow(ctx, POSITRON, pos[0], pos[1], 14, vis * (1 - age / 2.5), 0.5);
      ring(ctx, POSITRON, pos[0], pos[1], 7, vis * (1 - age / 2.5), 2);
      streak(ctx, [CX, CY], 2.4, age * 1400, "rgba(220, 230, 255, 1)", 0.35 * vis * Math.max(0, 1 - age / 1.2));
    }
    if (age < 2.1) {
      label = "p + p → D + e⁺ + ν";
    }
  }
  // Step 2 (t 1.5–3.6): the deuteron catches another proton → helium-3 + gamma ray.
  const d = along([[1.5, [CX, CY]], [3.5, [CX - 40, CY + 30]]], t);
  const p3 = along([[1.6, [CX - 900, CY + 380]], [3.5, [CX - 70, CY + 50]]], t);
  if (t >= 1.5 && t < 3.6) {
    nucleus(ctx, d[0], d[1], [false, true], R, t * 1.5, vis);
    if (t > 1.6) {
      drawSphere(ctx, PROTON, p3[0], p3[1], R, vis);
    }
  }
  flash(ctx, CX - 50, CY + 35, t - 3.6, 36, "#e6f0ff");
  if (t >= 3.6 && t < 4.6) {
    streak(ctx, [CX - 50, CY + 35], -0.6, (t - 3.6) * 1800, "rgba(200, 220, 255, 1)", vis * (1 - (t - 3.6)));
  }
  if (t >= 3.6 && t < 5.8) {
    label = "D + p → ³He + γ";
  }
  // Step 3 (t 3.6–5.8): two helium-3 nuclei merge → helium-4 + two protons.
  const he3a = along([[3.6, [CX - 50, CY + 35]], [5.8, [CX - 30, CY]]], t);
  const he3b = along([[3.6, [CX + 900, CY - 360]], [5.8, [CX + 30, CY]]], t);
  if (t >= 3.6 && t < 5.8) {
    nucleus(ctx, he3a[0], he3a[1], [false, false, true], R, t * 1.2, vis);
    nucleus(ctx, he3b[0], he3b[1], [false, true, false], R, -t * 1.1, vis);
  }
  flash(ctx, CX, CY, t - 5.8, 60, "#ffe2b8");
  if (t >= 5.8) {
    const age = t - 5.8;
    nucleus(ctx, CX, CY, [false, true, false, true], R, age * 0.8, vis);
    drawGlow(ctx, "#ffe3a3", CX, CY, 70, vis * 0.4, 0.4);
    // The two spare protons fly apart.
    drawSphere(ctx, PROTON, CX - age * 380, CY + age * 140, R, vis * Math.max(0, 1 - age / 3));
    drawSphere(ctx, PROTON, CX + age * 360, CY + age * 200, R, vis * Math.max(0, 1 - age / 3));
    label = age < 2 ? "³He + ³He → ⁴He + p + p" : "net: 4 protons → helium + energy (E = mc²)";
  }

  drawBackgroundFusions(ctx, t, vis, gentle);

  // Steady burning: fusions flash everywhere.
  if (heat > 0) {
    const rate = gentle ? 4 : 10;
    const now = Math.floor(t * rate);
    for (let k = now - 8; k <= now; k += 1) {
      if (k < 0) {
        continue;
      }
      const born = k / rate;
      if (hash(k, 31) > heat) {
        continue;
      }
      const x = 40 + hash(k, 32) * (CORE_W - 80);
      const y = 40 + hash(k, 33) * (CORE_H - 80);
      if (Math.hypot(x - CX, y - CY) < 120) {
        continue;
      }
      flash(ctx, x, y, t - born, 18 + 14 * hash(k, 34), "#fff0d0");
    }
  }
  ctx.restore();
  return label;
}
