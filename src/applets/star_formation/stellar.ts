import { drawGlow, withAlpha } from "../../core/glowSprites";
import { cloudSprite, hash, smoothstep } from "./cloud";
import { AU_M, CHAPTERS, FUSION_START, LIGHT_YEAR_M, SOLAR_RADIUS_M, StoryState } from "./timeline";

/**
 * The protostar and star, its accretion disk and jets, the ionised bubble and the outgoing
 * radiation. All sizes are physical (metres) and converted with `k` (pixels per metre); things
 * far smaller than a pixel are drawn as glows, things far larger than the frame are skipped.
 */

export type View = { k: number; cx: number; cy: number };

/** Disk tilt on screen and how flattened it looks (cosine of the inclination). */
const DISK_ANGLE = -0.18;
const DISK_FLAT = 0.3;

function logInterp(keys: [number, number][], story: number): number {
  if (story <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 1; i < keys.length; i += 1) {
    if (story <= keys[i][0]) {
      const [s0, v0] = keys[i - 1];
      const [s1, v1] = keys[i];
      return 10 ** (Math.log10(v0) + ((Math.log10(v1) - Math.log10(v0)) * (story - s0)) / (s1 - s0));
    }
  }
  return keys[keys.length - 1][1];
}

/**
 * Stellar radius: a large accreting protostar that swells further as mass piles on (fast-growing
 * massive protostars do), then contracts to a ~8 R☉ main-sequence O star as fusion takes over.
 */
export function starRadiusM(story: number): number {
  return (
    logInterp(
      [
        [38, 60],
        [52, 40],
        [60, 50],
        [70, 12],
        [78, 8]
      ],
      story
    ) * SOLAR_RADIUS_M
  );
}

/** Distance out to which the star visibly lights up the surrounding gas (grows with luminosity). */
export function illuminationRadiusM(story: number): number {
  if (story < 36) {
    return 0;
  }
  return logInterp(
    [
      [36, 60 * AU_M],
      [52, 2000 * AU_M],
      [68, 4000 * AU_M],
      [80, 0.05 * LIGHT_YEAR_M],
      [88, 1 * LIGHT_YEAR_M],
      [108, 12 * LIGHT_YEAR_M]
    ],
    story
  );
}

/** Colour of the light the star casts: warm while embedded and cool, blue-white once it is an O star. */
export function lightColor(story: number): [number, number, number] {
  // Stepped, so the tinted cloud sprites built from it can be cached and reused.
  const f = Math.round(smoothstep(72, 84, story) * 8) / 8;
  return [Math.round(255 - 70 * f), Math.round(150 + 58 * f), Math.round(80 + 175 * f)];
}

/** Approximate sRGB colour of a blackbody (Tanner Helland's fit, ~1000–40000 K). */
export function blackbody(tempK: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, tempK)) / 100;
  const r = t <= 66 ? 255 : 329.7 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  const clamp = (v: number): number => Math.round(Math.min(255, Math.max(0, v)));
  return [clamp(r), clamp(g), clamp(b)];
}

function rgbHex([r, g, b]: [number, number, number]): string {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

// ---------- Ionised bubble ----------

/** The H II region: hot ionised gas, blue-green inside (oxygen) and pink-red at the rim (hydrogen). */
export function drawBubble(ctx: CanvasRenderingContext2D, s: StoryState, view: View): void {
  if (s.bubbleM <= 0) {
    return;
  }
  const r = s.bubbleM * view.k;
  if (r < 3) {
    return;
  }
  const fade = smoothstep(88, 96, s.story);
  const g = ctx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, r * 1.08);
  g.addColorStop(0, `rgba(60, 150, 190, ${0.07 * fade})`);
  g.addColorStop(0.55, `rgba(130, 70, 150, ${0.09 * fade})`);
  g.addColorStop(0.88, `rgba(230, 60, 110, ${0.18 * fade})`);
  g.addColorStop(0.97, `rgba(255, 100, 130, ${0.26 * fade})`);
  g.addColorStop(1, "rgba(255, 80, 120, 0)");
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, r * 1.08, 0, Math.PI * 2);
  ctx.fill();
  // Lumpy, glowing gas along the shell.
  const n = 70;
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 + 0.3 * hash(i, 41);
    const rr = r * (0.82 + 0.2 * hash(i, 42));
    const size = r * (0.12 + 0.16 * hash(i, 43));
    const sprite = cloudSprite(i % 4, hash(i, 44) < 0.7 ? [255, 90, 130] : [110, 200, 230]);
    ctx.globalAlpha = 0.12 * fade;
    ctx.drawImage(sprite, view.cx + Math.cos(a) * rr - size, view.cy + Math.sin(a) * rr - size, size * 2, size * 2);
  }
}

// ---------- Disk and jets ----------

/** Rings of the accretion disk, from hot and bright inside to cool and dusty outside. */
export function drawDisk(ctx: CanvasRenderingContext2D, s: StoryState, view: View, gentle: boolean): void {
  // The disk fades once the star ignites (its light boils the disk away; also keeps the star visible).
  const vis = smoothstep(33, 38, s.story) * (1 - smoothstep(72, 80, s.story));
  if (vis <= 0) {
    return;
  }
  const rings = 46;
  const rIn = 0.05 * AU_M;
  const rOut = 900 * AU_M;
  const c = Math.cos(DISK_ANGLE);
  const sn = Math.sin(DISK_ANGLE);
  for (let j = 0; j < rings; j += 1) {
    const rm = rIn * (rOut / rIn) ** (j / (rings - 1));
    const rp = rm * view.k;
    if (rp < 4 || rp > 3200) {
      continue;
    }
    const heat = 1 - j / rings;
    const color: [number, number, number] = [255, Math.round(110 + 100 * heat), Math.round(50 + 110 * heat * heat)];
    // Clumps orbit faster near the centre (Keplerian), measured in screen terms so it reads at any zoom.
    const omega = gentle ? 0.15 : Math.min(3, 0.7 * (260 / rp) ** 1.5);
    const clumps = 10;
    for (let q = 0; q < clumps; q += 1) {
      const a = (q / clumps) * Math.PI * 2 + hash(j * 31 + q, 51) + s.story * omega;
      const ex = Math.cos(a) * rp;
      const ey = Math.sin(a) * rp * DISK_FLAT;
      const x = view.cx + ex * c - ey * sn;
      const y = view.cy + ex * sn + ey * c;
      const size = rp * (0.14 + 0.14 * hash(j * 31 + q, 52));
      drawGlow(ctx, rgbHex(color), x, y, size, vis * (0.07 + 0.15 * heat) * (0.6 + 0.4 * hash(q, j)), 0.6);
    }
  }
}

const REVEAL_START = CHAPTERS.find((c) => c.id === "reveal")?.start ?? 80;
const JET_HOT: [number, number, number] = [255, 214, 186];
const JET_PINK: [number, number, number] = [255, 92, 138];
const JET_BLUE: [number, number, number] = [130, 165, 255];
const JET_PUFFS = 60;

/**
 * Bipolar outflows, drawn like the Herbig–Haro jets in telescope images: billowing gas made of the
 * same soft puffs as the cloud, streaming out of the poles in a widening cone, white-hot near the
 * star and glowing pink-red further out, piling up into a bow shock at the tip. They fade once
 * fusion has started, before the star is revealed (real outflows die down more gradually).
 */
export function drawJets(ctx: CanvasRenderingContext2D, s: StoryState, view: View, gentle: boolean): void {
  const vis = smoothstep(37, 43, s.story) * (1 - smoothstep(FUSION_START + 1, REVEAL_START - 1, s.story));
  if (vis <= 0) {
    return;
  }
  const lengthM = 0.4 * LIGHT_YEAR_M * smoothstep(37, 50, s.story) + 200 * AU_M;
  // Kept inside the frame, so the billowing cones are seen leaving the poles rather than a line
  // crossing the screen (real outflows reach light-years; the scale bar still sets the scene).
  const length = Math.min(lengthM * view.k, 520);
  if (length < 8) {
    return;
  }
  const axis = DISK_ANGLE - Math.PI / 2;
  const flow = gentle ? 0.05 : 0.12;
  const mix = (a: [number, number, number], b: [number, number, number], f: number): [number, number, number] => [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
  for (const dir of [1, -1]) {
    const ux = Math.cos(axis) * dir;
    const uy = Math.sin(axis) * dir;
    // Hot gas launched from the pole.
    drawGlow(ctx, "#ffe2cc", view.cx + ux * length * 0.08, view.cy + uy * length * 0.08, length * 0.16, vis * 0.3, 0.4);
    // Billowing puffs flowing outward; they widen and cool as they go.
    for (let q = 0; q < JET_PUFFS; q += 1) {
      const seed = q * 7 + (dir > 0 ? 0 : 3001);
      const f = (hash(seed, 91) + s.story * flow * (0.8 + 0.4 * hash(seed, 92))) % 1;
      const d = length * (0.06 + 0.94 * f);
      const spread = length * (0.04 + 0.22 * f) * (hash(seed, 93) - 0.5) * 2;
      const x = view.cx + ux * d - uy * spread;
      const y = view.cy + uy * d + ux * spread;
      const size = length * (0.07 + 0.16 * f) * (0.7 + 0.6 * hash(seed, 94));
      const fade = Math.min(1, f * 6) * (1 - f ** 3);
      const color = hash(seed, 95) < 0.15 ? JET_BLUE : f < 0.4 ? mix(JET_HOT, JET_PINK, f / 0.4) : JET_PINK;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(axis + (hash(seed, 96) - 0.5));
      ctx.globalAlpha = vis * fade * (0.13 + 0.13 * hash(seed, 97)) * (0.6 + 0.4 * f);
      ctx.drawImage(cloudSprite(q % 4, color), -size * 1.3, -size, size * 2.6, size * 2);
      ctx.restore();
    }
    // Bow shock: gas piling up where the jet rams the cloud.
    const tipX = view.cx + ux * length;
    const tipY = view.cy + uy * length;
    for (let q = 0; q < 9; q += 1) {
      const a = axis + (dir > 0 ? 0 : Math.PI) + (q / 8 - 0.5) * 1.6;
      const r = length * 0.09;
      const size = length * (0.07 + 0.05 * hash(q, 98 + dir));
      const breathe = 0.85 + 0.15 * Math.sin(s.story * 1.3 + q);
      ctx.globalAlpha = vis * 0.28 * breathe;
      ctx.drawImage(
        cloudSprite((q + 1) % 4, JET_PINK),
        tipX - Math.cos(a) * r * 0.6 - size,
        tipY - Math.sin(a) * r * 0.6 - size,
        size * 2,
        size * 2
      );
    }
    drawGlow(ctx, "#ff7aa0", tipX, tipY, Math.max(10, length * 0.1), vis * 0.35, 0.35);
  }
}

/**
 * Gas piling onto the protostar: clumps spiral in through the disk plane, heating up and
 * brightening as they fall, and vanish into the star. Sized in screen terms, so it reads at any zoom.
 */
export function drawInfall(ctx: CanvasRenderingContext2D, s: StoryState, view: View, gentle: boolean): void {
  const vis = smoothstep(49, 54, s.story) * (1 - smoothstep(70, 76, s.story));
  if (vis <= 0) {
    return;
  }
  const c = Math.cos(DISK_ANGLE);
  const sn = Math.sin(DISK_ANGLE);
  const starPx = starRadiusM(s.story) * view.k;
  const clumps = gentle ? 28 : 54;
  const pace = gentle ? 0.6 : 1;
  for (let i = 0; i < clumps; i += 1) {
    const period = 2.4 + 1.6 * hash(i, 91);
    const start = 900 + 500 * hash(i, 92);
    const theta0 = hash(i, 93) * Math.PI * 2;
    // Two points along the path: the clump and a fainter one just behind it, for a short tail.
    for (const lag of [0, 0.035]) {
      const f = (hash(i, 94) + (s.story * pace) / period - lag + 10) % 1;
      const r = starPx + (start - starPx) * (1 - f) ** 1.7;
      // Winds up as it falls, like gas conserving its spin.
      const a = theta0 + 2.6 * (1 - Math.sqrt(r / start));
      const ex = Math.cos(a) * r;
      const ey = Math.sin(a) * r * DISK_FLAT;
      const x = view.cx + ex * c - ey * sn;
      const y = view.cy + ex * sn + ey * c;
      const hot = f ** 2;
      const size = (4 + 6 * hash(i, 95)) * (1 + 0.8 * hot) * (lag > 0 ? 0.7 : 1);
      const alpha = vis * (0.12 + 0.5 * f) * (lag > 0 ? 0.45 : 1);
      drawGlow(ctx, hot > 0.5 ? "#ffe2b0" : "#ff9a5a", x, y, size * 2.2, alpha, 0.45);
    }
  }
}

// ---------- The star ----------

/**
 * The (proto)star. While embedded it is a dim, reddened glow; once it ignites and clears its
 * surroundings it becomes a blue-white blaze with diffraction spikes. Close up, a limb-darkened
 * disk with boiling granulation.
 */
export function drawStar(ctx: CanvasRenderingContext2D, s: StoryState, view: View, gentle: boolean): void {
  if (s.surfaceTempK === null) {
    // Before the protostar: the warming core glows faintly in the infrared.
    const warm = smoothstep(26, 38, s.story);
    if (warm > 0) {
      drawGlow(ctx, "#ff5a28", view.cx, view.cy, 40 + 80 * warm, 0.5 * warm, 0.4);
    }
    return;
  }
  const rgb = blackbody(s.surfaceTempK);
  const color = rgbHex(rgb);
  const rp = starRadiusM(s.story) * view.k;
  // Embedded protostars are hidden by dust; the star emerges as it ignites and clears its cocoon.
  const emerged = smoothstep(69, 85, s.story);
  const brightness = 0.35 + 0.65 * emerged;
  // Glare: grows with luminosity, sized in screen terms so it reads at any zoom.
  // Once the disk is resolved the glare shrinks, so the surface itself stays visible.
  const resolved = smoothstep(20, 120, rp);
  const glare = (60 + 220 * emerged) * (1 - 0.7 * resolved);
  drawGlow(ctx, color, view.cx, view.cy, glare + rp * 1.6, (0.7 - 0.4 * resolved) * brightness, 0.3);
  if (rp < 60) {
    drawGlow(ctx, "#ffffff", view.cx, view.cy, Math.max(6, rp * 1.1), brightness * (1 - resolved), 0.5);
  }
  if (rp > 6) {
    // Limb-darkened photosphere.
    const g = ctx.createRadialGradient(view.cx, view.cy, 0, view.cx, view.cy, rp);
    g.addColorStop(0, `rgba(${Math.round(rgb[0] * 0.75 + 64)}, ${Math.round(rgb[1] * 0.75 + 64)}, ${Math.round(rgb[2] * 0.75 + 64)}, ${brightness})`);
    g.addColorStop(0.55, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${brightness * 0.9})`);
    g.addColorStop(1, `rgba(${Math.round(rgb[0] * 0.6)}, ${Math.round(rgb[1] * 0.45)}, ${Math.round(rgb[2] * 0.4)}, ${brightness})`);
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, rp, 0, Math.PI * 2);
    ctx.fill();
    if (rp > 80) {
      // Granulation: boiling cells of rising hot gas.
      ctx.save();
      ctx.beginPath();
      ctx.arc(view.cx, view.cy, rp, 0, Math.PI * 2);
      ctx.clip();
      const cells = 90;
      for (let i = 0; i < cells; i += 1) {
        const a = hash(i, 61) * Math.PI * 2 + (gentle ? 0 : s.story * 0.05);
        const rr = Math.sqrt(hash(i, 62)) * rp;
        const size = rp * (0.08 + 0.1 * hash(i, 63));
        const boil = 0.5 + 0.5 * Math.sin(s.story * (1.5 + hash(i, 64)) + i);
        ctx.globalAlpha = 0.25 * boil * brightness;
        ctx.drawImage(cloudSprite(i % 4, [255, 255, 255]), view.cx + Math.cos(a) * rr - size, view.cy + Math.sin(a) * rr - size, size * 2, size * 2);
      }
      ctx.restore();
    }
  }
  // Diffraction spikes once the star blazes, as in telescope images.
  if (emerged > 0 && rp < 30) {
    const len = (240 + 380 * emerged) * (gentle ? 0.6 : 1);
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    for (const [angle, scale] of [
      [0, 1],
      [Math.PI / 2, 1],
      [Math.PI / 4, 0.45],
      [-Math.PI / 4, 0.45]
    ] as [number, number][]) {
      const lx = Math.cos(angle) * len * scale;
      const ly = Math.sin(angle) * len * scale;
      const spike = ctx.createLinearGradient(view.cx - lx, view.cy - ly, view.cx + lx, view.cy + ly);
      spike.addColorStop(0, withAlpha(color, 0));
      spike.addColorStop(0.5, withAlpha("#ffffff", 0.85 * emerged));
      spike.addColorStop(1, withAlpha(color, 0));
      ctx.strokeStyle = spike;
      ctx.globalAlpha = 1;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(view.cx - lx, view.cy - ly);
      ctx.lineTo(view.cx + lx, view.cy + ly);
      ctx.stroke();
    }
  }
}

/** Energetic light streaming away from the blue star: faint violet-white streaks rushing outward. */
export function drawRadiation(ctx: CanvasRenderingContext2D, s: StoryState, view: View, gentle: boolean): void {
  const vis = smoothstep(82, 90, s.story);
  if (vis <= 0) {
    return;
  }
  const n = gentle ? 60 : 140;
  const reach = 1300;
  ctx.lineCap = "round";
  for (let i = 0; i < n; i += 1) {
    const a = hash(i, 71) * Math.PI * 2;
    const f = (hash(i, 72) + s.story * (0.18 + 0.12 * hash(i, 73))) % 1;
    const d = 30 + f * reach;
    const len = 30 + 70 * f;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    ctx.strokeStyle = hash(i, 74) < 0.5 ? "#c9b8ff" : "#d8ecff";
    ctx.globalAlpha = vis * 0.55 * Math.sin(Math.PI * f);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(view.cx + ux * d, view.cy + uy * d);
    ctx.lineTo(view.cx + ux * (d + len), view.cy + uy * (d + len));
    ctx.stroke();
  }
}

export { rgbHex };
