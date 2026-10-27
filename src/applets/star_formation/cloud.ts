import { AU_M, LIGHT_YEAR_M, StoryState, storyAtViewWidth } from "./timeline";

/**
 * The molecular cloud as a few thousand soft "parcels" of gas and dust, spread evenly in log-radius
 * around the collapsing core (a ρ ∝ r⁻² cloud looks the same at every zoom). Each parcel is a pure
 * function of story time:
 *
 * - it falls inward, spinning up, while the camera is looking at its scale (in reality the collapse
 *   runs inside-out over ~10⁵ years; on screen you see infall wherever you look);
 * - small parcels flatten towards the disk plane;
 * - once the star shines, parcels facing it light up, and the ionised bubble sweeps them outward,
 *   eroding them and stretching the survivors into bright-rimmed pillars.
 */

export type Parcel = {
  r0: number;
  theta0: number;
  size: number;
  aspect: number;
  rot: number;
  variant: number;
  shade: number;
  /** Story time when this parcel starts falling in. */
  collapseStart: number;
  /** Fraction of its radius it loses by falling in. */
  collapseMax: number;
  spin: number;
  jitter: number;
};

function hash(i: number, salt: number): number {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

function gauss(i: number, salt: number): number {
  const u1 = Math.max(1e-9, hash(i, salt));
  const u2 = hash(i, salt + 0.5);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

const PARCELS = 1300;
const R_MIN = 120 * AU_M;
const R_MAX = 24 * LIGHT_YEAR_M;
/** Gas beyond this radius belongs to the wider cloud and barely moves. */
const CORE_RADIUS = 1.5 * LIGHT_YEAR_M;
/** The cloud's main filament runs along this angle. */
const FILAMENT_ANGLE = 0.45;

let parcels: Parcel[] | null = null;

export function cloudParcels(): Parcel[] {
  if (parcels) {
    return parcels;
  }
  const out: Parcel[] = [];
  const span = Math.log(R_MAX / R_MIN);
  for (let i = 0; i < PARCELS; i += 1) {
    const r0 = R_MIN * Math.exp(hash(i, 1) * span);
    const big = r0 > CORE_RADIUS;
    // The wider cloud is filamentary; near the core the gas surrounds it on all sides.
    const onFilament = big && hash(i, 2) < 0.7;
    const theta0 = onFilament
      ? FILAMENT_ANGLE + (hash(i, 3) < 0.5 ? 0 : Math.PI) + 0.3 * gauss(i, 4)
      : hash(i, 5) * Math.PI * 2;
    out.push({
      r0,
      theta0,
      size: r0 * (0.45 + 0.72 * hash(i, 6)),
      aspect: onFilament ? 1.4 + 0.8 * hash(i, 7) : 1 + 0.5 * hash(i, 7),
      rot: onFilament ? FILAMENT_ANGLE + 0.3 * gauss(i, 8) : hash(i, 8) * Math.PI,
      variant: Math.floor(hash(i, 9) * 4),
      shade: 0.55 + 0.45 * hash(i, 10),
      collapseStart: storyAtViewWidth(r0 * 5),
      collapseMax: big ? 0.12 : 0.86,
      spin: 0.1 + 0.08 * hash(i, 12),
      jitter: hash(i, 13)
    });
  }
  parcels = out;
  return out;
}

function smoothstep(a: number, b: number, x: number): number {
  const f = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return f * f * (3 - 2 * f);
}

export type PlacedParcel = {
  /** Position relative to the core, metres. */
  x: number;
  y: number;
  size: number;
  aspect: number;
  rot: number;
  variant: number;
  /** Opacity of the dust. */
  alpha: number;
  /** 0..1: how strongly its star-facing side is lit. */
  rim: number;
  /** Direction from the parcel to the star (radians), for the rim light. */
  toStar: number;
  /** 0..1: how much of it has been turned into glowing ionised gas. */
  ionised: number;
};

/** Where every parcel is, and how it looks, at this moment. */
export function placeParcel(p: Parcel, s: StoryState, illumRadiusM: number): PlacedParcel | null {
  const c = smoothstep(p.collapseStart, p.collapseStart + 8, s.story) * p.collapseMax;
  let r = p.r0 * (1 - c);
  // Angular momentum is conserved: the gas spins faster as it falls (capped for legibility).
  let theta = p.theta0 + Math.min(2.6, p.spin * (p.r0 / r - 1));
  let flat = 1;
  if (p.r0 < 4000 * AU_M) {
    flat = 1 - 0.65 * c;
  }
  let alpha = p.shade;
  let ionised = 0;
  let aspect = p.aspect;
  let rot = p.rot;

  // The ionised bubble sweeps gas outward to its edge and eats it away.
  if (s.bubbleM > 0 && r < s.bubbleM * 1.15) {
    const engulfed = Math.log(Math.max(1, s.bubbleM / r));
    const shell = s.bubbleM * (0.95 + 0.2 * p.jitter);
    if (r < shell) {
      r = shell;
    }
    ionised = Math.min(1, engulfed * 1.5 + 0.3);
    alpha *= Math.exp(-2.2 * engulfed);
    // Survivors are stretched away from the star: pillars with bright tips.
    aspect = 1.6 + 1.4 * p.jitter;
    rot = theta;
    theta += 0.05 * (p.jitter - 0.5);
    flat = 1;
  }
  if (alpha < 0.02) {
    return null;
  }
  const x = r * Math.cos(theta);
  const y = r * Math.sin(theta) * flat;
  const dist = Math.hypot(x, y);
  const rim = illumRadiusM > 0 ? Math.min(1, (illumRadiusM / (dist + illumRadiusM * 0.15)) ** 1.2) : 0;
  return {
    x,
    y,
    size: p.size * (1 - 0.6 * c),
    aspect,
    rot,
    variant: p.variant,
    alpha,
    rim,
    toStar: Math.atan2(-y, -x),
    ionised
  };
}

// ---------- Sprites ----------

const SPRITE = 128;
const spriteCache = new Map<string, HTMLCanvasElement>();

/** A soft, lumpy puff: radial falloff modulated by a few octaves of value noise. */
function puffAlpha(variant: number): Float32Array {
  const a = new Float32Array(SPRITE * SPRITE);
  const lattice = (ix: number, iy: number, o: number): number => hash(ix * 57 + iy * 131 + o * 977 + variant * 7919, 21);
  const noise = (x: number, y: number, o: number): number => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a0 = lattice(ix, iy, o) + (lattice(ix + 1, iy, o) - lattice(ix, iy, o)) * sx;
    const a1 = lattice(ix, iy + 1, o) + (lattice(ix + 1, iy + 1, o) - lattice(ix, iy + 1, o)) * sx;
    return a0 + (a1 - a0) * sy;
  };
  for (let j = 0; j < SPRITE; j += 1) {
    for (let i = 0; i < SPRITE; i += 1) {
      const u = (i + 0.5) / SPRITE - 0.5;
      const v = (j + 0.5) / SPRITE - 0.5;
      const r = Math.hypot(u, v) * 2;
      let n = 0;
      let amp = 0.5;
      let freq = 3;
      for (let o = 0; o < 4; o += 1) {
        n += amp * noise(u * freq + 10, v * freq + 10, o);
        amp *= 0.5;
        freq *= 2;
      }
      const falloff = Math.max(0, 1 - r) ** 1.4;
      a[j * SPRITE + i] = Math.max(0, Math.min(1, falloff * (0.35 + 1.1 * n) - 0.08));
    }
  }
  return a;
}

const puffCache = new Map<number, Float32Array>();

/** Cloud puff sprite in one colour; "dust" sprites are near-black and used to absorb light. */
export function cloudSprite(variant: number, rgb: [number, number, number]): HTMLCanvasElement {
  const key = `${variant}|${rgb.join(",")}`;
  let sprite = spriteCache.get(key);
  if (sprite) {
    return sprite;
  }
  let alpha = puffCache.get(variant);
  if (!alpha) {
    alpha = puffAlpha(variant);
    puffCache.set(variant, alpha);
  }
  sprite = document.createElement("canvas");
  sprite.width = SPRITE;
  sprite.height = SPRITE;
  const g = sprite.getContext("2d") as CanvasRenderingContext2D;
  const img = g.createImageData(SPRITE, SPRITE);
  for (let k = 0; k < alpha.length; k += 1) {
    img.data[k * 4] = rgb[0];
    img.data[k * 4 + 1] = rgb[1];
    img.data[k * 4 + 2] = rgb[2];
    img.data[k * 4 + 3] = Math.round(255 * alpha[k]);
  }
  g.putImageData(img, 0, 0);
  spriteCache.set(key, sprite);
  return sprite;
}

export { hash, smoothstep };
