import { formatScientific, sig } from "../../core/sciFormat";

/**
 * The film is a pure function of "story time" (presentation seconds). This module maps story time
 * to the physical state being shown: time since collapse began, the core's position on the standard
 * collapse track (central density and temperature), the star's surface temperature, the radius of
 * the ionised bubble, and the camera's field of view.
 *
 * Track values follow the textbook picture of star formation (Larson 1969; Masunaga & Inutsuka 2000)
 * and a ~30 M☉ zero-age main-sequence star (central T ≈ 3.5 × 10⁷ K, surface ≈ 38,000 K).
 */

export type ChapterId =
  | "cloud"
  | "collapse"
  | "heating"
  | "protostar"
  | "growing"
  | "ignition"
  | "reveal"
  | "clearing"
  | "shining";

export type Chapter = {
  id: ChapterId;
  title: string;
  short: string;
  caption: string[];
  start: number;
  end: number;
};

export const CHAPTERS: Chapter[] = [
  {
    id: "cloud",
    short: "Cloud",
    title: "A cold, dark cloud",
    caption: [
      "A cloud of molecular hydrogen and dust, dozens of light-years across, at about 10 K (−263 °C).",
      "Its gas pressure holds off its own gravity, until a dense clump tips the balance."
    ],
    start: 0,
    end: 10
  },
  {
    id: "collapse",
    short: "Collapse",
    title: "Gravity takes over",
    caption: [
      "The clump falls in on itself, spinning faster as it shrinks.",
      "While the gas is thin, the heat of compression radiates away: the core stays at about 10 K.",
      "This takes a few hundred thousand years."
    ],
    start: 10,
    end: 26
  },
  {
    id: "heating",
    short: "Heating",
    title: "Trapping the heat",
    caption: [
      "Once the core is dense enough to be opaque, its heat can no longer escape and the temperature climbs.",
      "At about 2,000 K the hydrogen molecules break apart, the core collapses again,",
      "and a protostar is born."
    ],
    start: 26,
    end: 40
  },
  {
    id: "protostar",
    short: "Protostar",
    title: "A protostar",
    caption: [
      "Gas keeps raining in through a spinning disk, and jets blast out along the poles.",
      "The protostar squeezes itself and heats up inside: tens of thousands of degrees, then hundreds of thousands."
    ],
    start: 40,
    end: 52
  },
  {
    id: "growing",
    short: "Piling up",
    title: "Piling on mass",
    caption: [
      "Gas keeps piling onto the young star: about one Sun's worth every 3,000 years.",
      "In under 100,000 years it gathers some 3 × 10⁵⁸ atoms, as much as 30 Suns.",
      "The growing weight squeezes the core ever hotter: a million degrees, then ten million."
    ],
    start: 52,
    end: 68
  },
  {
    id: "ignition",
    short: "Ignition",
    title: "Ignition",
    caption: [
      "At about 10 million K, protons in the core (bottom right) collide hard enough to fuse into helium.",
      "The energy released stops the collapse: a star is born."
    ],
    start: 68,
    end: 80
  },
  {
    id: "reveal",
    short: "Blue star",
    title: "A massive blue star",
    caption: [
      "This one gathered some 30 times the Sun's mass. Its surface is about 38,000 K,",
      "so it shines blue-white, roughly 100,000 times brighter than the Sun."
    ],
    start: 80,
    end: 94
  },
  {
    id: "clearing",
    short: "Clearing",
    title: "Clearing the nursery",
    caption: [
      "Its ultraviolet light strips electrons from the hydrogen around it; the hot, glowing gas expands,",
      "and a fierce stellar wind pushes outward. Within a million years or so the birth cloud is torn apart."
    ],
    start: 94,
    end: 110
  },
  {
    id: "shining",
    short: "Shining",
    title: "Into the Universe",
    caption: [
      "Free of its cocoon, the star floods its surroundings with energetic light.",
      "It will live only a few million years before exploding as a supernova."
    ],
    start: 110,
    end: 122
  }
];

export const STORY_DURATION = CHAPTERS[CHAPTERS.length - 1].end;

export const PARSEC_M = 3.086e16;
export const LIGHT_YEAR_M = 9.461e15;
export const AU_M = 1.496e11;
export const SOLAR_RADIUS_M = 6.957e8;
const SOLAR_MASS_KG = 1.989e30;
const HYDROGEN_KG = 1.6735e-27;
/** Atoms (nuclei) per kilogram of star-forming gas: 70% hydrogen, 28% helium by mass. */
const ATOMS_PER_KG = (0.7 + 0.28 / 4) / HYDROGEN_KG;

/** Story times of the chapter starts that other modules key their effects to. */
export const GROWING_START = 52;
export const IGNITION_START = 68;
/** The proton–proton chain in the core inset starts here, as the core passes 10⁷ K. */
export const FUSION_START = 69;

// ---------- Key frames ----------

/** [story s, years since collapse began]; linear in between. */
const TIME_KEYS: [number, number][] = [
  [0, 0],
  [10, 2e4],
  [26, 2.0e5],
  [36, 2.1e5],
  [40, 2.12e5],
  [46, 2.2e5],
  [52, 2.32e5],
  [68, 2.98e5],
  [74, 3.06e5],
  [80, 3.2e5],
  [94, 4.5e5],
  [110, 1.2e6],
  [122, 2.0e6]
];

/**
 * Mass gathered by the star, in Suns. The protostar is born small and grows at a steady
 * 3.5 × 10⁻⁴ Suns a year (massive stars accrete ~10⁻⁴–10⁻³ a year), tapering off at 30 Suns as its
 * own light starts pushing the gas away. It reaches ~29 Suns as fusion begins.
 */
const BIRTH_YEARS = 2.12e5;
const BIRTH_MASS = 0.05;
const ACCRETION_SUNS_PER_YEAR = 3.5e-4;
const FINAL_MASS = 30;

export function massSunsAt(years: number): number {
  if (years < BIRTH_YEARS) {
    return 0;
  }
  const steady = BIRTH_MASS + ACCRETION_SUNS_PER_YEAR * (years - BIRTH_YEARS);
  const taper = FINAL_MASS - 3;
  return steady < taper ? steady : FINAL_MASS - 3 * Math.exp(-(steady - taper) / 3);
}

export function atomsInSuns(massSuns: number): number {
  return massSuns * SOLAR_MASS_KG * ATOMS_PER_KG;
}

/** Collapse track vertices: [log₁₀ ρ_c (g cm⁻³), log₁₀ T_c (K)] and what happens there. */
export const TRACK: { logRho: number; logT: number; label: string }[] = [
  { logRho: -19, logT: 1.0, label: "dense clump" },
  { logRho: -13, logT: 1.0, label: "core turns opaque" },
  { logRho: -8, logT: 3.3, label: "H₂ splits (2,000 K)" },
  { logRho: -2, logT: 4.3, label: "protostar born" },
  { logRho: -1, logT: 5.0, label: "" },
  { logRho: -0.3, logT: 6.0, label: "deuterium burns" },
  { logRho: 0.3, logT: 7.0, label: "hydrogen fusion" },
  { logRho: 0.5, logT: 7.55, label: "" }
];

/** Story time at which the core reaches each TRACK vertex. */
const TRACK_STORY = [10, 26, 36, 40, 46, 56, FUSION_START, 80];

/**
 * Field of view: [story s, log₁₀ width in metres]. The camera dives from tens of light-years down
 * to the protostar, pulls back a little to watch gas pile onto it, closes in on the star as it
 * ignites, then pulls back out to the whole bubble. The core itself is shown in an inset.
 */
const VIEW_KEYS: [number, number][] = [
  [0, Math.log10(40 * LIGHT_YEAR_M)],
  [9, Math.log10(26 * LIGHT_YEAR_M)],
  [26, Math.log10(0.15 * LIGHT_YEAR_M)],
  [36, Math.log10(300 * AU_M)],
  [42, Math.log10(4 * AU_M)],
  [52, Math.log10(2.5 * AU_M)],
  [58, Math.log10(16 * AU_M)],
  [64, Math.log10(16 * AU_M)],
  [72, Math.log10(50 * SOLAR_RADIUS_M)],
  [80, Math.log10(50 * SOLAR_RADIUS_M)],
  [84, Math.log10(60 * SOLAR_RADIUS_M)],
  [92, Math.log10(2000 * AU_M)],
  [106, Math.log10(8 * LIGHT_YEAR_M)],
  [122, Math.log10(30 * LIGHT_YEAR_M)]
];

/** Surface temperature: [story s, K]; null before the protostar is visible. */
const SURFACE_KEYS: [number, number][] = [
  [40, 3500],
  [52, 5000],
  [68, 12000],
  [80, 30000],
  [88, 38000]
];

/** Radius of the ionised bubble around the star: [story s, log₁₀ metres]. */
const BUBBLE_KEYS: [number, number][] = [
  [88, Math.log10(300 * AU_M)],
  [94, Math.log10(0.05 * LIGHT_YEAR_M)],
  [110, Math.log10(7 * LIGHT_YEAR_M)],
  [122, Math.log10(14 * LIGHT_YEAR_M)]
];

function interp(keys: [number, number][], story: number): number {
  if (story <= keys[0][0]) {
    return keys[0][1];
  }
  for (let i = 1; i < keys.length; i += 1) {
    if (story <= keys[i][0]) {
      const [s0, v0] = keys[i - 1];
      const [s1, v1] = keys[i];
      return v0 + ((v1 - v0) * (story - s0)) / (s1 - s0);
    }
  }
  return keys[keys.length - 1][1];
}

/** Smooth camera: monotone cubic (Fritsch–Carlson) through the view keys, so zooms ease in and out. */
function smoothInterp(keys: [number, number][], story: number): number {
  const n = keys.length;
  if (story <= keys[0][0]) {
    return keys[0][1];
  }
  if (story >= keys[n - 1][0]) {
    return keys[n - 1][1];
  }
  const slopes = keys.slice(0, -1).map(([s0, v0], i) => (keys[i + 1][1] - v0) / (keys[i + 1][0] - s0));
  const tangent = (i: number): number => {
    if (i === 0 || i === n - 1) {
      return 0;
    }
    const a = slopes[i - 1];
    const b = slopes[i];
    return a * b <= 0 ? 0 : (2 * a * b) / (a + b);
  };
  let i = 0;
  while (keys[i + 1][0] < story) {
    i += 1;
  }
  const [s0, v0] = keys[i];
  const [s1, v1] = keys[i + 1];
  const h = s1 - s0;
  const t = (story - s0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * v0 + (t3 - 2 * t2 + t) * h * tangent(i) + (-2 * t3 + 3 * t2) * v1 + (t3 - t2) * h * tangent(i + 1)
  );
}

export type StoryState = {
  story: number;
  chapterIndex: number;
  chapterProgress: number;
  years: number;
  logRho: number;
  coreTempK: number;
  /** Visible stellar surface temperature, or null before there is a star to see. */
  surfaceTempK: number | null;
  /** Field of view in metres (the zoom). */
  viewWidthM: number;
  /** Radius of the ionised bubble in metres, 0 before the star ignites. */
  bubbleM: number;
  /** Mass gathered by the (proto)star, in Suns; 0 before it is born. */
  massSuns: number;
  /** The same, as a number of atoms. */
  atoms: number;
  /** 0..1: visibility of the inset looking inside the core (piling up, then fusion). */
  coreInset: number;
  /** 0..1: visibility of the graph of atoms gathered and core temperature. */
  graph: number;
};

export function chapterIndexAt(story: number): number {
  for (let i = CHAPTERS.length - 1; i >= 0; i -= 1) {
    if (story >= CHAPTERS[i].start) {
      return i;
    }
  }
  return 0;
}

function smoothstep(a: number, b: number, x: number): number {
  const f = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return f * f * (3 - 2 * f);
}

export function trackPoint(story: number): { logRho: number; logT: number } {
  const keysRho: [number, number][] = TRACK_STORY.map((s, i) => [s, TRACK[i].logRho]);
  const keysT: [number, number][] = TRACK_STORY.map((s, i) => [s, TRACK[i].logT]);
  return { logRho: interp(keysRho, story), logT: interp(keysT, story) };
}

export function stateAt(story: number): StoryState {
  const s = Math.min(STORY_DURATION, Math.max(0, story));
  const chapterIndex = chapterIndexAt(s);
  const chapter = CHAPTERS[chapterIndex];
  const track = trackPoint(s);
  const years = interp(TIME_KEYS, s);
  const massSuns = massSunsAt(years);
  return {
    story: s,
    chapterIndex,
    chapterProgress: (s - chapter.start) / (chapter.end - chapter.start),
    years,
    logRho: track.logRho,
    coreTempK: 10 ** track.logT,
    surfaceTempK: s >= SURFACE_KEYS[0][0] ? interp(SURFACE_KEYS, s) : null,
    viewWidthM: 10 ** smoothInterp(VIEW_KEYS, s),
    bubbleM: s >= BUBBLE_KEYS[0][0] ? 10 ** interp(BUBBLE_KEYS, s) : 0,
    massSuns,
    atoms: atomsInSuns(massSuns),
    coreInset: smoothstep(56.5, 58.5, s) * (1 - smoothstep(89, 91.5, s)),
    graph: smoothstep(GROWING_START, GROWING_START + 1.5, s) * (1 - smoothstep(82, 84.5, s))
  };
}

/** Story time at which the field of view equals `widthM` while first zooming in (up to the protostar). */
export function storyAtViewWidth(widthM: number): number {
  const target = Math.log10(widthM);
  let prev = smoothInterp(VIEW_KEYS, 0);
  for (let s = 0.05; s <= GROWING_START; s += 0.05) {
    const v = smoothInterp(VIEW_KEYS, s);
    if ((prev - target) * (v - target) <= 0) {
      return s;
    }
    prev = v;
  }
  return target > prev ? 0 : GROWING_START;
}

// ---------- Formatting ----------

export function formatYears(years: number): string {
  if (years < 1) {
    return "0 yr";
  }
  if (years < 1e6) {
    return `${(Math.round(years / 1000) * 1000).toLocaleString("en-US")} yr`;
  }
  return `${sig(years / 1e6)} million yr`;
}

export function formatTemperature(tempK: number): string {
  return tempK < 1e5 ? `${sig(tempK)} K` : `${formatScientific(tempK)} K`;
}

/** Field-of-view label in units an audience can picture. */
export function formatLength(m: number): string {
  if (m >= 0.3 * LIGHT_YEAR_M) {
    return `${sig(m / LIGHT_YEAR_M)} light-years`;
  }
  if (m >= 3 * AU_M) {
    return `${sig(m / AU_M)} AU (Earth–Sun distances)`;
  }
  return `${sig(m / SOLAR_RADIUS_M)} solar radii`;
}

export function formatAtoms(atoms: number): string {
  return formatScientific(atoms);
}

export function formatSuns(massSuns: number): string {
  return massSuns < 1 ? `${sig(massSuns, 1)} Sun` : `${sig(massSuns)} Suns`;
}
