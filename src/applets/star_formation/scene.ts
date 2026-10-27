import { setLogicalTransform } from "../../core/canvasScale";
import { drawBloom, drawGrain, drawVignette, layersFor } from "../../core/cinematicPost";
import { drawGlow } from "../../core/glowSprites";
import { cloudParcels, cloudSprite, hash, placeParcel, smoothstep } from "./cloud";
import { drawCorePanel, drawGrowthGraph, drawScaleBar, hudLayout } from "./panels";
import { drawBubble, drawDisk, drawInfall, drawJets, drawRadiation, drawStar, illuminationRadiusM, lightColor, View } from "./stellar";
import {
  AU_M,
  CHAPTERS,
  formatTemperature,
  formatYears,
  LIGHT_YEAR_M,
  stateAt,
  STORY_DURATION,
  StoryState
} from "./timeline";

export const SCENE_W = 1920;
export const SCENE_H = 1080;

export type SceneOptions = {
  captions: boolean;
  clock: boolean;
  labels: boolean;
  timeline: boolean;
  /** Scale bar and powers-of-ten zoom ruler, bottom right. */
  scale: boolean;
  /** Graph of atoms gathered and core temperature, while the star piles on mass. */
  graph: boolean;
  /** Softer flashes and no camera drift or grain, for viewers who prefer reduced motion. */
  gentle: boolean;
  /** Cinematic mode: no captions, labels or timeline; the clock shrinks to time and temperature. */
  minimal: boolean;
};

type SceneLabel = { text: string; x: number; y: number; alpha: number };

const REVEAL_START = CHAPTERS.find((c) => c.id === "reveal")?.start ?? 0;

const TEXT = "rgba(236, 233, 224, 0.95)";
const TEXT_MUTED = "rgba(214, 208, 196, 0.72)";
const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const DUST: [number, number, number] = [10, 8, 12];
const AMBIENT: [number, number, number] = [95, 110, 155];
const IONISED: [number, number, number] = [255, 96, 140];

// ---------- Background ----------

const STARS = 1300;

let starCanvas: HTMLCanvasElement | null = null;

function starfield(): HTMLCanvasElement {
  if (starCanvas) {
    return starCanvas;
  }
  starCanvas = document.createElement("canvas");
  starCanvas.width = SCENE_W;
  starCanvas.height = SCENE_H;
  const ctx = starCanvas.getContext("2d") as CanvasRenderingContext2D;
  for (let i = 0; i < STARS; i += 1) {
    const x = hash(i, 81) * SCENE_W;
    const y = hash(i, 82) * SCENE_H;
    const b = hash(i, 83) ** 3;
    const warm = hash(i, 84);
    const color = warm < 0.3 ? "#ffd2a8" : warm < 0.8 ? "#f4f2ff" : "#b8ccff";
    ctx.globalAlpha = 0.25 + 0.75 * b;
    ctx.fillStyle = color;
    const size = 0.8 + 1.8 * b;
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
    if (b > 0.7) {
      drawGlow(ctx, color, x, y, 6 + 10 * b, 0.5 * b, 0.3);
    }
  }
  return starCanvas;
}

/** Distant stars and the faint band of the Milky Way. Hidden while we are deep inside the cloud. */
function drawSky(ctx: CanvasRenderingContext2D, s: StoryState): void {
  ctx.fillStyle = "#03040a";
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  const outside = smoothstep(0.4 * LIGHT_YEAR_M, 8 * LIGHT_YEAR_M, s.viewWidthM);
  const cleared = smoothstep(96, 112, s.story);
  const vis = Math.max(outside * (1 - smoothstep(10, 26, s.story) * (1 - cleared)), cleared);
  if (vis <= 0.01) {
    return;
  }
  const band = ctx.createLinearGradient(0, SCENE_H * 0.15, SCENE_W, SCENE_H * 0.85);
  band.addColorStop(0, "rgba(60, 40, 50, 0)");
  band.addColorStop(0.5, `rgba(120, 90, 80, ${0.16 * vis})`);
  band.addColorStop(1, "rgba(60, 40, 50, 0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = band;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  // Glowing gas far behind the cloud, so the dark dust stands out in silhouette.
  const k = SCENE_W / s.viewWidthM;
  const nebulae: [number, number, number, number, [number, number, number]][] = [
    [-9, -4, 16, 0, [200, 50, 75]],
    [8, 5, 14, 1, [215, 95, 45]],
    [2, -9, 11, 2, [150, 55, 150]]
  ];
  for (const [nx, ny, size, variant, rgb] of nebulae) {
    const px = SCENE_W / 2 + nx * LIGHT_YEAR_M * k;
    const py = SCENE_H / 2 + ny * LIGHT_YEAR_M * k;
    const sz = size * LIGHT_YEAR_M * k;
    ctx.globalAlpha = 0.85 * vis;
    ctx.drawImage(cloudSprite(variant, rgb), px - sz, py - sz, sz * 2, sz * 2);
  }
  // The stars never move on screen, so they are drawn once and reused.
  ctx.globalAlpha = vis;
  ctx.drawImage(starfield(), 0, 0, SCENE_W, SCENE_H);
  ctx.globalAlpha = 1;
}

// ---------- Camera ----------

function viewAt(s: StoryState, gentle: boolean): View {
  const drift = gentle ? 0 : 1;
  return {
    k: SCENE_W / s.viewWidthM,
    cx: SCENE_W / 2 + drift * 14 * Math.sin(s.story * 0.07),
    cy: SCENE_H / 2 + drift * 10 * Math.cos(s.story * 0.05)
  };
}

// ---------- Cloud ----------

/** Direction the faint ambient (galactic) light comes from, for the cloud's lit edges. */
const SKY_LIGHT = -2.2;

/**
 * Each puff is painted (not added), so overlapping puffs saturate at their own colour instead of
 * piling up into white: first a lit edge on the side facing the light (dim sky light, or the star
 * once it shines), then the dark dusty body over it, then pink where the gas is ionised.
 */
/** The cloud is soft anyway, so it is painted on a quarter-resolution layer and scaled up (~16× less fill). */
const CLOUD_DOWNSCALE = 4;
const cloudLayers = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

function cloudLayerFor(target: HTMLCanvasElement): HTMLCanvasElement {
  const w = Math.max(1, Math.ceil(target.width / CLOUD_DOWNSCALE));
  const h = Math.max(1, Math.ceil(target.height / CLOUD_DOWNSCALE));
  let layer = cloudLayers.get(target);
  if (!layer) {
    layer = document.createElement("canvas");
    cloudLayers.set(target, layer);
  }
  if (layer.width !== w || layer.height !== h) {
    layer.width = w;
    layer.height = h;
  }
  return layer;
}

function drawCloud(target: CanvasRenderingContext2D, s: StoryState, view: View): void {
  const layer = cloudLayerFor(target.canvas);
  const ctx = layer.getContext("2d") as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, layer.width, layer.height);
  const illum = illuminationRadiusM(s.story);
  const lit = lightColor(s.story);
  const k = layer.width / SCENE_W;
  for (const p of cloudParcels()) {
    const placed = placeParcel(p, s, illum);
    if (!placed) {
      continue;
    }
    const sizePx = placed.size * view.k;
    if (sizePx < 5 || sizePx > 1000) {
      continue;
    }
    const x = view.cx + placed.x * view.k;
    const y = view.cy + placed.y * view.k;
    const reach = sizePx * placed.aspect;
    if (x < -reach || x > SCENE_W + reach || y < -reach || y > SCENE_H + reach) {
      continue;
    }
    // Fade in as puffs grow past a few pixels and out as they swell past the frame.
    const scaleFade = smoothstep(5, 14, sizePx) * (1 - smoothstep(550, 1000, sizePx));
    const a = placed.alpha * scaleFade;
    if (a < 0.01) {
      continue;
    }
    const w = sizePx * placed.aspect;
    const h = sizePx;
    const draw = (rgb: [number, number, number], alpha: number, dx: number, dy: number, scale: number): void => {
      if (alpha < 0.01) {
        return;
      }
      ctx.setTransform(k, 0, 0, k, (x + dx) * k, (y + dy) * k);
      ctx.rotate(placed.rot);
      ctx.globalAlpha = Math.min(1, alpha);
      ctx.drawImage(cloudSprite(placed.variant, rgb), (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);
    };
    const rim = placed.rim;
    const towards = rim > 0.05 ? placed.toStar : SKY_LIGHT;
    const litShare = Math.min(1, rim * 1.4);
    const off = sizePx * (0.12 + 0.12 * rim);
    const ex = Math.cos(towards) * off;
    const ey = Math.sin(towards) * off;
    // The body stays dark; only a crescent on the lit side shows the light (bright-rimmed pillars).
    // Two fixed-colour sprites with blended opacity, so sprites are reused rather than rebuilt.
    const edgeAlpha = a * (0.4 + 0.55 * rim);
    draw(AMBIENT, edgeAlpha * (1 - litShare), ex, ey, 0.95);
    draw(lit, edgeAlpha * litShare, ex, ey, 0.95);
    draw(DUST, a * 0.88, -Math.cos(towards) * off * 0.35, -Math.sin(towards) * off * 0.35, 0.9);
    if (placed.ionised > 0) {
      draw(IONISED, a * placed.ionised * 0.4, 0, 0, 1.05);
    }
  }
  setLogicalTransform(target, SCENE_W);
  target.globalAlpha = 1;
  target.imageSmoothingEnabled = true;
  target.imageSmoothingQuality = "medium";
  target.drawImage(layer, 0, 0, SCENE_W, SCENE_H);
}

// ---------- HUD ----------

function textShadow(ctx: CanvasRenderingContext2D, on: boolean): void {
  ctx.shadowColor = on ? "rgba(0, 0, 0, 0.8)" : "transparent";
  ctx.shadowBlur = on ? 10 : 0;
}

function temperatureLine(s: StoryState): string {
  if (s.story >= REVEAL_START && s.surfaceTempK !== null) {
    return `surface T ≈ ${formatTemperature(s.surfaceTempK)}`;
  }
  return `core T ≈ ${formatTemperature(s.coreTempK)}`;
}

function scrim(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(3, 4, 9, ${alpha})`);
  g.addColorStop(0.55, `rgba(3, 4, 9, ${alpha * 0.6})`);
  g.addColorStop(1, "rgba(3, 4, 9, 0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
}

function drawClock(ctx: CanvasRenderingContext2D, s: StoryState, minimal: boolean): void {
  const x = SCENE_W - (minimal ? 56 : 48);
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  textShadow(ctx, true);
  ctx.fillStyle = TEXT;
  ctx.font = `600 ${minimal ? 46 : 44}px ${FONT}`;
  ctx.fillText(`t ≈ ${formatYears(s.years)}`, x, minimal ? 72 : 64);
  ctx.font = `400 ${minimal ? 32 : 28}px ${FONT}`;
  ctx.fillStyle = minimal ? "rgba(236, 233, 224, 0.88)" : TEXT;
  ctx.fillText(temperatureLine(s), x, minimal ? 116 : 106);
  if (!minimal) {
    // The field of view is shown by the scale bar, bottom right.
    ctx.fillStyle = TEXT_MUTED;
    ctx.font = `400 22px ${FONT}`;
    ctx.fillText(`core density ≈ ${densityText(s.logRho)}`, x, 140);
  }
  textShadow(ctx, false);
}

function densityText(logRho: number): string {
  const exp = Math.round(logRho);
  if (exp >= -1) {
    return `${(10 ** logRho).toPrecision(1)} g/cm³`;
  }
  const sup = String(exp)
    .split("")
    .map((c) => ({ "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹" })[c] ?? c)
    .join("");
  return `10${sup} g/cm³`;
}

function drawCaption(ctx: CanvasRenderingContext2D, s: StoryState, aboveTimeline: boolean): void {
  const chapter = CHAPTERS[s.chapterIndex];
  const into = s.story - chapter.start;
  const left = chapter.end - s.story;
  const isLast = s.chapterIndex === CHAPTERS.length - 1;
  const alpha = Math.max(0, Math.min(1, into / 0.8, isLast ? 1 : left / 0.5));
  if (alpha <= 0) {
    return;
  }
  const x = 64;
  const lineGap = 33;
  let y = SCENE_H - (aboveTimeline ? 96 : 52);
  ctx.globalAlpha = alpha;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  textShadow(ctx, true);
  ctx.font = `400 25px ${FONT}`;
  ctx.fillStyle = "rgba(236, 233, 224, 0.9)";
  for (let i = chapter.caption.length - 1; i >= 0; i -= 1) {
    ctx.fillText(chapter.caption[i], x, y);
    y -= lineGap;
  }
  y -= 12;
  ctx.fillStyle = TEXT;
  ctx.font = `650 50px ${FONT}`;
  ctx.fillText(chapter.title, x, y);
  ctx.fillStyle = TEXT_MUTED;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText(`CHAPTER ${s.chapterIndex + 1} OF ${CHAPTERS.length}`, x, y - 52);
  textShadow(ctx, false);
  ctx.globalAlpha = 1;
}

function drawTimeline(ctx: CanvasRenderingContext2D, s: StoryState): void {
  const x0 = 64;
  const x1 = SCENE_W - 64;
  const y = SCENE_H - 34;
  const toX = (t: number): number => x0 + ((x1 - x0) * t) / STORY_DURATION;
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(toX(s.story), y);
  ctx.stroke();
  ctx.font = `500 15px ${FONT}`;
  ctx.textAlign = "left";
  CHAPTERS.forEach((c, i) => {
    const cx = toX(c.start);
    ctx.fillStyle = i <= s.chapterIndex ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.3)";
    ctx.fillRect(cx - 1, y - 7, 2, 14);
    ctx.fillStyle = i === s.chapterIndex ? TEXT : TEXT_MUTED;
    ctx.fillText(c.short, cx + 6, y - 10);
  });
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(toX(s.story), y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, alpha: number): void {
  if (alpha <= 0.01) {
    return;
  }
  ctx.font = `500 22px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(text).width + 24;
  const cx = Math.min(SCENE_W - w / 2 - 20, Math.max(w / 2 + 20, x));
  ctx.globalAlpha = alpha * 0.7;
  ctx.fillStyle = "rgba(6, 8, 16, 1)";
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, y - 18, w, 36, 10);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = TEXT;
  ctx.fillText(text, cx, y + 1);
  ctx.globalAlpha = 1;
}

/** Pointers to the things worth naming, each shown for a few seconds. */
function sceneLabels(s: StoryState, view: View): SceneLabel[] {
  const out: SceneLabel[] = [];
  const window = (a: number, b: number): number => smoothstep(a, a + 0.6, s.story) * (1 - smoothstep(b - 0.6, b, s.story));
  const disk = window(43, 49);
  if (disk > 0) {
    out.push({ text: "accretion disk", x: view.cx + Math.min(700, 300 * AU_M * view.k), y: view.cy + 110, alpha: disk });
    out.push({ text: "jet", x: view.cx + 120, y: view.cy - 330, alpha: disk });
  }
  const opaque = window(29, 34);
  if (opaque > 0) {
    out.push({ text: "opaque core, warming up", x: view.cx, y: view.cy - 150, alpha: opaque });
  }
  const infall = window(54.5, 60.5);
  if (infall > 0) {
    out.push({ text: "gas falling onto the star", x: view.cx - 430, y: view.cy - 190, alpha: infall });
  }
  const ignite = window(69.5, 75);
  if (ignite > 0) {
    out.push({ text: "fusion lights up the core", x: view.cx, y: view.cy - 400, alpha: ignite });
  }
  const shell = window(100, 106);
  if (shell > 0 && s.bubbleM > 0) {
    out.push({ text: "ionised hydrogen glows pink", x: view.cx, y: view.cy - Math.min(470, s.bubbleM * view.k) + 40, alpha: shell });
  }
  return out;
}

// ---------- Frame ----------

export function renderStarScene(ctx: CanvasRenderingContext2D, story: number, opts: SceneOptions): void {
  const s = stateAt(story);
  const view = viewAt(s, opts.gentle);
  setLogicalTransform(ctx, SCENE_W);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  const layers = layersFor(ctx.canvas);
  const light = layers.glow.getContext("2d") as CanvasRenderingContext2D;
  light.setTransform(1, 0, 0, 1, 0, 0);
  light.globalCompositeOperation = "source-over";
  light.clearRect(0, 0, layers.glow.width, layers.glow.height);
  setLogicalTransform(light, SCENE_W);

  drawSky(ctx, s);
  light.globalCompositeOperation = "lighter";
  drawBubble(light, s, view);
  drawCloud(ctx, s, view);
  light.globalCompositeOperation = "lighter";
  drawDisk(light, s, view, opts.gentle);
  drawJets(light, s, view, opts.gentle);
  drawInfall(light, s, view, opts.gentle);
  drawStar(light, s, view, opts.gentle);
  drawRadiation(light, s, view, opts.gentle);
  const labels = sceneLabels(s, view);
  light.globalCompositeOperation = "source-over";
  light.globalAlpha = 1;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layers.glow, 0, 0);
  drawBloom(ctx, layers, opts.gentle);
  setLogicalTransform(ctx, SCENE_W);
  drawVignette(ctx, SCENE_W, SCENE_H);
  if (!opts.gentle) {
    drawGrain(ctx, Math.round(story * 60), SCENE_W, SCENE_H);
  }

  const layout = hudLayout(opts.timeline && !opts.minimal);
  if (opts.scale) {
    scrim(ctx, SCENE_W, SCENE_H, 760, 0.55);
  }
  if (opts.minimal) {
    scrim(ctx, SCENE_W, 0, 560, 0.5);
    drawPanels(ctx, s, view, layout, opts);
    drawClock(ctx, s, true);
    return;
  }
  if (opts.clock) {
    scrim(ctx, SCENE_W, 0, 680, 0.6);
  }
  if (opts.captions) {
    scrim(ctx, 0, SCENE_H, 1250, 0.7);
  }
  drawPanels(ctx, s, view, layout, opts);
  if (opts.labels) {
    for (const l of labels) {
      pill(ctx, l.text, l.x, l.y, l.alpha);
    }
  }
  if (opts.clock) {
    drawClock(ctx, s, false);
  }
  if (opts.captions) {
    drawCaption(ctx, s, opts.timeline);
  }
  if (opts.timeline) {
    drawTimeline(ctx, s);
  }
}

/** The right-hand column: graph, core inset, scale bar. The inset is part of the picture, always shown. */
function drawPanels(ctx: CanvasRenderingContext2D, s: StoryState, view: View, layout: ReturnType<typeof hudLayout>, opts: SceneOptions): void {
  if (opts.graph) {
    drawGrowthGraph(ctx, s, layout.graph);
  }
  drawCorePanel(ctx, s, view, layout.inset, opts.gentle);
  if (opts.scale) {
    drawScaleBar(ctx, s, layout);
  }
}

export { stateAt };
