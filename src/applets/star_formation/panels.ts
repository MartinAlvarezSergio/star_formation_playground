import { formatScientific, sig, superscript } from "../../core/sciFormat";
import { CORE_FIELD_M, CORE_H, CORE_W, drawCoreView, NUCLEUS_ENLARGEMENT } from "./fusion";
import { View } from "./stellar";
import { AU_M, formatSuns, LIGHT_YEAR_M, SOLAR_RADIUS_M, stateAt, StoryState } from "./timeline";

/**
 * Overlays drawn over the film (so they are in exported video too), stacked down the right edge:
 * the graph of atoms gathered and core temperature, the inset looking inside the core, and the
 * scale bar with its powers-of-ten zoom ruler.
 */

/** Scene size (see scene.ts). */
const W = 1920;
const H = 1080;
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const TEXT = "rgba(236, 233, 224, 0.95)";
const TEXT_MUTED = "rgba(214, 208, 196, 0.72)";
const GRID = "rgba(255, 255, 255, 0.1)";
const ATOMS = "#9cc8ff";
const HEAT = "#ffad66";
const CORE_ACCENT = "#ffb27a";

export type Rect = { x: number; y: number; w: number; h: number };

export type HudLayout = { graph: Rect; inset: Rect; barY: number; rulerY: number; right: number };

/** The right-hand column, lifted clear of the chapter timeline when that is shown. */
export function hudLayout(timeline: boolean): HudLayout {
  const right = W - 48;
  const rulerY = H - 44 - (timeline ? 58 : 0);
  const barY = rulerY - 46;
  const inset: Rect = { x: right - 540, y: barY - 40 - 304, w: 540, h: 304 };
  const graphTop = 196;
  return { graph: { x: right - 460, y: graphTop, w: 460, h: inset.y - 44 - graphTop }, inset, barY, rulerY, right };
}

function panel(ctx: CanvasRenderingContext2D, r: Rect, radius = 14): void {
  ctx.fillStyle = "rgba(7, 9, 16, 0.62)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  ctx.stroke();
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, align: CanvasTextAlign = "left"): void {
  ctx.font = `${font} ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
}

function triangle(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x - size, y - size * 1.2);
  ctx.lineTo(x + size, y - size * 1.2);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

// ---------- Graph: atoms piling up and the core heating ----------

/** Time axis: years since the collapse began. */
const YEARS_MIN = 2.1e5;
const YEARS_MAX = 3.5e5;
const ATOMS_MAX = 3e58;
const LOG_T_MIN = 4;
const LOG_T_MAX = 8;

function temperatureWords(tempK: number): string {
  return tempK >= 1e6 ? `${sig(tempK / 1e6)} million K` : `${sig(tempK)} K`;
}

/**
 * Two small charts sharing a time axis (two measures of different size, so never one chart with
 * two scales): atoms gathered, on a linear axis so the pile visibly grows, and core temperature,
 * on a log axis with the 10⁷ K fusion line. Each line is drawn only up to now.
 */
export function drawGrowthGraph(ctx: CanvasRenderingContext2D, s: StoryState, r: Rect): void {
  if (s.graph <= 0.01 || s.massSuns <= 0) {
    return;
  }
  ctx.save();
  ctx.globalAlpha = s.graph;
  panel(ctx, r);
  ctx.textBaseline = "alphabetic";
  const left = r.x + 62;
  const right = r.x + r.w - 22;
  const xOf = (years: number): number => left + ((Math.min(YEARS_MAX, years) - YEARS_MIN) / (YEARS_MAX - YEARS_MIN)) * (right - left);
  text(ctx, "BUILDING THE STAR", r.x + 22, r.y + 32, "600 15px", TEXT_MUTED);

  // Header, two title rows, the gap between charts and the shared axis take ~216 px; the rest is plot.
  const plotH = Math.max(60, (r.h - 216) / 2);
  const charts = [
    { title: "Atoms gathered (× 10⁵⁸)", top: r.y + 84 },
    { title: "Core temperature (K)", top: r.y + 84 + plotH + 68 }
  ];

  // History up to now, sampled along the story.
  const samples: { years: number; atoms: number; logT: number }[] = [];
  for (let story = 40; story <= s.story + 1e-6; story += 0.2) {
    const st = stateAt(story);
    samples.push({ years: st.years, atoms: st.atoms, logT: Math.log10(st.coreTempK) });
  }
  samples.push({ years: s.years, atoms: s.atoms, logT: Math.log10(s.coreTempK) });

  // Chart 1: atoms (linear).
  {
    const top = charts[0].top;
    const bottom = top + plotH;
    const yOf = (atoms: number): number => bottom - (Math.min(ATOMS_MAX, atoms) / ATOMS_MAX) * plotH;
    text(ctx, charts[0].title, r.x + 22, top - 18, "500 17px", TEXT_MUTED);
    text(ctx, `${formatScientific(s.atoms)} · ${formatSuns(s.massSuns)}`, right, top - 18, "650 21px", TEXT, "right");
    ctx.lineWidth = 1;
    for (const k of [0, 1, 2, 3]) {
      const y = Math.round(yOf(k * 1e58)) + 0.5;
      ctx.strokeStyle = k === 0 ? "rgba(255, 255, 255, 0.28)" : GRID;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      text(ctx, String(k), left - 10, y + 5, "400 14px", TEXT_MUTED, "right");
    }
    drawLine(ctx, samples.map((p) => [xOf(p.years), yOf(p.atoms)]), ATOMS);
  }

  // Chart 2: core temperature (log), with the fusion threshold.
  {
    const top = charts[1].top;
    const bottom = top + plotH;
    const yOf = (logT: number): number => bottom - ((Math.max(LOG_T_MIN, Math.min(LOG_T_MAX, logT)) - LOG_T_MIN) / (LOG_T_MAX - LOG_T_MIN)) * plotH;
    text(ctx, charts[1].title, r.x + 22, top - 18, "500 17px", TEXT_MUTED);
    text(ctx, temperatureWords(s.coreTempK), right, top - 18, "650 21px", TEXT, "right");
    ctx.lineWidth = 1;
    for (const e of [4, 5, 6, 7, 8]) {
      const y = Math.round(yOf(e)) + 0.5;
      ctx.strokeStyle = e === 4 ? "rgba(255, 255, 255, 0.28)" : GRID;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
      ctx.stroke();
      if (e % 2 === 0) {
        text(ctx, `10${superscript(e)}`, left - 10, y + 5, "400 14px", TEXT_MUTED, "right");
      }
    }
    const fusionY = Math.round(yOf(7)) + 0.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = "rgba(255, 214, 140, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left, fusionY);
    ctx.lineTo(right, fusionY);
    ctx.stroke();
    ctx.setLineDash([]);
    text(ctx, "fusion starts", right - 4, fusionY - 7, "500 14px", "rgba(255, 214, 140, 0.9)", "right");
    drawLine(ctx, samples.map((p) => [xOf(p.years), yOf(p.logT)]), HEAT, Math.log10(s.coreTempK) >= 7);
  }

  // Shared time axis.
  const axisY = charts[1].top + plotH + 24;
  for (const k of [220, 260, 300, 340]) {
    text(ctx, String(k), xOf(k * 1000), axisY, "400 14px", TEXT_MUTED, "center");
  }
  text(ctx, "thousand years since the collapse began", (left + right) / 2, axisY + 22, "400 14px", TEXT_MUTED, "center");
  ctx.restore();
}

function drawLine(ctx: CanvasRenderingContext2D, pts: [number, number][], color: string, hotHead = false): void {
  if (pts.length < 2) {
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.stroke();
  const [hx, hy] = pts[pts.length - 1];
  ctx.fillStyle = hotHead ? "#ffffff" : color;
  ctx.beginPath();
  ctx.arc(hx, hy, 5, 0, Math.PI * 2);
  ctx.fill();
}

// ---------- Inset: inside the core ----------

/** Inside-the-core inset with a callout tying it to the star at the centre of the main view. */
export function drawCorePanel(ctx: CanvasRenderingContext2D, s: StoryState, view: View, r: Rect, gentle: boolean): void {
  const vis = s.coreInset;
  if (vis <= 0.01) {
    return;
  }
  ctx.save();
  // Callout: a small box on the star's core, joined to the inset's two left corners.
  const box = 14;
  ctx.globalAlpha = 0.45 * vis;
  ctx.strokeStyle = CORE_ACCENT;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(view.cx - box, view.cy - box, box * 2, box * 2);
  ctx.setLineDash([5, 7]);
  ctx.globalAlpha = 0.3 * vis;
  ctx.beginPath();
  ctx.moveTo(view.cx + box, view.cy - box);
  ctx.lineTo(r.x, r.y);
  ctx.moveTo(view.cx + box, view.cy + box);
  ctx.lineTo(r.x, r.y + r.h);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.globalAlpha = vis;
  ctx.textBaseline = "alphabetic";
  text(ctx, "INSIDE THE CORE", r.x + 2, r.y - 12, "600 15px", TEXT_MUTED);

  // The view itself, clipped to the frame.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 12);
  ctx.clip();
  ctx.fillStyle = "#080405";
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.translate(r.x, r.y);
  ctx.scale(r.w / CORE_W, r.h / CORE_H);
  const label = drawCoreView(ctx, s.story, vis, gentle, s.coreTempK);
  ctx.restore();

  // Text strip along the bottom.
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 12);
  ctx.clip();
  const strip = ctx.createLinearGradient(0, r.y + r.h - 56, 0, r.y + r.h);
  strip.addColorStop(0, "rgba(5, 3, 4, 0)");
  strip.addColorStop(1, "rgba(5, 3, 4, 0.85)");
  ctx.fillStyle = strip;
  ctx.fillRect(r.x, r.y + r.h - 56, r.w, 56);
  ctx.restore();
  if (label) {
    text(ctx, label, r.x + 18, r.y + r.h - 16, "500 19px", TEXT);
  }

  // Its own scale: an atom's width, top right.
  const barPx = (1e-10 / CORE_FIELD_M) * r.w;
  const bx = r.x + r.w - 18;
  const by = r.y + 26;
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(bx - barPx, by - 5);
  ctx.lineTo(bx - barPx, by + 5);
  ctx.moveTo(bx - barPx, by);
  ctx.lineTo(bx, by);
  ctx.moveTo(bx, by - 5);
  ctx.lineTo(bx, by + 5);
  ctx.stroke();
  text(ctx, "10⁻¹⁰ m (an atom's width)", bx - barPx - 10, by + 5, "500 14px", TEXT, "right");
  text(ctx, `nuclei drawn ~${sig(NUCLEUS_ENLARGEMENT, 1)}× too big`, bx, by + 26, "400 13px", TEXT_MUTED, "right");

  ctx.strokeStyle = "rgba(255, 190, 150, 0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 12);
  ctx.stroke();
  ctx.restore();
}

// ---------- Scale bar and zoom ruler ----------

const UNITS = [
  { m: LIGHT_YEAR_M, one: "light-year", many: "light-years" },
  { m: AU_M, one: "AU", many: "AU" },
  { m: SOLAR_RADIUS_M, one: "solar radius", many: "solar radii" }
];

/** A round length (1, 2 or 5 × 10ⁿ of a familiar unit) about `targetPx` long on screen. */
export function scaleBarLength(viewWidthM: number, targetPx = 200): { metres: number; label: string } {
  const unit = viewWidthM >= 0.3 * LIGHT_YEAR_M ? UNITS[0] : viewWidthM >= 3 * AU_M ? UNITS[1] : UNITS[2];
  const ideal = (targetPx * viewWidthM) / W / unit.m;
  const base = 10 ** Math.floor(Math.log10(ideal));
  let best = base;
  for (const m of [1, 2, 5, 10]) {
    if (Math.abs(Math.log(m * base / ideal)) < Math.abs(Math.log(best / ideal))) {
      best = m * base;
    }
  }
  const value = Number(best.toPrecision(1));
  return { metres: value * unit.m, label: `${value.toLocaleString("en-US")} ${value === 1 ? unit.one : unit.many}` };
}

/** Powers of ten: the zoom ruler spans clouds (10¹⁸ m) down to nuclei (10⁻¹⁵ m). */
const RULER_MAX = 18;
const RULER_MIN = -15;
const LANDMARKS: [number, string][] = [
  [Math.log10(30 * LIGHT_YEAR_M), "cloud"],
  [Math.log10(80 * AU_M), "Solar System"],
  [Math.log10(1.39e9), "Sun"],
  [Math.log10(1.7), "you"],
  [-10, "atom"],
  [-15, "nucleus"]
];

/**
 * Bottom right: a classic scale bar for the main view, and under it a powers-of-ten ruler whose
 * marker slides from "cloud" towards "Sun" as the camera zooms in; while the core inset is shown, a
 * second marker sits down near "atom".
 */
export function drawScaleBar(ctx: CanvasRenderingContext2D, s: StoryState, layout: HudLayout): void {
  const right = layout.right;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.textBaseline = "alphabetic";

  const bar = scaleBarLength(s.viewWidthM);
  const px = (bar.metres / s.viewWidthM) * W;
  const y = layout.barY;
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(right - px, y - 8);
  ctx.lineTo(right - px, y + 8);
  ctx.moveTo(right - px, y);
  ctx.lineTo(right, y);
  ctx.moveTo(right, y - 8);
  ctx.lineTo(right, y + 8);
  ctx.stroke();
  text(ctx, bar.label, right, y - 16, "500 21px", TEXT, "right");

  // The ruler, a little wider than the inset so the landmark names have room.
  const x0 = right - 640;
  const xOf = (logM: number): number => x0 + ((RULER_MAX - logM) / (RULER_MAX - RULER_MIN)) * (right - x0);
  const ry = layout.rulerY;
  const viewX = xOf(Math.log10(s.viewWidthM));
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
  ctx.beginPath();
  ctx.moveTo(x0, ry);
  ctx.lineTo(right, ry);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
  ctx.beginPath();
  ctx.moveTo(x0, ry);
  ctx.lineTo(viewX, ry);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  for (const [logM, name] of LANDMARKS) {
    const x = xOf(logM);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
    ctx.beginPath();
    ctx.moveTo(x, ry - 5);
    ctx.lineTo(x, ry + 5);
    ctx.stroke();
    const align: CanvasTextAlign = x > right - 30 ? "right" : x < x0 + 30 ? "left" : "center";
    text(ctx, name, align === "right" ? right : align === "left" ? x0 : x, ry + 24, "400 14px", TEXT_MUTED, align);
  }
  triangle(ctx, viewX, ry - 4, 7, "#ffffff");
  text(ctx, "view", viewX, ry - 18, "500 13px", TEXT, "center");
  if (s.coreInset > 0.01) {
    ctx.globalAlpha = s.coreInset;
    const coreX = xOf(Math.log10(CORE_FIELD_M));
    triangle(ctx, coreX, ry - 4, 7, CORE_ACCENT);
    text(ctx, "core", coreX, ry - 18, "500 13px", CORE_ACCENT, "center");
  }
  ctx.restore();
}
