// Motion library — keyframe presets (entrance / exit / emphasis), additive
// loops, physics expressions, multi-layer plans and branded templates.
//
// Presets are resolved on the Node side into "tracks": per property, a list
// of keys at normalised times 0–1 with RELATIVE values (a multiplier of the
// layer's rest opacity/scale, an offset in units of `distance` along the
// direction, degrees added to rotation, or an absolute effect value). The
// shared JSX engine (ANIM_FN in snippets.ts) turns them into real keys, so a
// preset keeps whatever final value the layer already has.

import { jsxCompPreamble, jsxFail, jsxVal, registerOp, type OperationParam } from "../registry.js";
import { ANIM_EDIT_FN, ANIM_FN } from "./snippets.js";
import { hexToRgb, loadBrand, type BrandKit } from "./studio.js";
import { isTextPreset, shineJob, textJob, type ShineJob, type TextJob } from "./text-motion.js";

// ---------------------------------------------------------------------------
// Preset tables
// ---------------------------------------------------------------------------

export type TrackProp = "opacity" | "position" | "scale" | "rotation" | "rotateY" | "blur" | "wipe";
export type Direction = "left" | "right" | "up" | "down";

interface Key {
  t: number;
  /** opacity: × rest · position: × distance along direction · scale: [×x, ×y] · rotation: +deg · blur/wipe: absolute */
  v: number | number[];
  i: number;
  o: number;
  interp?: string;
}

interface Track {
  prop: TrackProp;
  keys: Key[];
}

interface PresetDef {
  kind: "in" | "emphasis";
  direction: Direction;
  /** Default distance as a fraction of the comp side along the direction. */
  distFactor: number;
  duration: number;
  build(e: EaseCtx): Track[];
}

interface EaseCtx {
  /** Influence of the decelerating (landing) key, 1–100. */
  E: number;
  /** Influence of the accelerating (leaving) key = 100 − E. */
  A: number;
  /** Overshoot as a fraction (0.1 = 10 %); 0 when not requested. */
  os: number;
}

const fade = (until: number): Track => ({
  prop: "opacity",
  keys: [
    { t: 0, v: 0, i: 33, o: 33 },
    { t: until, v: 1, i: 50, o: 33 },
  ],
});

/** Position from `1 × distance` to rest, with an optional overshoot past it. */
function travel(e: EaseCtx): Track {
  const keys: Key[] = [{ t: 0, v: 1, i: 33, o: e.A }];
  if (e.os > 0) {
    keys.push({ t: 0.7, v: -e.os, i: e.E, o: 40 });
    keys.push({ t: 1, v: 0, i: 60, o: 33 });
  } else {
    keys.push({ t: 1, v: 0, i: e.E, o: 33 });
  }
  return { prop: "position", keys };
}

const ENTRANCES: Record<string, PresetDef> = {
  fade: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.6,
    build: (e) => [
      {
        prop: "opacity",
        keys: [
          { t: 0, v: 0, i: 33, o: e.A },
          { t: 1, v: 1, i: e.E, o: 33 },
        ],
      },
    ],
  },
  rise: {
    kind: "in",
    direction: "down",
    distFactor: 0.06,
    duration: 0.6,
    build: (e) => [travel(e), fade(0.4)],
  },
  slide: {
    kind: "in",
    direction: "left",
    distFactor: 0.25,
    duration: 0.6,
    build: (e) => [travel(e), fade(0.35)],
  },
  scale: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.6,
    build: (e) => [
      {
        prop: "scale",
        keys: [
          { t: 0, v: [0, 0], i: 33, o: e.A },
          { t: 1, v: [1, 1], i: e.E, o: 33 },
        ],
      },
      fade(0.3),
    ],
  },
  pop: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.6,
    build: (e) => {
      const peak = 1 + (e.os || 0.1);
      return [
        {
          prop: "scale",
          keys: [
            { t: 0, v: [0, 0], i: 33, o: e.A },
            { t: 0.6, v: [peak, peak], i: e.E, o: 40 },
            { t: 1, v: [1, 1], i: 70, o: 33 },
          ],
        },
        fade(0.25),
      ];
    },
  },
  drop: {
    kind: "in",
    direction: "up",
    distFactor: 0.3,
    duration: 0.9,
    build: (e) => {
      const hop = e.os || 0.12;
      return [
        {
          prop: "position",
          keys: [
            // Falls: slow off the top, fastest at the impact.
            { t: 0, v: 1, i: 33, o: 60 },
            { t: 0.55, v: 0, i: 8, o: 45 },
            { t: 0.78, v: hop, i: 60, o: 60 },
            { t: 1, v: 0, i: 15, o: 33 },
          ],
        },
        fade(0.25),
      ];
    },
  },
  rotate: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.7,
    build: (e) => [
      {
        prop: "rotation",
        keys: [
          { t: 0, v: -30 - e.os * 100, i: 33, o: e.A },
          { t: 1, v: 0, i: e.E, o: 33 },
        ],
      },
      {
        prop: "scale",
        keys: [
          { t: 0, v: [0.6, 0.6], i: 33, o: e.A },
          { t: 1, v: [1, 1], i: e.E, o: 33 },
        ],
      },
      fade(0.35),
    ],
  },
  blur: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.7,
    build: (e) => [
      {
        prop: "blur",
        keys: [
          { t: 0, v: 40, i: 33, o: e.A },
          { t: 1, v: 0, i: e.E, o: 33 },
        ],
      },
      fade(0.5),
    ],
  },
  wipe: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.7,
    build: (e) => [
      {
        prop: "wipe",
        keys: [
          { t: 0, v: 100, i: 33, o: e.A },
          { t: 1, v: 0, i: e.E, o: 33 },
        ],
      },
    ],
  },
  stretch: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.7,
    build: (e) => [
      {
        prop: "scale",
        keys: [
          { t: 0, v: [1.6, 0.15], i: 33, o: e.A },
          { t: 0.55, v: [0.92, 1.1], i: 60, o: 40 },
          { t: 0.8, v: [1.03, 0.98], i: 50, o: 50 },
          { t: 1, v: [1, 1], i: 60, o: 33 },
        ],
      },
      fade(0.25),
    ],
  },
};

// Looks learned from event-reel references (23/10/2026): side-scroller
// pushes, whip pans with heavy motion blur, 3D card flips, the parachute
// mascot swinging down, and the dreamy zoom-blur of "Adore You".
Object.assign(ENTRANCES, {
  // Clean push, no fade: the layer travels a full frame width/height.
  push: {
    kind: "in",
    direction: "right",
    distFactor: 1,
    duration: 0.7,
    build: (e: EaseCtx) => [
      {
        prop: "position",
        keys: [
          { t: 0, v: 1, i: 33, o: Math.min(e.A, 10) },
          { t: 1, v: 0, i: Math.max(e.E, 88), o: 33 },
        ],
      },
    ],
  },
  // Whip pan: very fast, very eased, relies on motion blur for the smear.
  whip: {
    kind: "in",
    direction: "right",
    distFactor: 0.8,
    duration: 0.35,
    build: () => [
      {
        prop: "position",
        keys: [
          { t: 0, v: 1, i: 33, o: 5 },
          { t: 1, v: 0, i: 95, o: 33 },
        ],
      },
      {
        prop: "opacity",
        keys: [
          { t: 0, v: 0, i: 33, o: 33 },
          { t: 0.15, v: 1, i: 33, o: 33 },
        ],
      },
    ],
  },
  // 3D card flip around the vertical axis (the layer is made 3D).
  flip: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.7,
    build: (e: EaseCtx) => [
      {
        prop: "rotateY",
        keys: [
          { t: 0, v: -90, i: 33, o: e.A },
          { t: 0.75, v: 8 + e.os * 60, i: 70, o: 40 },
          { t: 1, v: 0, i: 60, o: 33 },
        ],
      },
      {
        prop: "opacity",
        keys: [
          { t: 0, v: 0, i: 33, o: 33 },
          { t: 0.2, v: 1, i: 33, o: 33 },
        ],
      },
    ],
  },
  // Parachute: drifts down from above while swinging, the swing dies out.
  swing: {
    kind: "in",
    direction: "up",
    distFactor: 0.35,
    duration: 1.4,
    build: (e: EaseCtx) => [
      {
        prop: "position",
        keys: [
          { t: 0, v: 1, i: 33, o: 20 },
          { t: 0.75, v: 0, i: e.E, o: 33 },
        ],
      },
      {
        prop: "rotation",
        keys: [
          { t: 0, v: -14, i: 33, o: 50 },
          { t: 0.3, v: 10, i: 60, o: 60 },
          { t: 0.55, v: -6, i: 60, o: 60 },
          { t: 0.78, v: 3, i: 60, o: 60 },
          { t: 1, v: 0, i: 70, o: 33 },
        ],
      },
      fade(0.2),
    ],
  },
  // Premium soft reveal: settles from 130 % out of a blur.
  zoom_blur: {
    kind: "in",
    direction: "left",
    distFactor: 0,
    duration: 0.9,
    build: (e: EaseCtx) => [
      {
        prop: "scale",
        keys: [
          { t: 0, v: [1.3, 1.3], i: 33, o: e.A },
          { t: 1, v: [1, 1], i: Math.max(e.E, 90), o: 33 },
        ],
      },
      {
        prop: "blur",
        keys: [
          { t: 0, v: 30, i: 33, o: e.A },
          { t: 0.85, v: 0, i: e.E, o: 33 },
        ],
      },
      fade(0.45),
    ],
  },
} as Record<string, PresetDef>);

const EMPHASES: Record<string, PresetDef> = {
  // Slow push-in across the whole duration (backgrounds). overshoot = zoom amount (default 6 %).
  ken_burns: {
    kind: "emphasis",
    direction: "left",
    distFactor: 0,
    duration: 5,
    build: (e) => {
      const z = 1 + (e.os || 0.06);
      return [
        {
          prop: "scale",
          keys: [
            { t: 0, v: [1, 1], i: 33, o: 20 },
            { t: 1, v: [z, z], i: 40, o: 33 },
          ],
        },
      ];
    },
  },
  pulse: {
    kind: "emphasis",
    direction: "left",
    distFactor: 0,
    duration: 0.5,
    build: (e) => {
      const k = 1 + (e.os || 0.08);
      return [
        {
          prop: "scale",
          keys: [
            { t: 0, v: [1, 1], i: 33, o: 40 },
            { t: 0.4, v: [k, k], i: 50, o: 50 },
            { t: 1, v: [1, 1], i: 60, o: 33 },
          ],
        },
      ];
    },
  },
  shake: {
    kind: "emphasis",
    direction: "left",
    distFactor: 0.012,
    duration: 0.5,
    build: () => {
      const vs = [0, 1, -1, 0.7, -0.4, 0.15, 0];
      return [
        {
          prop: "position",
          keys: vs.map((v, n) => ({ t: n / (vs.length - 1), v, i: 33, o: 33 })),
        },
      ];
    },
  },
  nudge: {
    kind: "emphasis",
    direction: "right",
    distFactor: 0.02,
    duration: 0.5,
    build: (e) => [
      {
        prop: "position",
        keys: [
          { t: 0, v: 0, i: 33, o: e.A },
          { t: 0.35, v: 1, i: e.E, o: 40 },
          { t: 0.7, v: -(e.os || 0.15), i: 50, o: 50 },
          { t: 1, v: 0, i: 60, o: 33 },
        ],
      },
    ],
  },
};

export const ENTRANCE_PRESETS = Object.keys(ENTRANCES).map((n) => `${n}_in`);
export const EXIT_PRESETS = Object.keys(ENTRANCES).map((n) => `${n}_out`);
export const EMPHASIS_PRESETS = Object.keys(EMPHASES);
export const ALL_PRESETS = [...ENTRANCE_PRESETS, ...EXIT_PRESETS, ...EMPHASIS_PRESETS];

/** An exit is its entrance played backwards: times mirrored, ease sides swapped. */
function mirror(tracks: Track[]): Track[] {
  return tracks.map((tr) => ({
    prop: tr.prop,
    keys: tr.keys
      .map((k) => ({ ...k, t: Math.round((1 - k.t) * 10000) / 10000, i: k.o, o: k.i }))
      .reverse(),
  }));
}

export interface PresetOptions {
  start?: number | null;
  duration?: number;
  direction?: Direction;
  distance?: number | null;
  overshoot?: number;
  easeStrength?: number;
  replace?: boolean;
  motionBlur?: boolean;
}

export interface AnimJob {
  preset: string;
  kind: "in" | "out" | "emphasis";
  start: number | null;
  duration: number;
  direction: Direction;
  distance: number | null;
  distFactor: number;
  replace: boolean;
  motionBlur: boolean;
  tracks: Track[];
}

/** Resolve a preset name + options into the job the JSX engine runs. Throws on bad input. */
export function presetJob(preset: string, opts: PresetOptions = {}): AnimJob {
  let def: PresetDef | undefined;
  let kind: AnimJob["kind"];
  if (preset.endsWith("_in") && ENTRANCES[preset.slice(0, -3)]) {
    def = ENTRANCES[preset.slice(0, -3)];
    kind = "in";
  } else if (preset.endsWith("_out") && ENTRANCES[preset.slice(0, -4)]) {
    def = ENTRANCES[preset.slice(0, -4)];
    kind = "out";
  } else if (EMPHASES[preset]) {
    def = EMPHASES[preset];
    kind = "emphasis";
  } else {
    throw new Error(`unknown preset '${preset}'. Known: ${ALL_PRESETS.join(", ")}`);
  }
  const E = clamp(opts.easeStrength ?? 85, 1, 99);
  const ctx: EaseCtx = { E, A: Math.max(1, 100 - E), os: Math.max(0, opts.overshoot ?? 0) };
  let tracks = def.build(ctx);
  if (kind === "out") tracks = mirror(tracks);
  let distance = opts.distance ?? null;
  // For blur presets `distance` is the blur radius: rescale the absolute keys.
  if (distance !== null && tracks.some((t) => t.prop === "blur")) {
    const f = distance / 40;
    tracks = tracks.map((t) =>
      t.prop === "blur" ? { ...t, keys: t.keys.map((k) => ({ ...k, v: (k.v as number) * f })) } : t,
    );
    distance = null;
  }
  const duration = opts.duration ?? def.duration;
  if (!(duration > 0)) throw new Error("duration must be > 0 seconds");
  return {
    preset,
    kind,
    start: opts.start ?? null,
    duration,
    direction: opts.direction ?? def.direction,
    distance,
    distFactor: def.distFactor,
    replace: opts.replace ?? false,
    motionBlur: opts.motionBlur ?? true,
    tracks,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

// ---------------------------------------------------------------------------
// Loops (additive expressions)
// ---------------------------------------------------------------------------

export const LOOP_TYPES = [
  "float",
  "sway",
  "pulse",
  "wiggle",
  "spin",
  "twinkle",
  "hop",
  "flutter",
] as const;

export interface LoopOptions {
  amplitude?: number | null;
  frequency?: number | null;
  startAfter?: number | "auto" | null;
  seed?: number;
  replace?: boolean;
}

/**
 * A Slider Control the expression reads, so the loop stays tweakable by hand
 * in Effect Controls. `value` (explicit) always wins; otherwise a slider that
 * already exists keeps whatever the user set, and a new one starts at
 * `value ?? compFactor × comp height`.
 */
export interface LoopControl {
  name: string;
  value: number | null;
  compFactor?: number;
  fallback: number;
  explicit: boolean;
}

export interface ExprJob {
  preset: string;
  target: string | (string | number)[];
  axis: number | null;
  exprArr: string;
  exprScalar: string;
  startAfter: number | "auto" | null;
  seed: number;
  replace: boolean;
  controls: LoopControl[];
}

const num = (n: number) => String(Math.round(n * 100000) / 100000);
const slider = (name: string) => `effect(${JSON.stringify(name)})("ADBE Slider Control-0001")`;

/** Lines every loop shares: a 0.3 s eased ramp from startAfter, local time, a per-layer phase. */
const LOOP_HEAD = [
  "var sa = __SA__;",
  "var ramp = ease(time, sa, sa + 0.3, 0, 1);",
  "var t = Math.max(0, time - sa);",
  "seedRandom(__SEED__, true);",
  "var ph = random(0, Math.PI * 2);",
].join("\n");

/** Vietnamese label per loop type — the slider names anh sees in Effect Controls. */
const LOOP_LABEL: Record<string, string> = {
  float: "Trôi",
  sway: "Lắc",
  pulse: "Nhịp",
  wiggle: "Rung",
  spin: "Xoay",
  twinkle: "Lấp lánh",
  hop: "Nhảy",
  flutter: "Bay lượn",
};

interface LoopDefaults {
  amp: number;
  ampFactor?: number;
  freq: number | null;
  ampName: string;
}

const LOOP_DEFAULTS: Record<string, LoopDefaults> = {
  float: { amp: 16, ampFactor: 0.012, freq: 0.5, ampName: "biên độ (px)" },
  sway: { amp: 4, freq: 0.4, ampName: "biên độ (độ)" },
  pulse: { amp: 4, freq: 1, ampName: "biên độ (%)" },
  wiggle: { amp: 10, ampFactor: 0.008, freq: 1, ampName: "biên độ (px)" },
  spin: { amp: 30, freq: null, ampName: "tốc độ (độ/giây)" },
  twinkle: { amp: 60, freq: 1.5, ampName: "độ chớp (%)" },
  hop: { amp: 30, ampFactor: 0.02, freq: 1.2, ampName: "độ cao (px)" },
  flutter: { amp: 40, ampFactor: 0.03, freq: 0.35, ampName: "biên độ (px)" },
};

export function loopJob(type: string, opts: LoopOptions = {}): ExprJob {
  const d = LOOP_DEFAULTS[type];
  if (!d) throw new Error(`unknown loop type '${type}'. Known: ${LOOP_TYPES.join(", ")}`);
  const label = LOOP_LABEL[type];
  const ampName = `${label} · ${d.ampName}`;
  const freqName = `${label} · tần số (lần/giây)`;
  // pulse and twinkle sliders read in percent; the option stays a fraction.
  const pct = type === "pulse" || type === "twinkle";
  const ampVal = opts.amplitude == null ? null : pct ? opts.amplitude * 100 : opts.amplitude;
  const controls: LoopControl[] = [
    {
      name: ampName,
      value: ampVal,
      ...(d.ampFactor ? { compFactor: d.ampFactor } : {}),
      fallback: d.amp,
      explicit: ampVal !== null,
    },
  ];
  if (d.freq !== null)
    controls.push({
      name: freqName,
      value: opts.frequency ?? null,
      fallback: d.freq,
      explicit: opts.frequency != null,
    });
  const A = slider(ampName);
  const F = d.freq === null ? "" : slider(freqName);
  const head = `${LOOP_HEAD}\nvar amp = ${A};${F ? `\nvar freq = ${F};` : ""}`;
  const wave = "Math.sin(t * freq * Math.PI * 2 + ph)";
  const base = {
    preset: type,
    startAfter: opts.startAfter === undefined ? ("auto" as const) : opts.startAfter,
    seed: opts.seed ?? 0,
    replace: opts.replace ?? false,
    controls,
  };
  switch (type) {
    case "float": {
      const body = `${head}\nvar off = ${wave} * amp * ramp;`;
      return {
        ...base,
        target: "position",
        axis: 1,
        exprArr: `${body}\nvar d = [0, off];\nif (value.length > 2) d = [0, off, 0];\nadd(value, d);`,
        exprScalar: `${body}\nvalue + off;`,
      };
    }
    case "sway": {
      const e = `${head}\nvalue + ${wave} * amp * ramp;`;
      return { ...base, target: "rotation", axis: null, exprArr: e, exprScalar: e };
    }
    case "pulse": {
      const e = `${head}\nvar k = 1 + ${wave} * amp / 100 * ramp;\nvar r = [];\nfor (var i = 0; i < value.length; i++) r.push(value[i] * k);\nr;`;
      return { ...base, target: "scale", axis: null, exprArr: e, exprScalar: e };
    }
    case "wiggle": {
      const e = `${head}\nvar w = sub(wiggle(freq, amp), value);\nadd(value, mul(w, ramp));`;
      return { ...base, target: "position", axis: null, exprArr: e, exprScalar: e };
    }
    case "spin": {
      const e = `${head}\nvalue + amp * t * ramp;`;
      return { ...base, target: "rotation", axis: null, exprArr: e, exprScalar: e };
    }
    case "hop": {
      // Mascot hop (side-scroller reel): quick lift, landing on the beat.
      const body = `${head}\nvar off = -Math.abs(Math.sin(t * freq * Math.PI + ph)) * amp * ramp;`;
      return {
        ...base,
        target: "position",
        axis: 1,
        exprArr: `${body}\nvar d = [0, off];\nif (value.length > 2) d = [0, off, 0];\nadd(value, d);`,
        exprScalar: `${body}\nvalue + off;`,
      };
    }
    case "flutter": {
      // Butterfly figure-eight drift.
      const e = `${head}\nvar w = t * freq * Math.PI * 2 + ph;\nvar d = [Math.sin(w) * amp, Math.sin(2 * w) * amp * 0.45];\nif (value.length > 2) d.push(0);\nadd(value, mul(d, ramp));`;
      return {
        ...base,
        target: "position",
        axis: null,
        exprArr: e,
        exprScalar: `${head}\nvalue + Math.sin(t * freq * Math.PI * 2 + ph) * amp * ramp;`,
      };
    }
    default: {
      const e = `${head}\nvalue * (1 - amp / 100 * (0.5 + 0.5 * ${wave}) * ramp);`;
      return { ...base, target: "opacity", axis: null, exprArr: e, exprScalar: e };
    }
  }
}

// ---------------------------------------------------------------------------
// Physics / utility expressions (expression.apply_preset)
// ---------------------------------------------------------------------------

// The key at or before `time` (n = 0 when none) and the time since it.
const PREV_KEY = [
  "var n = 0;",
  "if (numKeys > 0) {",
  "  n = nearestKey(time).index;",
  "  if (key(n).time > time) n--;",
  "}",
  "var t = 0;",
  "if (n > 0) t = time - key(n).time;",
].join("\n");
// Velocity arriving at key n, sampled a tenth of a frame before it.
const V_IN = "velocityAtTime(key(n).time - thisComp.frameDuration / 10)";

export const EXPRESSION_PRESETS = [
  "inertia",
  "bounce_back",
  "elastic",
  "loop_cycle",
  "loop_pingpong",
  "wiggle",
  "wiggle_x",
  "wiggle_y",
  "looping_wiggle",
  "speed_control",
] as const;

type P = Record<string, unknown>;
const pnum = (p: P, k: string, d: number): string => {
  const v = p[k];
  if (v === undefined || v === null) return num(d);
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`params.${k} must be a number`);
  return num(v);
};

/** Expression text for one preset. Pure: depends only on its inputs. */
export function expressionPreset(
  preset: string,
  p: P = {},
): { expr: string; axis: number | null; controls?: LoopControl[] } {
  switch (preset) {
    case "inertia":
      return {
        axis: null,
        expr: [
          PREV_KEY,
          `var friction = ${pnum(p, "friction", 5)};`,
          "if (n > 0 && t > 0) {",
          `  var v = ${V_IN};`,
          "  value + v * (1 - Math.exp(-friction * t)) / friction;",
          "} else {",
          "  value;",
          "}",
        ].join("\n"),
      };
    case "elastic":
      return {
        axis: null,
        expr: [
          PREV_KEY,
          `var amp = ${pnum(p, "amplitude", 0.06)};`,
          `var freq = ${pnum(p, "frequency", 2.5)};`,
          `var decay = ${pnum(p, "decay", 6)};`,
          "if (n > 0 && t > 0) {",
          `  var v = ${V_IN};`,
          "  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);",
          "} else {",
          "  value;",
          "}",
        ].join("\n"),
      };
    case "bounce_back":
      // Rebounds off each key value like a ball off a floor: gravity pulls
      // it back, each rebound keeps `elasticity` of the speed.
      return {
        axis: null,
        expr: [
          PREV_KEY,
          `var e = ${pnum(p, "elasticity", 0.7)};`,
          `var g = ${pnum(p, "gravity", 5000)};`,
          `var nMax = ${pnum(p, "maxBounces", 9)};`,
          "if (n > 0 && t > 0) {",
          `  var v = ${V_IN};`,
          "  var isArr = (v instanceof Array);",
          "  var vl = 0;",
          "  var vu = 1;",
          "  if (isArr) {",
          "    vl = length(v) * e;",
          "    vu = (vl > 0) ? normalize(v) * -1 : v;",
          "  } else {",
          "    vl = Math.abs(v) * e;",
          "    vu = (v < 0) ? 1 : -1;",
          "  }",
          "  var tCur = 0;",
          "  var seg = 2 * vl / g;",
          "  var tNext = seg;",
          "  var nb = 1;",
          "  while (tNext < t && nb <= nMax) { vl *= e; seg *= e; tCur = tNext; tNext += seg; nb++; }",
          "  if (nb <= nMax) {",
          "    var d = t - tCur;",
          "    value + vu * d * (vl - g * d / 2);",
          "  } else {",
          "    value;",
          "  }",
          "} else {",
          "  value;",
          "}",
        ].join("\n"),
      };
    case "loop_cycle":
      return { axis: null, expr: 'loopOut("cycle");' };
    case "loop_pingpong":
      return { axis: null, expr: 'loopOut("pingpong");' };
    case "wiggle":
      return {
        axis: null,
        expr: `wiggle(${pnum(p, "frequency", 2)}, ${pnum(p, "amplitude", 30)});`,
      };
    case "wiggle_x":
    case "wiggle_y": {
      const ax = preset === "wiggle_x" ? 0 : 1;
      return {
        axis: ax,
        expr: [
          `var w = wiggle(${pnum(p, "frequency", 2)}, ${pnum(p, "amplitude", 30)});`,
          "if (value instanceof Array) {",
          "  var r = [];",
          `  for (var i = 0; i < value.length; i++) r.push((i === ${ax}) ? w[i] : value[i]);`,
          "  r;",
          "} else {",
          "  w;",
          "}",
        ].join("\n"),
      };
    }
    case "looping_wiggle":
      // Crossfades a wiggle sampled at t with one sampled a loop earlier, so
      // the end of each cycle lands exactly on its start.
      return {
        axis: null,
        expr: [
          `var freq = ${pnum(p, "frequency", 2)};`,
          `var amp = ${pnum(p, "amplitude", 30)};`,
          `var loopTime = ${pnum(p, "loopTime", 3)};`,
          "var t = time % loopTime;",
          "var w1 = wiggle(freq, amp, 1, 0.5, t);",
          "var w2 = wiggle(freq, amp, 1, 0.5, t - loopTime);",
          "linear(t, 0, loopTime, w1, w2);",
        ].join("\n"),
      };
    case "speed_control": {
      // Integrates a keyframed "units per second" slider from the layer's
      // inPoint. Multiplying the slider by time instead runs the property
      // backwards whenever the speed eases off.
      const name = typeof p.controlName === "string" && p.controlName ? p.controlName : "Speed";
      return {
        axis: null,
        controls: [
          {
            name,
            value: typeof p.speed === "number" ? p.speed : null,
            fallback: 100,
            explicit: typeof p.speed === "number",
          },
        ],
        expr: [
          `var s = effect(${JSON.stringify(name)})("ADBE Slider Control-0001");`,
          `var mult = ${pnum(p, "multiplier", 1)};`,
          "var acc = 0;",
          "var start = inPoint;",
          "if (time > start) {",
          "  for (var k = 1; k <= s.numKeys && start < time; k++) {",
          "    var end = Math.min(time, s.key(k).time);",
          "    if (end > start) {",
          "      acc += s.valueAtTime((start + end) / 2) * (end - start);",
          "      start = end;",
          "    }",
          "  }",
          "  if (start < time) acc += s.valueAtTime((start + time) / 2) * (time - start);",
          "}",
          "acc *= mult;",
          "if (value instanceof Array) {",
          "  var out = [];",
          "  for (var i = 0; i < value.length; i++) out.push(value[i] + acc);",
          "  out;",
          "} else {",
          "  value + acc;",
          "}",
        ].join("\n"),
      };
    }
    default:
      throw new Error(
        `unknown expression preset '${preset}'. Known: ${EXPRESSION_PRESETS.join(", ")}`,
      );
  }
}

// ---------------------------------------------------------------------------
// Shared parameter docs
// ---------------------------------------------------------------------------

const LAYERS_PARAM: OperationParam = {
  name: "layers",
  type: "any",
  description: "Layer index, name, { id }, 'selected', 'all', or an array of those",
  required: true,
};

const PRESET_OPTION_PARAMS: OperationParam[] = [
  {
    name: "start",
    type: "number",
    description:
      "Comp time (s) the animation begins for the first layer. Default: entrance/emphasis at the layer's inPoint, exit at outPoint − duration",
    required: false,
  },
  {
    name: "duration",
    type: "number",
    description: "Seconds (default 0.6; drop 0.9, rotate/blur/wipe/stretch 0.7, emphasis 0.5)",
    required: false,
  },
  {
    name: "stagger",
    type: "number",
    description: "Seconds added per following layer (default 0)",
    required: false,
  },
  {
    name: "direction",
    type: "string",
    description:
      "left | right | up | down — the side a slide/rise/drop comes FROM (exits leave toward it); wipe reveal side; shake/nudge axis",
    required: false,
  },
  {
    name: "distance",
    type: "number",
    description:
      "Travel in px (default from comp size: rise 6 %, slide 25 %, drop 30 % of the side along the direction). For blur presets: the blur radius (default 40)",
    required: false,
  },
  {
    name: "overshoot",
    type: "number",
    description:
      "Overshoot fraction, e.g. 0.1 = 10 % (pop default 0.1, drop hop 0.12; slide/rise only overshoot when set)",
    required: false,
  },
  {
    name: "easeStrength",
    type: "number",
    description:
      "Influence % of the landing key, 1–99 (default 85; the leaving key gets 100 − this)",
    required: false,
  },
  {
    name: "replace",
    type: "boolean",
    description:
      "Overwrite keys that already sit inside the animation window (default false: such layers are skipped and reported). Keys outside the window are never touched",
    required: false,
  },
  {
    name: "motionBlur",
    type: "boolean",
    description:
      "Switch on layer + comp motion blur for presets that move, scale or rotate (default true; never switched off)",
    required: false,
  },
];

function presetOptions(src: Record<string, unknown>): PresetOptions {
  return {
    start: (src.start as number | undefined) ?? null,
    duration: src.duration as number | undefined,
    direction: src.direction as Direction | undefined,
    distance: (src.distance as number | undefined) ?? null,
    overshoot: src.overshoot as number | undefined,
    easeStrength: src.easeStrength as number | undefined,
    replace: src.replace as boolean | undefined,
    motionBlur: src.motionBlur as boolean | undefined,
  };
}

const DIRECTIONS = ["left", "right", "up", "down"];

function checkDirection(d: unknown): string | null {
  if (d === undefined || d === null) return null;
  return DIRECTIONS.includes(String(d))
    ? null
    : `direction must be one of ${DIRECTIONS.join(", ")}`;
}

// ---------------------------------------------------------------------------
// anim.apply
// ---------------------------------------------------------------------------

registerOp({
  name: "anim.apply",
  category: "anim",
  description:
    "Animate layers with a keyframe preset that keeps each layer's current (final) values. " +
    `Entrances: ${ENTRANCE_PRESETS.join(", ")}. Exits (the entrance reversed): ${EXIT_PRESETS.join(", ")}. ` +
    `Emphasis: ${EMPHASIS_PRESETS.join(", ")}. ` +
    "Eases follow motion-design defaults (entrance: fast start, long settle at influence 85; exit reversed). " +
    "Separated position dimensions, 3D layers and existing keys outside the animation window are handled. blur_* adds Fast Box Blur and wipe_* Linear Wipe, named 'Blur (anim)' / 'Wipe (anim)'. " +
    "Moving presets switch motion blur on (layer and comp). Several layers with stagger animate in sequence. Everything lands as ordinary keyframes on the layer, editable by hand afterwards. One call = one undo step.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    LAYERS_PARAM,
    {
      name: "preset",
      type: "string",
      description: "Preset name (see description)",
      required: true,
    },
    ...PRESET_OPTION_PARAMS,
  ],
  toJsx(args) {
    const bad = checkDirection(args.direction);
    if (bad) return jsxFail(bad);
    let job: AnimJob;
    try {
      job = presetJob(String(args.preset), presetOptions(args));
    } catch (e) {
      return jsxFail((e as Error).message);
    }
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layers)});
            if (!_layers.length) return { ok: false, error: "no layers matched " + ${jsxVal(JSON.stringify(args.layers))} };
            var _job = ${jsxVal(job)};
            var _stagger = ${jsxVal(args.stagger ?? 0)};
            var _out = [];
            var _done = 0;
            for (var _i = 0; _i < _layers.length; _i++) {
                var _l = _layers[_i];
                var _j = _job;
                _j.start = ${jsxVal(job.start)};
                if (_j.start === null && _stagger) {
                    if (_j.kind === "out") _j.start = _l.outPoint - _j.duration - _stagger * (_layers.length - 1 - _i);
                    else _j.start = _l.inPoint + _stagger * _i;
                } else if (_j.start !== null) {
                    _j.start = _j.start + _stagger * _i;
                }
                var _r = _animApply(_l, _j);
                if (!_r.skipped) _done++;
                _out.push(_r);
            }
            return { ok: true, comp: _comp.name, preset: _job.preset, animated: _done, skipped: _out.length - _done, layers: _out };
        `;
  },
});

// ---------------------------------------------------------------------------
// anim.loop
// ---------------------------------------------------------------------------

registerOp({
  name: "anim.loop",
  category: "anim",
  description:
    "Add a looping motion by expression, ADDED on top of the layer's own value and keyframes (value + …), so it combines with anim.apply. " +
    "Types: float (position Y bob), sway (rotation), pulse (scale), wiggle (position), spin (rotation, deg/s), twinkle (opacity flicker). " +
    "It starts after the layer's entrance keyframes finish (startAfter 'auto') with a 0.3 s soft ramp, and each layer gets its own phase (seed by layer) so several objects never move in sync. " +
    "Amplitude and frequency live in Slider Controls on the layer (e.g. 'Trôi · biên độ (px)') that the expression reads, so they can be tuned by hand in Effect Controls; re-running keeps a slider's hand-set value unless amplitude/frequency is passed. One call = one undo step.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    LAYERS_PARAM,
    { name: "type", type: "string", description: LOOP_TYPES.join(" | "), required: true },
    {
      name: "amplitude",
      type: "number",
      description:
        "float/wiggle: px (default 1.2 % / 0.8 % of comp height) · sway: degrees (4) · pulse: fraction (0.04) · spin: deg per second (30) · twinkle: opacity dip fraction (0.6)",
      required: false,
    },
    {
      name: "frequency",
      type: "number",
      description: "Cycles per second (float 0.5, sway 0.4, pulse 1, wiggle 1, twinkle 1.5)",
      required: false,
    },
    {
      name: "startAfter",
      type: "any",
      description:
        "'auto' (default: end of entrance keys), a comp time in seconds, or 0 to start immediately",
      required: false,
    },
    {
      name: "seed",
      type: "number",
      description: "Extra random seed; layers already differ by index (default 0)",
      required: false,
    },
    {
      name: "replace",
      type: "boolean",
      description:
        "Overwrite an existing expression on the property (default false: skip and report)",
      required: false,
    },
  ],
  toJsx(args) {
    let job: ExprJob;
    try {
      job = loopJob(String(args.type), {
        amplitude: args.amplitude as number | undefined,
        frequency: args.frequency as number | undefined,
        startAfter: args.startAfter as number | "auto" | undefined,
        seed: args.seed as number | undefined,
        replace: args.replace as boolean | undefined,
      });
    } catch (e) {
      return jsxFail((e as Error).message);
    }
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layers)});
            if (!_layers.length) return { ok: false, error: "no layers matched " + ${jsxVal(JSON.stringify(args.layers))} };
            var _job = ${jsxVal(job)};
            var _out = [];
            for (var _i = 0; _i < _layers.length; _i++) _out.push(_animExprApply(_layers[_i], _job));
            return { ok: true, comp: _comp.name, type: _job.preset, layers: _out };
        `;
  },
});

// ---------------------------------------------------------------------------
// expression.apply_preset
// ---------------------------------------------------------------------------

registerOp({
  name: "expression.apply_preset",
  category: "expression",
  description:
    "Attach a physics or utility expression that runs on top of keyframes: inertia (drifts past each key and slows down; params.friction), bounce_back (rebounds off each key like a ball; elasticity, gravity, maxBounces), elastic (damped wobble after each key; amplitude, frequency, decay), loop_cycle, loop_pingpong (need keys), wiggle, wiggle_x, wiggle_y (frequency, amplitude), looping_wiggle (seamless every loopTime s), speed_control (integrates a Slider 'Speed' it adds when missing; params.controlName, speed, multiplier). " +
    "All are render-stable (no clock time). Separated position dimensions get the expression per axis.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    LAYERS_PARAM,
    { name: "preset", type: "string", description: EXPRESSION_PRESETS.join(" | "), required: true },
    {
      name: "property",
      type: "any",
      description:
        "position | scale | rotation | opacity | anchorPoint, or a property path array (matchNames/names), e.g. ['ADBE Effect Parade', 'Glow', 'Glow Intensity']. Default position",
      required: false,
    },
    {
      name: "params",
      type: "object",
      description: "Preset parameters (see description)",
      required: false,
    },
    {
      name: "replace",
      type: "boolean",
      description: "Overwrite an existing expression (default false: skip and report)",
      required: false,
    },
  ],
  toJsx(args) {
    let preset: ReturnType<typeof expressionPreset>;
    try {
      preset = expressionPreset(String(args.preset), (args.params ?? {}) as P);
    } catch (e) {
      return jsxFail((e as Error).message);
    }
    const job: ExprJob = {
      preset: String(args.preset),
      target: (args.property as ExprJob["target"]) ?? "position",
      axis: preset.axis,
      exprArr: preset.expr,
      exprScalar:
        preset.axis === null
          ? preset.expr
          : "wiggle(" +
            pnum((args.params ?? {}) as P, "frequency", 2) +
            ", " +
            pnum((args.params ?? {}) as P, "amplitude", 30) +
            ");",
      startAfter: null,
      seed: 0,
      replace: (args.replace as boolean | undefined) ?? false,
      controls: preset.controls ?? [],
    };
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layers)});
            if (!_layers.length) return { ok: false, error: "no layers matched " + ${jsxVal(JSON.stringify(args.layers))} };
            var _job = ${jsxVal(job)};
            var _out = [];
            for (var _i = 0; _i < _layers.length; _i++) _out.push(_animExprApply(_layers[_i], _job));
            return { ok: true, comp: _comp.name, preset: _job.preset, layers: _out };
        `;
  },
});

// ---------------------------------------------------------------------------
// anim.apply_plan
// ---------------------------------------------------------------------------

export interface PlanStep extends PresetOptions {
  layer: unknown;
  preset: string;
  /** text.animate options */
  spread?: number;
  basedOn?: "chars" | "words" | "lines";
  /** anim.shine options */
  repeatEvery?: number;
  /** 'follow': the layer to ride on */
  to?: unknown;
}
export interface PlanLoop extends LoopOptions {
  layer: unknown;
  type: string;
}

/** Validate and resolve a whole plan on the Node side; throws with the step number on error. */
export function resolvePlan(
  plan: PlanStep[],
  loops: PlanLoop[] = [],
): {
  steps: { layer: unknown; job: AnimJob | TextJob | ShineJob }[];
  loops: { layer: unknown; job: ExprJob }[];
} {
  if (!Array.isArray(plan)) throw new Error("plan must be an array of { layer, preset, ... }");
  const steps = plan.map((s, n) => {
    if (!s || s.layer === undefined || !s.preset)
      throw new Error(`plan[${n}] needs layer and preset`);
    const bad = checkDirection(s.direction);
    if (bad) throw new Error(`plan[${n}]: ${bad}`);
    try {
      const name = String(s.preset);
      let job: AnimJob | TextJob | ShineJob;
      if (name === "follow") {
        if (s.to === undefined) throw new Error("'follow' needs to: the layer to follow");
        return {
          layer: s.layer,
          job: { type: "follow", preset: "follow", to: s.to, replace: s.replace ?? false } as never,
        };
      }
      if (name === "shine") job = shineJob(s as never);
      else if (isTextPreset(name)) job = textJob(name, s as never);
      else job = presetJob(name, s);
      return { layer: s.layer, job };
    } catch (e) {
      throw new Error(`plan[${n}]: ${(e as Error).message}`);
    }
  });
  const lps = (loops ?? []).map((l, n) => {
    if (!l || l.layer === undefined || !l.type) throw new Error(`loops[${n}] needs layer and type`);
    try {
      return { layer: l.layer, job: loopJob(String(l.type), l) };
    } catch (e) {
      throw new Error(`loops[${n}]: ${(e as Error).message}`);
    }
  });
  return { steps, loops: lps };
}

/** JSX that runs a resolved plan against `_comp` and leaves the report in `_planOut`. */
function planJsx(resolved: ReturnType<typeof resolvePlan>): string {
  return `
            var _plan = ${jsxVal(resolved)};
            var _planOut = { steps: [], loops: [] };
            for (var _pi = 0; _pi < _plan.steps.length; _pi++) {
                var _st = _plan.steps[_pi];
                var _ls = AE.resolveLayers(_comp, _st.layer);
                if (!_ls.length) { _planOut.steps.push({ step: _pi, skipped: true, reason: "no layer matched " + String(_st.layer) }); continue; }
                for (var _li = 0; _li < _ls.length; _li++) {
                    var _rs = _planRun(_ls[_li], _st.job);
                    _rs.step = _pi;
                    _planOut.steps.push(_rs);
                }
            }
            for (var _qi = 0; _qi < _plan.loops.length; _qi++) {
                var _lp = _plan.loops[_qi];
                var _ll = AE.resolveLayers(_comp, _lp.layer);
                if (!_ll.length) { _planOut.loops.push({ loop: _qi, skipped: true, reason: "no layer matched " + String(_lp.layer) }); continue; }
                for (var _lj = 0; _lj < _ll.length; _lj++) {
                    var _rl = _animExprApply(_ll[_lj], _lp.job);
                    _rl.loop = _qi;
                    _planOut.loops.push(_rl);
                }
            }
    `;
}

registerOp({
  name: "anim.apply_plan",
  category: "anim",
  description:
    "Apply a whole animation plan in ONE undo step: plan = [{ layer, preset, start, duration, direction, distance, overshoot, easeStrength, replace }] — anim.apply presets, text.animate presets (char_pop, wave, scale_wave…, with spread / basedOn) and 'shine' (anim.shine options) and 'follow' (parent to `to` with linked opacity, for backings) can be mixed — plus optional loops = [{ layer, type, amplitude, frequency, startAfter, seed }] (anim.loop types). " +
    "Everything is validated before After Effects is touched. psd.plan produces plans in this shape.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "plan",
      type: "array",
      description: "[{ layer, preset, start?, duration?, ... }]",
      required: true,
    },
    {
      name: "loops",
      type: "array",
      description: "[{ layer, type, amplitude?, frequency?, startAfter? }]",
      required: false,
    },
  ],
  toJsx(args) {
    let resolved: ReturnType<typeof resolvePlan>;
    try {
      resolved = resolvePlan(args.plan as PlanStep[], (args.loops ?? []) as PlanLoop[]);
    } catch (e) {
      return jsxFail((e as Error).message);
    }
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            ${planJsx(resolved)}
            var _okSteps = 0;
            for (var _c = 0; _c < _planOut.steps.length; _c++) if (!_planOut.steps[_c].skipped) _okSteps++;
            return { ok: true, comp: _comp.name, animated: _okSteps, steps: _planOut.steps, loops: _planOut.loops };
        `;
  },
});

export { planJsx };

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface TemplateStyle {
  primary: number[];
  accent: number[];
  text: number[];
  heading: string | null;
  body: string | null;
}

/** Colours and fonts for a template: explicit args > brand kit > neutral defaults. */
export function templateStyle(args: Record<string, unknown>): TemplateStyle | string {
  let kit: BrandKit | null = null;
  if (args.brand) {
    kit = loadBrand(String(args.brand));
    if (!kit) return `no brand kit named '${String(args.brand)}' (brand.list shows the saved ones)`;
  }
  const pick = (explicit: unknown, role: string[], fallback: number[]): number[] | string => {
    if (explicit !== undefined && explicit !== null) {
      const c = hexToRgb(explicit);
      return c ?? `colour ${JSON.stringify(explicit)} must be '#RRGGBB' or [r,g,b]`;
    }
    for (const r of role) if (kit?.colors[r]) return kit.colors[r];
    return fallback;
  };
  const primary = pick(args.color, ["primary"], [0.07, 0.07, 0.07]);
  const accent = pick(args.accentColor, ["accent", "secondary", "primary"], [0.85, 0.15, 0.2]);
  const text = pick(args.textColor, ["text", "white", "light"], [1, 1, 1]);
  for (const c of [primary, accent, text]) if (typeof c === "string") return c;
  return {
    primary: primary as number[],
    accent: accent as number[],
    text: text as number[],
    heading: (args.font as string | undefined) ?? kit?.fonts.heading ?? null,
    body: (args.bodyFont as string | undefined) ?? kit?.fonts.body ?? kit?.fonts.heading ?? null,
  };
}

const BRAND_PARAMS: OperationParam[] = [
  {
    name: "brand",
    type: "string",
    description: "Saved brand kit (brand.save) for colours and fonts",
    required: false,
  },
  {
    name: "font",
    type: "string",
    description: "Heading font PostScript name (overrides the kit)",
    required: false,
  },
  {
    name: "bodyFont",
    type: "string",
    description: "Body font PostScript name (overrides the kit)",
    required: false,
  },
  {
    name: "color",
    type: "any",
    description: "Primary colour '#RRGGBB' (kit 'primary')",
    required: false,
  },
  {
    name: "accentColor",
    type: "any",
    description: "Accent colour (kit 'accent')",
    required: false,
  },
  {
    name: "textColor",
    type: "any",
    description: "Text colour (kit 'text', default white)",
    required: false,
  },
];

/** Defines `_tplText(comp, str, size, color, font, name)` → a styled point-text layer. */
const TEXT_FN = `
    function _tplText(comp, str, size, color, font, name) {
        var l = comp.layers.addText(str);
        l.name = name;
        var tp = l.property("ADBE Text Properties").property("ADBE Text Document");
        var d = tp.value;
        d.resetCharStyle();
        d.fontSize = size;
        d.applyFill = true;
        d.fillColor = color;
        d.applyStroke = false;
        if (font) { try { d.font = font; } catch (eF) { } }
        d.justification = ParagraphJustification.LEFT_JUSTIFY;
        tp.setValue(d);
        return l;
    }
    function _tplPlace(l, t, x, y, alignX, alignY) {
        var rc = l.sourceRectAtTime(t, false);
        var px = x - rc.left;
        if (alignX === "center") px = x - (rc.left + rc.width / 2);
        if (alignX === "right") px = x - (rc.left + rc.width);
        var py = y - rc.top;
        if (alignY === "center") py = y - (rc.top + rc.height / 2);
        if (alignY === "bottom") py = y - (rc.top + rc.height);
        l.property("ADBE Transform Group").property("ADBE Position").setValue([px, py]);
        return rc;
    }
    function _tplSpan(l, a, b) { l.inPoint = a; l.outPoint = b; }
`;

const TEMPLATE_TIME_PARAMS: OperationParam[] = [
  {
    name: "start",
    type: "number",
    description: "Comp time (s) the template begins (default 0)",
    required: false,
  },
  {
    name: "duration",
    type: "number",
    description: "Seconds on screen including entrance and exit",
    required: false,
  },
];

registerOp({
  name: "template.lower_third",
  category: "template",
  description:
    "Build an animated lower third: accent bar + title + optional subtitle, laid out from the measured text (safe margins, Vietnamese text fine), coloured and set in the brand kit's fonts. Entrance: bar wipes in, title slides in, subtitle rises 0.15 s later; exit fades out at the end. Layers are named 'LT Bar', 'LT Title', 'LT Subtitle'.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "title", type: "string", description: "Main line, e.g. a name", required: true },
    { name: "subtitle", type: "string", description: "Second line, e.g. a role", required: false },
    {
      name: "position",
      type: "string",
      description: "bottom_left (default) | bottom_center | bottom_right",
      required: false,
    },
    ...TEMPLATE_TIME_PARAMS,
    ...BRAND_PARAMS,
  ],
  toJsx(args) {
    const st = templateStyle(args);
    if (typeof st === "string") return jsxFail(st);
    const pos = String(args.position ?? "bottom_left");
    if (!["bottom_left", "bottom_center", "bottom_right"].includes(pos))
      return jsxFail("position must be bottom_left, bottom_center or bottom_right");
    const start = Number(args.start ?? 0);
    const duration = Number(args.duration ?? 5);
    if (!(duration > 1.2)) return jsxFail("duration must be more than 1.2 s (entrance + exit)");
    const side: Direction = pos === "bottom_right" ? "right" : "left";
    const jobs = {
      bar: presetJob("wipe_in", {
        start,
        duration: 0.5,
        direction: pos === "bottom_center" ? "left" : "down",
      }),
      title: presetJob("slide_in", {
        start: start + 0.15,
        duration: 0.6,
        direction: side,
        distance: null,
      }),
      sub: presetJob("rise_in", { start: start + 0.3, duration: 0.6 }),
      outT: presetJob("fade_out", { start: start + duration - 0.45, duration: 0.4 }),
    };
    jobs.title.distFactor = 0.03;
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            ${TEXT_FN}
            var _st = ${jsxVal(st)};
            var _pos = ${jsxVal(pos)};
            var _t0 = ${jsxVal(start)};
            var _t1 = _t0 + ${jsxVal(duration)};
            var _jobs = ${jsxVal(jobs)};
            var _W = _comp.width;
            var _H = _comp.height;
            var _margin = Math.round(_W * 0.07);
            var _bottom = Math.round(_H * 0.88);
            var _title = _tplText(_comp, ${jsxVal(String(args.title))}, Math.round(_H * 0.045), _st.text, _st.heading, "LT Title");
            var _sub = null;
            var _subTxt = ${jsxVal(args.subtitle ?? null)};
            if (_subTxt) _sub = _tplText(_comp, _subTxt, Math.round(_H * 0.028), _st.text, _st.body, "LT Subtitle");
            var _rt = _title.sourceRectAtTime(_t0, false);
            var _rs = _sub ? _sub.sourceRectAtTime(_t0, false) : { width: 0, height: 0 };
            var _gap = Math.round(_H * 0.012);
            var _blockW = Math.max(_rt.width, _rs.width);
            var _blockH = _rt.height + (_sub ? _gap + _rs.height : 0);
            var _barW = Math.round(_H * 0.008);
            var _pad = Math.round(_H * 0.018);
            var _top = _bottom - _blockH;
            var _alignX = "left";
            var _x = _margin + _barW + _pad;
            var _bar = _comp.layers.addShape();
            _bar.name = "LT Bar";
            if (_pos === "bottom_right") { _alignX = "right"; _x = _W - _margin - _barW - _pad; }
            if (_pos === "bottom_center") { _alignX = "center"; _x = _W / 2; }
            // Shape contents live in layer space: draw the bar round the
            // layer's origin and place the layer itself in the comp.
            var _barPos;
            if (_pos === "bottom_center") {
                AE.rect(_bar, [_blockW, _barW], [0, 0], { name: "Bar", fill: _st.accent });
                _barPos = [_W / 2, _bottom + _pad + _barW / 2];
            } else {
                var _bx = (_pos === "bottom_right") ? _W - _margin - _barW / 2 : _margin + _barW / 2;
                AE.rect(_bar, [_barW, _blockH + _pad], [0, 0], { name: "Bar", fill: _st.accent });
                _barPos = [_bx, _top + _blockH / 2];
            }
            _bar.property("ADBE Transform Group").property("ADBE Position").setValue(_barPos);
            _tplPlace(_title, _t0, _x, _top, _alignX, "top");
            if (_sub) _tplPlace(_sub, _t0, _x, _top + _rt.height + _gap, _alignX, "top");
            var _all = [_bar, _title];
            if (_sub) _all.push(_sub);
            for (var _a = 0; _a < _all.length; _a++) _tplSpan(_all[_a], _t0, _t1);
            var _rep = [];
            _rep.push(_animApply(_bar, _jobs.bar));
            _rep.push(_animApply(_title, _jobs.title));
            if (_sub) _rep.push(_animApply(_sub, _jobs.sub));
            for (var _b = 0; _b < _all.length; _b++) _rep.push(_animApply(_all[_b], _jobs.outT));
            return { ok: true, comp: _comp.name, layers: { bar: _bar.index, title: _title.index, subtitle: _sub ? _sub.index : null }, animation: _rep };
        `;
  },
});

const TITLE_STYLES: Record<string, { title: string; sub: string }> = {
  smooth: { title: "rise_in", sub: "fade_in" },
  pop: { title: "pop_in", sub: "rise_in" },
  energetic: { title: "stretch_in", sub: "slide_in" },
};

registerOp({
  name: "template.title_card",
  category: "template",
  description:
    "Build a centred title card: title + optional subtitle (+ optional full-frame background in the brand primary colour), brand fonts and colours. style: smooth (title rises, subtitle fades), pop (title pops 0→110→100 %, subtitle rises), energetic (title stretches in, subtitle slides). exit (default true) fades everything out at the end. Layers: 'Title', 'Subtitle', 'Title BG'.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "title", type: "string", description: "Title text", required: true },
    { name: "subtitle", type: "string", description: "Subtitle text", required: false },
    {
      name: "style",
      type: "string",
      description: "smooth (default) | pop | energetic",
      required: false,
    },
    {
      name: "background",
      type: "boolean",
      description: "Add a full-frame solid in the primary colour (default false)",
      required: false,
    },
    {
      name: "exit",
      type: "boolean",
      description: "Fade out at the end (default true)",
      required: false,
    },
    ...TEMPLATE_TIME_PARAMS,
    ...BRAND_PARAMS,
  ],
  toJsx(args) {
    const st = templateStyle(args);
    if (typeof st === "string") return jsxFail(st);
    const style = TITLE_STYLES[String(args.style ?? "smooth")];
    if (!style) return jsxFail(`style must be one of ${Object.keys(TITLE_STYLES).join(", ")}`);
    const start = Number(args.start ?? 0);
    const duration = Number(args.duration ?? 4);
    if (!(duration > 1.2)) return jsxFail("duration must be more than 1.2 s");
    const jobs = {
      title: presetJob(style.title, { start: start + 0.1 }),
      sub: presetJob(style.sub, { start: start + 0.45 }),
      bg: presetJob("fade_in", { start, duration: 0.4 }),
      out: presetJob("fade_out", { start: start + duration - 0.5, duration: 0.45 }),
    };
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            ${TEXT_FN}
            var _st = ${jsxVal(st)};
            var _t0 = ${jsxVal(start)};
            var _t1 = _t0 + ${jsxVal(duration)};
            var _jobs = ${jsxVal(jobs)};
            var _W = _comp.width;
            var _H = _comp.height;
            var _bg = null;
            if (${jsxVal(args.background === true)}) {
                _bg = _comp.layers.addSolid(_st.primary, "Title BG", _W, _H, _comp.pixelAspect);
                _bg.moveToEnd();
            }
            var _title = _tplText(_comp, ${jsxVal(String(args.title))}, Math.round(Math.min(_W, _H) * 0.09), _st.text, _st.heading, "Title");
            var _subTxt = ${jsxVal(args.subtitle ?? null)};
            var _sub = _subTxt ? _tplText(_comp, _subTxt, Math.round(Math.min(_W, _H) * 0.038), _st.text, _st.body, "Subtitle") : null;
            var _rt = _title.sourceRectAtTime(_t0, false);
            var _rs = _sub ? _sub.sourceRectAtTime(_t0, false) : { height: 0 };
            var _gap = Math.round(_H * 0.02);
            var _blockH = _rt.height + (_sub ? _gap + _rs.height : 0);
            var _top = (_H - _blockH) / 2;
            _tplPlace(_title, _t0, _W / 2, _top, "center", "top");
            if (_sub) _tplPlace(_sub, _t0, _W / 2, _top + _rt.height + _gap, "center", "top");
            // Scale and rotate presets pivot on the anchor: centre it on the text.
            var _txt = [_title];
            if (_sub) _txt.push(_sub);
            for (var _c = 0; _c < _txt.length; _c++) {
                var _r = _txt[_c].sourceRectAtTime(_t0, false);
                AE.moveAnchor(_txt[_c], [_r.left + _r.width / 2, _r.top + _r.height / 2]);
            }
            var _all = _txt.slice(0);
            if (_bg) _all.push(_bg);
            for (var _a = 0; _a < _all.length; _a++) _tplSpan(_all[_a], _t0, _t1);
            var _rep = [];
            if (_bg) _rep.push(_animApply(_bg, _jobs.bg));
            _rep.push(_animApply(_title, _jobs.title));
            if (_sub) _rep.push(_animApply(_sub, _jobs.sub));
            if (${jsxVal(args.exit !== false)}) {
                for (var _b = 0; _b < _all.length; _b++) _rep.push(_animApply(_all[_b], _jobs.out));
            }
            return { ok: true, comp: _comp.name, layers: { title: _title.index, subtitle: _sub ? _sub.index : null, background: _bg ? _bg.index : null }, animation: _rep };
        `;
  },
});

registerOp({
  name: "template.logo_reveal",
  category: "template",
  description:
    "Reveal a logo: style 'pop' (scales 0→110→100 %), 'blur' (resolves from a blur), or 'particle' (the logo assembles from CC Scatterize while a CC Particle Systems II burst fires as it lands — Collapse Transformations / Grow Bounds is set BEFORE the effects so the scatter is not clipped). " +
    "logo = an image/AI/PSD file path to import, or the name of a layer already in the comp. Sized to `size` × comp width and centred unless position is given. Particle colour follows the brand accent.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "logo",
      type: "string",
      description: "File path to import, or an existing layer name",
      required: true,
    },
    {
      name: "style",
      type: "string",
      description: "pop (default) | blur | particle",
      required: false,
    },
    {
      name: "size",
      type: "number",
      description: "Logo width as a fraction of comp width when importing (default 0.3)",
      required: false,
    },
    {
      name: "position",
      type: "array",
      description: "[x, y] (default comp centre)",
      required: false,
    },
    ...TEMPLATE_TIME_PARAMS,
    {
      name: "brand",
      type: "string",
      description: "Brand kit; its accent colours the particles",
      required: false,
    },
    { name: "accentColor", type: "any", description: "Particle colour override", required: false },
  ],
  toJsx(args) {
    const st = templateStyle({ ...args, textColor: args.accentColor ?? undefined });
    if (typeof st === "string") return jsxFail(st);
    const style = String(args.style ?? "pop");
    if (!["pop", "blur", "particle"].includes(style))
      return jsxFail("style must be pop, blur or particle");
    const start = Number(args.start ?? 0);
    const duration = Number(args.duration ?? 2);
    const land = Math.round(duration * 0.5 * 100) / 100;
    const jobs = {
      pop: presetJob("pop_in", { start, duration: Math.min(0.8, duration) }),
      blur: presetJob("blur_in", { start, duration: Math.min(1, duration) }),
    };
    const particleColor = args.accentColor !== undefined ? st.text : st.accent;
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            var _jobs = ${jsxVal(jobs)};
            var _t0 = ${jsxVal(start)};
            var _land = _t0 + ${jsxVal(land)};
            var _logoArg = ${jsxVal(String(args.logo))};
            var _logo = AE.findLayerInComp(_comp, _logoArg);
            var _imported = false;
            if (!_logo) {
                var _f = new File(_logoArg);
                if (!_f.exists) return { ok: false, error: "logo is neither a layer in " + _comp.name + " nor an existing file: " + _logoArg };
                var _io = new ImportOptions(_f);
                var _item = app.project.importFile(_io);
                _logo = _comp.layers.add(_item);
                _imported = true;
                var _rw = _logo.sourceRectAtTime(_t0, false).width;
                if (_rw > 0) {
                    var _s = 100 * _comp.width * ${jsxVal(args.size ?? 0.3)} / _rw;
                    _logo.property("ADBE Transform Group").property("ADBE Scale").setValue([_s, _s]);
                }
            }
            var _pos = ${jsxVal(args.position ?? null)};
            if (_pos || _imported) {
                if (!_pos) _pos = [_comp.width / 2, _comp.height / 2];
                _logo.property("ADBE Transform Group").property("ADBE Position").setValue(_pos);
            }
            var _style = ${jsxVal(style)};
            var _rep = { layer: _logo.name, index: _logo.index, style: _style };
            if (_style === "pop") _rep.animation = _animApply(_logo, _jobs.pop);
            if (_style === "blur") _rep.animation = _animApply(_logo, _jobs.blur);
            if (_style === "particle") {
                var _fx = _logo.property("ADBE Effect Parade");
                if (!_fx.canAddProperty("CC Scatterize")) return { ok: false, error: "CC Scatterize is not available in this After Effects install" };
                // Room for the scatter first: Collapse Transformations, else
                // Grow Bounds — which must sit BEFORE Scatterize in the stack.
                _rep.expanded = "none";
                if (_logo.canSetCollapseTransformation) {
                    _logo.collapseTransformation = true;
                    _rep.expanded = "collapseTransformation";
                } else if (_fx.canAddProperty("ADBE GROW BOUNDS")) {
                    var _grow = _fx.addProperty("ADBE GROW BOUNDS");
                    _grow.property("ADBE GROW BOUNDS-0001").setValue(Math.round(Math.max(_comp.width, _comp.height) / 3));
                    _rep.expanded = "growBounds";
                }
                var _scat = _logo.property("ADBE Effect Parade").addProperty("CC Scatterize");
                var _amt = _scat.property("CC Scatterize-0001");
                var _tw = _scat.property("CC Scatterize-0002");
                _amt.setValueAtTime(_t0, _rep.expanded === "none" ? 150 : 450);
                _amt.setValueAtTime(_land, 0);
                _tw.setValueAtTime(_t0, 180);
                _tw.setValueAtTime(_land, 0);
                AE.setEase(_amt, 2, 80, 33);
                AE.setEase(_tw, 2, 80, 33);
                var _op = _logo.property("ADBE Transform Group").property("ADBE Opacity");
                var _opRest = _op.valueAtTime(_land, false);
                _op.setValueAtTime(_t0, 0);
                _op.setValueAtTime(_t0 + (_land - _t0) * 0.85, _opRest);
                _rep.particles = null;
                if (_logo.property("ADBE Effect Parade").canAddProperty("CC Particle Systems II")) {
                    var _lp = _logo.property("ADBE Transform Group").property("ADBE Position").valueAtTime(_land, false);
                    var _lr = _logo.sourceRectAtTime(_land, false);
                    var _ls = _logo.property("ADBE Transform Group").property("ADBE Scale").valueAtTime(_land, false);
                    var _burst = _comp.layers.addSolid([1, 1, 1], "Logo Particles", _comp.width, _comp.height, _comp.pixelAspect);
                    _burst.inPoint = _t0;
                    _burst.blendingMode = BlendingMode.ADD;
                    var _ps = _burst.property("ADBE Effect Parade").addProperty("CC Particle Systems II");
                    _ps.property("CC Particle Systems II-0004").setValue([_lp[0], _lp[1]]);
                    // Radius units are not pixels: one unit ≈ layer width / 200.
                    var _unit = _burst.width / 200;
                    _ps.property("CC Particle Systems II-0005").setValue(Math.min(1000, (_lr.width * _ls[0] / 200) / _unit * 0.9));
                    _ps.property("CC Particle Systems II-0006").setValue(Math.min(1000, (_lr.height * _ls[1] / 200) / _unit * 0.9));
                    _ps.property("CC Particle Systems II-0002").setValue(1);
                    _ps.property("CC Particle Systems II-0010").setValue(0.1);
                    _ps.property("CC Particle Systems II-0012").setValue(0.05);
                    _ps.property("CC Particle Systems II-0013").setValue(10);
                    _ps.property("CC Particle Systems II-0019").setValue(0.12);
                    _ps.property("CC Particle Systems II-0020").setValue(0);
                    _ps.property("CC Particle Systems II-0023").setValue(1);
                    // Particle Type 5 = Faded Sphere (picked from a rendered sheet; menu indices include separators).
                    _ps.property("CC Particle Systems II-0018").setValue(5);
                    var _pc = ${jsxVal(particleColor)};
                    _ps.property("CC Particle Systems II-0025").setValue([_pc[0], _pc[1], _pc[2], 1]);
                    _ps.property("CC Particle Systems II-0026").setValue([_pc[0], _pc[1], _pc[2], 1]);
                    var _rate = _ps.property("CC Particle Systems II-0001");
                    _rate.setValueAtTime(_t0, 0);
                    _rate.setValueAtTime(_land, 6);
                    _rate.setValueAtTime(_land + 0.2, 0);
                    for (var _rk = 1; _rk <= _rate.numKeys; _rk++) {
                        _rate.setInterpolationTypeAtKey(_rk, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                    }
                    _rep.particles = _burst.name;
                }
            }
            return { ok: true, comp: _comp.name, reveal: _rep };
        `;
  },
});

const TRANSITIONS = ["flash", "wipe", "circle", "slide_panels"];

registerOp({
  name: "template.transition",
  category: "template",
  description:
    "Add a graphic transition centred on a cut: `start` is the cut time — the cover peaks there and clears after it. flash (white flash, short), wipe (colour panel sweeps across in `direction`), circle (iris grows from the centre to cover, then shrinks), slide_panels (primary + accent panels sweep through, staggered). Colours from the brand kit. Layers named 'TR <type>'.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "type", type: "string", description: TRANSITIONS.join(" | "), required: true },
    {
      name: "start",
      type: "number",
      description: "Cut time in seconds (the moment the frame is fully covered)",
      required: true,
    },
    {
      name: "duration",
      type: "number",
      description: "Total seconds (default 0.6; flash 0.3)",
      required: false,
    },
    {
      name: "direction",
      type: "string",
      description: "wipe / slide_panels travel FROM this side: left (default) | right | up | down",
      required: false,
    },
    ...BRAND_PARAMS,
  ],
  toJsx(args) {
    const type = String(args.type);
    if (!TRANSITIONS.includes(type))
      return jsxFail(`type must be one of ${TRANSITIONS.join(", ")}`);
    const bad = checkDirection(args.direction);
    if (bad) return jsxFail(bad);
    const st = templateStyle(args);
    if (typeof st === "string") return jsxFail(st);
    if (typeof args.start !== "number")
      return jsxFail("start (the cut time in seconds) is required");
    const duration = Number(args.duration ?? (type === "flash" ? 0.3 : 0.6));
    return `
            ${jsxCompPreamble(args)}
            var _st = ${jsxVal(st)};
            var _type = ${jsxVal(type)};
            var _cut = ${jsxVal(args.start)};
            var _half = ${jsxVal(duration)} / 2;
            var _a = Math.max(0, _cut - _half);
            var _b = _cut + _half;
            var _W = _comp.width;
            var _H = _comp.height;
            var _dir = ${jsxVal(args.direction ?? "left")};
            var _made = [];
            function _ease(p) { for (var k = 1; k <= p.numKeys; k++) AE.setEase(p, k, 70, 70); }
            function _panel(name, color, delay) {
                var l = _comp.layers.addShape();
                l.name = name;
                var horiz = (_dir === "left" || _dir === "right");
                var sz = horiz ? [_W * 1.1, _H * 1.2] : [_W * 1.2, _H * 1.1];
                AE.rect(l, sz, [0, 0], { name: "Panel", fill: color });
                var p = l.property("ADBE Transform Group").property("ADBE Position");
                var c = [_W / 2, _H / 2];
                var from = [c[0], c[1]];
                var to = [c[0], c[1]];
                if (_dir === "left") { from[0] = -_W * 0.6; to[0] = _W * 1.6; }
                if (_dir === "right") { from[0] = _W * 1.6; to[0] = -_W * 0.6; }
                if (_dir === "up") { from[1] = -_H * 0.6; to[1] = _H * 1.6; }
                if (_dir === "down") { from[1] = _H * 1.6; to[1] = -_H * 0.6; }
                p.setValueAtTime(_a + delay, from);
                p.setValueAtTime(_cut + delay, c);
                p.setValueAtTime(_b + delay, to);
                _ease(p);
                l.inPoint = _a + delay;
                l.outPoint = _b + delay;
                return l;
            }
            if (_type === "flash") {
                var _fl = _comp.layers.addSolid([1, 1, 1], "TR flash", _W, _H, _comp.pixelAspect);
                var _op = _fl.property("ADBE Transform Group").property("ADBE Opacity");
                _op.setValueAtTime(_a, 0);
                _op.setValueAtTime(_cut, 100);
                _op.setValueAtTime(_b, 0);
                _ease(_op);
                _fl.inPoint = _a;
                _fl.outPoint = _b;
                _made.push(_fl);
            }
            if (_type === "wipe") _made.push(_panel("TR wipe", _st.primary, 0));
            if (_type === "slide_panels") {
                _made.push(_panel("TR panel 1", _st.accent, -_half * 0.25));
                _made.push(_panel("TR panel 2", _st.primary, 0));
            }
            if (_type === "circle") {
                var _ci = _comp.layers.addShape();
                _ci.name = "TR circle";
                var _d = Math.sqrt(_W * _W + _H * _H) * 1.05;
                AE.ellipse(_ci, [_d, _d], [0, 0], { name: "Iris", fill: _st.primary });
                _ci.property("ADBE Transform Group").property("ADBE Position").setValue([_W / 2, _H / 2]);
                var _sc = _ci.property("ADBE Transform Group").property("ADBE Scale");
                _sc.setValueAtTime(_a, [0, 0]);
                _sc.setValueAtTime(_cut, [100, 100]);
                _sc.setValueAtTime(_b, [0, 0]);
                _ease(_sc);
                _ci.inPoint = _a;
                _ci.outPoint = _b;
                _made.push(_ci);
            }
            var _names = [];
            for (var _m = 0; _m < _made.length; _m++) { _made[_m].moveToBeginning(); _names.push(_made[_m].name); }
            return { ok: true, comp: _comp.name, type: _type, cut: _cut, from: _a, to: _b, layers: _names };
        `;
  },
});

// ---------------------------------------------------------------------------
// Working on what is already there: adjust / review / polish
// ---------------------------------------------------------------------------

const EDIT_LAYERS: OperationParam = {
  name: "layers",
  type: "any",
  description: "Layer index, name, { id }, 'selected', 'all' (default), or an array of those",
  required: false,
};

registerOp({
  name: "anim.adjust",
  category: "anim",
  description:
    "Change animation that already exists instead of rebuilding it — the tool for feedback like 'vào chậm hơn', 'trễ 0.2 s', 'mềm hơn'. " +
    "Takes the keys inside a time window (default: the layer's FIRST animation segment, i.e. its entrance; window 'all' = every key) and retimes them: shift (s), duration (new length of the segment) or speed (×), pivoting on the segment start so the layer still starts on time. " +
    "Values, eases and motion paths are kept (ease speeds are rescaled so curves keep their shape); inInfluence/outInfluence re-ease the touched keys. Keys outside the window stay put unless ripple moves the later ones by the same amount. Hand-made keys are treated exactly like generated ones.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    EDIT_LAYERS,
    {
      name: "window",
      type: "any",
      description:
        "'entrance' (default: first segment), 'exit' (last segment), 'all', or [from, to] in comp seconds",
      required: false,
    },
    {
      name: "properties",
      type: "array",
      description:
        "Limit to these: position, scale, rotation, opacity, anchorPoint or display names (default: every keyed property)",
      required: false,
    },
    {
      name: "shift",
      type: "number",
      description: "Seconds to move the keys (+ later, − earlier)",
      required: false,
    },
    {
      name: "duration",
      type: "number",
      description: "New length in seconds of the window's keys",
      required: false,
    },
    {
      name: "speed",
      type: "number",
      description: "Speed factor (2 = twice as fast); ignored when duration is given",
      required: false,
    },
    {
      name: "inInfluence",
      type: "number",
      description: "Re-ease touched keys: incoming influence % (landing softness)",
      required: false,
    },
    {
      name: "outInfluence",
      type: "number",
      description: "Re-ease touched keys: outgoing influence % (take-off softness)",
      required: false,
    },
    {
      name: "stagger",
      type: "number",
      description: "Extra seconds added per following layer (re-stagger a group)",
      required: false,
    },
    {
      name: "ripple",
      type: "boolean",
      description: "Also move keys after the window by how much its end moved (default false)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_EDIT_FN}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layers ?? "all")});
            if (!_layers.length) return { ok: false, error: "no layers matched" };
            var _win = ${jsxVal(args.window ?? "entrance")};
            var _filter = ${jsxVal(args.properties ?? null)};
            var _shift = ${jsxVal(args.shift ?? 0)};
            var _dur = ${jsxVal(args.duration ?? null)};
            var _speed = ${jsxVal(args.speed ?? null)};
            var _inI = ${jsxVal(args.inInfluence ?? null)};
            var _outI = ${jsxVal(args.outInfluence ?? null)};
            var _stg = ${jsxVal(args.stagger ?? 0)};
            var _ripple = ${jsxVal(args.ripple === true)};
            var _out = [];
            var _n = 0;
            for (var _i = 0; _i < _layers.length; _i++) {
                var _l = _layers[_i];
                var _props = _edAnimated(_l, _filter);
                var _rep = { layer: _l.name, index: _l.index };
                if (!_props.length) { _rep.skipped = true; _rep.reason = "no keyframes"; _out.push(_rep); continue; }
                var _segs = _edSegments(_props);
                var _a, _b;
                if (_win === "all") { _a = -1e6; _b = 1e6; }
                else if (_win === "exit") { _a = _segs[_segs.length - 1].from; _b = _segs[_segs.length - 1].to; }
                else if (_win instanceof Array) { _a = _win[0]; _b = _win[1]; }
                else { _a = _segs[0].from; _b = _segs[0].to; }
                // Real extent of the selected keys, for pivot and scale.
                var _lo = 1e9, _hi = -1e9;
                for (var _p = 0; _p < _props.length; _p++) {
                    for (var _k = 1; _k <= _props[_p].numKeys; _k++) {
                        var _t = _props[_p].keyTime(_k);
                        if (_t >= _a - 0.0001 && _t <= _b + 0.0001) { if (_t < _lo) _lo = _t; if (_t > _hi) _hi = _t; }
                    }
                }
                if (_lo > _hi) { _rep.skipped = true; _rep.reason = "no keys in the window"; _out.push(_rep); continue; }
                var _scale = 1;
                if (_dur !== null && _hi > _lo) _scale = _dur / (_hi - _lo);
                else if (_speed) _scale = 1 / _speed;
                var _sh = _shift + _stg * _n;
                var _endMove = (_lo + (_hi - _lo) * _scale + _sh) - _hi;
                var _moved = 0, _coll = 0;
                for (var _q = 0; _q < _props.length; _q++) {
                    var _pp = _props[_q];
                    // Later keys first when rippling forward, so nothing collides on the way.
                    if (_ripple && Math.abs(_endMove) > 0.0001) _edRetime(_pp, _hi + 0.0002, 1e6, 0, 1, _endMove);
                    var _res = _edRetime(_pp, _lo, _hi, _lo, _scale, _sh);
                    _moved += _res.moved;
                    _coll += _res.collisions;
                    if ((_inI !== null || _outI !== null) && _res.times) {
                        for (var _r = 0; _r < _res.times.length; _r++) {
                            var _ki = _pp.nearestKeyIndex(_res.times[_r]);
                            var _ci = _inI, _co = _outI;
                            if (_ci === null) { try { _ci = _pp.keyInTemporalEase(_ki)[0].influence; } catch (eI) { _ci = 33; } }
                            if (_co === null) { try { _co = _pp.keyOutTemporalEase(_ki)[0].influence; } catch (eO) { _co = 33; } }
                            try { AE.setEase(_pp, _ki, _ci, _co); } catch (eSe) { }
                        }
                    }
                }
                _rep.window = [_lo, _hi];
                _rep.now = [_lo + _sh, _lo + (_hi - _lo) * _scale + _sh];
                _rep.keysMoved = _moved;
                if (_coll) _rep.warning = _coll + " key(s) landed on an existing key outside the window and replaced it";
                _out.push(_rep);
                _n++;
            }
            return { ok: true, comp: _comp.name, adjusted: _n, layers: _out };
        `;
  },
});

registerOp({
  name: "anim.review",
  category: "anim",
  readOnly: true,
  description:
    "Look at a comp's animation with a motion designer's eye and list what to fix, without changing anything: keys that move with LINEAR interpolation (no ease — robotic), moving layers without motion blur (or comp motion blur off), 3+ layers starting on the same frame (no stagger), entrances faster than 0.2 s or slower than 1.6 s, text that stays readable less than 1.5 s, everything happening at once. " +
    "Each issue names the layer and the op that fixes it (anim.polish, anim.adjust). Run it before showing a draft and after applying feedback.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    EDIT_LAYERS,
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_EDIT_FN}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layers ?? "all")});
            var _issues = [];
            var _starts = [];
            var _animated = 0;
            if (!_comp.motionBlur) _issues.push({ kind: "comp_motion_blur_off", detail: "comp motion blur switch is off, so no layer shows motion blur", fix: "anim.polish" });
            for (var _i = 0; _i < _layers.length; _i++) {
                var _l = _layers[_i];
                var _props = _edAnimated(_l, null);
                if (!_props.length) continue;
                _animated++;
                var _moves = false;
                var _lin = 0;
                for (var _p = 0; _p < _props.length; _p++) {
                    if (_edIsMover(_props[_p])) _moves = true;
                    if (!_edLoops(_props[_p])) _lin += _edLinearKeys(_props[_p]).length;
                }
                if (_lin) _issues.push({ layer: _l.name, index: _l.index, kind: "linear_keys", detail: _lin + " key(s) move with linear interpolation (no ease)", fix: "anim.polish" });
                var _mb = false;
                try { _mb = _l.motionBlur === true; } catch (eMb) { _mb = true; }
                if (_moves && !_mb) _issues.push({ layer: _l.name, index: _l.index, kind: "no_motion_blur", detail: "moves but motion blur is off", fix: "anim.polish" });
                var _segs = _edSegments(_props);
                var _ent = _segs[0];
                _starts.push({ name: _l.name, t: _ent.from });
                var _len = _ent.to - _ent.from;
                if (_ent.keys > 1 && _len < 0.2) _issues.push({ layer: _l.name, index: _l.index, kind: "too_fast", detail: "first move lasts " + Math.round(_len * 100) / 100 + " s", fix: "anim.adjust { duration: 0.5 }" });
                if (_ent.keys > 2 && _len > 1.6) _issues.push({ layer: _l.name, index: _l.index, kind: "too_slow", detail: "first move lasts " + Math.round(_len * 100) / 100 + " s", fix: "anim.adjust { duration: 0.8 }" });
                if (_l instanceof TextLayer) {
                    var _endRead = _segs.length > 1 ? _segs[_segs.length - 1].from : _l.outPoint;
                    var _read = Math.min(_endRead, _l.outPoint) - _ent.to;
                    if (_read < 1.5) _issues.push({ layer: _l.name, index: _l.index, kind: "short_read", detail: "readable for " + Math.round(_read * 100) / 100 + " s (want >= 1.5 s)", fix: "anim.adjust { window: 'exit', shift: + }" });
                }
            }
            _starts.sort(function (a, b) { return a.t - b.t; });
            var _run = [];
            for (var _s = 0; _s <= _starts.length; _s++) {
                if (_s < _starts.length && _run.length && Math.abs(_starts[_s].t - _run[0].t) <= 0.01) { _run.push(_starts[_s]); continue; }
                if (_run.length >= 3) {
                    var _names = [];
                    for (var _m = 0; _m < _run.length; _m++) _names.push(_run[_m].name);
                    _issues.push({ kind: "no_stagger", detail: _run.length + " layers start together at " + Math.round(_run[0].t * 100) / 100 + " s: " + _names.join(", "), fix: "anim.adjust { layers: [...], stagger: 0.08 }" });
                }
                _run = _s < _starts.length ? [_starts[_s]] : [];
            }
            return { ok: true, comp: _comp.name, animatedLayers: _animated, issueCount: _issues.length, issues: _issues };
        `;
  },
});

registerOp({
  name: "anim.polish",
  category: "anim",
  description:
    "Fix the mechanical problems anim.review finds, in place: eases keys that move with LINEAR interpolation (bezier, influence `influence`, default 60 — loopOut/loopIn properties and HOLD keys are left alone), switches motion blur on for moving layers and the comp, optionally sets the comp shutter angle. Does not touch values, timing or hand-tuned eases.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    EDIT_LAYERS,
    {
      name: "influence",
      type: "number",
      description: "Influence % for keys that were linear (default 60)",
      required: false,
    },
    {
      name: "motionBlur",
      type: "boolean",
      description: "Switch motion blur on for moving layers + comp (default true)",
      required: false,
    },
    {
      name: "shutterAngle",
      type: "number",
      description: "Comp shutter angle in degrees (e.g. 180); unchanged when omitted",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_EDIT_FN}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layers ?? "all")});
            var _inf = ${jsxVal(args.influence ?? 60)};
            var _mbOn = ${jsxVal(args.motionBlur !== false)};
            var _sa = ${jsxVal(args.shutterAngle ?? null)};
            var _eased = 0, _mbLayers = [];
            for (var _i = 0; _i < _layers.length; _i++) {
                var _l = _layers[_i];
                var _props = _edAnimated(_l, null);
                var _moves = false;
                for (var _p = 0; _p < _props.length; _p++) {
                    var _pp = _props[_p];
                    if (_edIsMover(_pp)) _moves = true;
                    if (_edLoops(_pp)) continue;
                    var _hits = _edLinearKeys(_pp);
                    for (var _h = 0; _h < _hits.length; _h++) {
                        try { AE.setEase(_pp, _hits[_h], _inf, _inf); _eased++; } catch (eE) { }
                    }
                }
                if (_mbOn && _moves) {
                    try { if (!_l.motionBlur) { _l.motionBlur = true; _mbLayers.push(_l.name); } } catch (eMb) { }
                }
            }
            var _compMb = false;
            if (_mbOn && _mbLayers.length && !_comp.motionBlur) { _comp.motionBlur = true; _compMb = true; }
            if (_mbOn && !_comp.motionBlur) {
                for (var _j = 1; _j <= _comp.numLayers; _j++) { try { if (_comp.layer(_j).motionBlur) { _comp.motionBlur = true; _compMb = true; break; } } catch (eL) { } }
            }
            if (_sa !== null) _comp.shutterAngle = _sa;
            return { ok: true, comp: _comp.name, keysEased: _eased, motionBlurLayers: _mbLayers, compMotionBlurSwitchedOn: _compMb, shutterAngle: _comp.shutterAngle };
        `;
  },
});

// ---------------------------------------------------------------------------
// Speed ramp (time remap)
// ---------------------------------------------------------------------------

export interface RampSegment {
  /** Comp seconds this segment lasts. */
  duration: number;
  /** Playback speed: 1 normal, 0.25 slow motion, 3 fast. */
  speed: number;
}

/** Ready-made ramps; durations are fractions of `length`. */
const RAMP_PRESETS: Record<string, { parts: [number, number][]; length: number }> = {
  // Normal → slow-motion on the hit → normal.
  slowmo_hit: {
    parts: [
      [0.3, 1],
      [0.4, 0.25],
      [0.3, 1],
    ],
    length: 3,
  },
  // Rush in fast, land in slow motion (classic edit "whoosh → hero moment").
  fast_slow: {
    parts: [
      [0.35, 3],
      [0.65, 0.35],
    ],
    length: 3,
  },
  // Hang in slow motion, then shoot off fast.
  slow_fast: {
    parts: [
      [0.6, 0.35],
      [0.4, 3],
    ],
    length: 3,
  },
  // Fast → slow → fast: the reel staple.
  ramp_in_out: {
    parts: [
      [0.25, 2.5],
      [0.5, 0.3],
      [0.25, 2.5],
    ],
    length: 3,
  },
  // Short freeze-like pause on the beat.
  stutter: {
    parts: [
      [0.35, 1],
      [0.3, 0.08],
      [0.35, 1.5],
    ],
    length: 2,
  },
};
export const RAMP_PRESET_NAMES = Object.keys(RAMP_PRESETS);

/**
 * Time-remap keys for a speed profile: comp time → source time (relative to
 * the profile start). Each boundary key carries the speeds either side so
 * the ease can blend them. Pure, for tests.
 */
export function rampKeys(
  segments: RampSegment[],
): { t: number; src: number; speedIn: number; speedOut: number }[] {
  if (!segments.length) throw new Error("a speed ramp needs at least one segment");
  const keys = [{ t: 0, src: 0, speedIn: segments[0].speed, speedOut: segments[0].speed }];
  let t = 0;
  let src = 0;
  segments.forEach((s, n) => {
    if (!(s.duration > 0)) throw new Error(`segment ${n}: duration must be > 0`);
    if (!(s.speed > 0) || s.speed > 20)
      throw new Error(`segment ${n}: speed must be between 0 and 20`);
    t += s.duration;
    src += s.duration * s.speed;
    // After the last segment the footage plays on at normal speed.
    const next = segments[n + 1]?.speed ?? 1;
    keys.push({
      t: Math.round(t * 10000) / 10000,
      src: Math.round(src * 10000) / 10000,
      speedIn: s.speed,
      speedOut: next,
    });
  });
  return keys;
}

export function rampSegments(
  preset: string | undefined,
  length: number | undefined,
  segments: RampSegment[] | undefined,
): RampSegment[] {
  if (segments && segments.length) return segments;
  const p = RAMP_PRESETS[preset ?? "ramp_in_out"];
  if (!p)
    throw new Error(
      `unknown speed ramp preset '${preset}'. Known: ${RAMP_PRESET_NAMES.join(", ")}`,
    );
  const L = length ?? p.length;
  return p.parts.map(([f, speed]) => ({ duration: Math.round(f * L * 10000) / 10000, speed }));
}

registerOp({
  name: "anim.speed_ramp",
  category: "anim",
  description:
    "Speed-ramp a footage or precomp layer with Time Remap: presets slowmo_hit (normal → slow motion on the hit → normal), fast_slow, slow_fast, ramp_in_out (fast → slow → fast), stutter (near-freeze on the beat), or your own segments [{ duration, speed }]. " +
    "Speed changes are eased (smooth, default 60 % influence) instead of jumping, the footage keeps playing at normal speed after the ramp, frame blending and motion blur are switched on for clean slow motion. Existing time-remap keys are kept unless replace. The keys stay editable in the Graph Editor.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "layer",
      type: "any",
      description: "Footage or precomp layer (index, name or { id })",
      required: true,
    },
    {
      name: "preset",
      type: "string",
      description: `${RAMP_PRESET_NAMES.join(" | ")} (default ramp_in_out)`,
      required: false,
    },
    {
      name: "length",
      type: "number",
      description: "Comp seconds the preset ramp spans (default 3; stutter 2)",
      required: false,
    },
    {
      name: "segments",
      type: "array",
      description: "Custom profile [{ duration (comp s), speed }] instead of a preset",
      required: false,
    },
    {
      name: "start",
      type: "number",
      description: "Comp time the ramp starts (default the layer's inPoint)",
      required: false,
    },
    {
      name: "smooth",
      type: "number",
      description:
        "Ease influence % at the speed changes, 1–100 (default 60; low = sharp cut in speed)",
      required: false,
    },
    {
      name: "frameBlend",
      type: "string",
      description: "pixel_motion | frame_mix (default) | none",
      required: false,
    },
    {
      name: "replace",
      type: "boolean",
      description: "Clear existing time-remap keys first (default false: skip and report)",
      required: false,
    },
  ],
  toJsx(args) {
    let keys: ReturnType<typeof rampKeys>;
    try {
      keys = rampKeys(
        rampSegments(
          args.preset as string | undefined,
          args.length as number | undefined,
          args.segments as RampSegment[] | undefined,
        ),
      );
    } catch (e) {
      return jsxFail((e as Error).message);
    }
    const fb = String(args.frameBlend ?? "frame_mix");
    if (!["pixel_motion", "frame_mix", "none"].includes(fb))
      return jsxFail("frameBlend must be pixel_motion, frame_mix or none");
    return `
            ${jsxCompPreamble(args)}
            var _l = AE.findLayerInComp(_comp, ${jsxVal(args.layer)});
            if (!_l) return { ok: false, error: "no layer matching " + ${jsxVal(JSON.stringify(args.layer))} };
            if (!_l.canSetTimeRemapEnabled) return { ok: false, error: _l.name + " cannot be time-remapped (needs footage with video or a precomp)" };
            var _keys = ${jsxVal(keys)};
            var _inf = Math.max(1, Math.min(100, ${jsxVal(args.smooth ?? 60)}));
            var _t0 = ${jsxVal(args.start ?? null)};
            if (_t0 === null) _t0 = _l.inPoint;
            var _src0 = (_t0 - _l.startTime) * 100 / _l.stretch;
            var _tr = _l.property("ADBE Time Remapping");
            if (_l.timeRemapEnabled && _tr.numKeys > 2 && !${jsxVal(args.replace === true)}) {
                return { ok: false, error: _l.name + " already has " + _tr.numKeys + " time-remap keys (pass replace: true to rebuild them)" };
            }
            if (_l.timeRemapEnabled) _src0 = _tr.valueAtTime(_t0, false);
            var _outBefore = _l.outPoint;
            _l.timeRemapEnabled = true;
            _tr = _l.property("ADBE Time Remapping");
            // Removing the last time-remap key switches Time Remap off (and
            // hides the property), so new keys go in first, old ones out after.
            var _oldTimes = [];
            for (var _o = 1; _o <= _tr.numKeys; _o++) _oldTimes.push(_tr.keyTime(_o));
            var _srcDur = _l.source.duration;
            var _last = _keys[_keys.length - 1];
            if (_src0 + _last.src > _srcDur) return { ok: false, error: "the ramp needs " + Math.round((_src0 + _last.src) * 100) / 100 + " s of source but " + _l.source.name + " has " + Math.round(_srcDur * 100) / 100 + " s from this point — shorten it or start earlier" };
            for (var _k = 0; _k < _keys.length; _k++) _tr.setValueAtTime(_t0 + _keys[_k].t, _src0 + _keys[_k].src);
            // After the ramp, normal speed until the layer's old end or the footage runs out.
            var _tail = Math.min(_outBefore - (_t0 + _last.t), _srcDur - (_src0 + _last.src));
            if (_tail > _comp.frameDuration) _tr.setValueAtTime(_t0 + _last.t + _tail, _src0 + _last.src + _tail);
            var _mine = {};
            for (var _n = 0; _n < _keys.length; _n++) _mine["k" + Math.round((_t0 + _keys[_n].t) * 1000)] = true;
            if (_tail > _comp.frameDuration) _mine["k" + Math.round((_t0 + _last.t + _tail) * 1000)] = true;
            for (var _d = _tr.numKeys; _d >= 1; _d--) {
                if (!_mine["k" + Math.round(_tr.keyTime(_d) * 1000)]) _tr.removeKey(_d);
            }
            for (var _j = 1; _j <= _tr.numKeys; _j++) {
                var _kt = _tr.keyTime(_j);
                var _sIn = 1, _sOut = 1;
                for (var _m = 0; _m < _keys.length; _m++) {
                    if (Math.abs(_t0 + _keys[_m].t - _kt) < 0.0005) { _sIn = _keys[_m].speedIn; _sOut = _keys[_m].speedOut; }
                }
                // One speed both sides = smooth. Taking the SLOWER side's speed
                // keeps source time moving forward: the average made the curve
                // overshoot inside slow-motion segments and run backwards.
                var _sp = Math.min(_sIn, _sOut);
                if (_j === 1) _sp = _sOut;
                if (_j === _tr.numKeys) _sp = _sIn;
                _tr.setTemporalEaseAtKey(_j, [new KeyframeEase(_sp, _inf)], [new KeyframeEase(_sp, _inf)]);
            }
            _l.inPoint = _t0;
            _l.outPoint = _tr.keyTime(_tr.numKeys);
            var _fb = ${jsxVal(fb)};
            try {
                if (_fb === "pixel_motion") _l.frameBlendingType = FrameBlendingType.PIXEL_MOTION;
                else if (_fb === "frame_mix") _l.frameBlendingType = FrameBlendingType.FRAME_MIX;
                else _l.frameBlendingType = FrameBlendingType.NO_FRAME_BLEND;
                if (_fb !== "none") _comp.frameBlending = true;
            } catch (eFb) { }
            try { _l.motionBlur = true; _comp.motionBlur = true; } catch (eMb) { }
            return { ok: true, layer: _l.name, from: _t0, to: _l.outPoint, sourceFrom: _src0, keys: _tr.numKeys, frameBlend: _fb };
        `;
  },
});

// ---------------------------------------------------------------------------
// Scene transitions (between two layers, usually scene precomps)
// ---------------------------------------------------------------------------

/** Outgoing / incoming preset pairs. `split` = the incoming starts half-way (flip). */
const SCENE_TRANSITIONS: Record<
  string,
  {
    out: string;
    outDir: Direction;
    in: string;
    inDir: Direction;
    duration: number;
    split?: boolean;
  }
> = {
  push: { out: "push_out", outDir: "left", in: "push_in", inDir: "right", duration: 0.7 },
  slide_up: { out: "push_out", outDir: "up", in: "push_in", inDir: "down", duration: 0.7 },
  whip: { out: "whip_out", outDir: "left", in: "whip_in", inDir: "right", duration: 0.4 },
  flip: {
    out: "flip_out",
    outDir: "left",
    in: "flip_in",
    inDir: "left",
    duration: 0.8,
    split: true,
  },
  dream: { out: "blur_out", outDir: "left", in: "zoom_blur_in", inDir: "left", duration: 0.9 },
  zoom: { out: "zoom_blur_out", outDir: "left", in: "scale_in", inDir: "left", duration: 0.6 },
};
export const SCENE_TRANSITION_TYPES = Object.keys(SCENE_TRANSITIONS);

/** The two jobs for a transition at cut time `cut` (relative starts resolved in JSX). */
export function sceneTransitionJobs(type: string, cut: number, duration?: number) {
  const d = SCENE_TRANSITIONS[type];
  if (!d)
    throw new Error(
      `unknown scene transition '${type}'. Known: ${SCENE_TRANSITION_TYPES.join(", ")}`,
    );
  const dur = duration ?? d.duration;
  const half = Math.round((dur / 2) * 1000) / 1000;
  const outJob = presetJob(d.out, {
    start: cut,
    duration: d.split ? half : dur,
    direction: d.outDir,
    replace: true,
  });
  const inJob = presetJob(d.in, {
    start: d.split ? cut + half : cut,
    duration: d.split ? half : dur,
    direction: d.inDir,
    replace: true,
  });
  return { duration: dur, outJob, inJob };
}

/** JSX defining `_sceneTransition(comp, a, b, jobs)`; needs ANIM_FN. */
const SCENE_TRANSITION_FN = `
    function _sceneTransition(comp, a, b, tj) {
        var cut = tj.outJob.start;
        var end = cut + tj.duration;
        // The outgoing scene must still have pictures until the transition ends.
        if (a.source instanceof CompItem) {
            var need = end - a.startTime;
            if (a.source.duration < need) a.source.duration = need;
        }
        a.outPoint = Math.max(a.outPoint, end);
        if (b.inPoint > cut) b.inPoint = cut;
        var ra = _animApply(a, tj.outJob);
        var rb = _animApply(b, tj.inJob);
        return { from: a.name, to: b.name, cut: cut, end: end, out: ra, "in": rb };
    }
`;

registerOp({
  name: "anim.scene_transition",
  category: "anim",
  description:
    "Transition between two scene layers (scene precomps or full-frame layers) at a cut, the way event reels do it: push (side-scroller push left), slide_up, whip (fast whip pan with motion blur), flip (3D card flip, Instagram-carousel style), dream (blur dissolve into a soft zoom), zoom (zoom-blur out, scale in). The outgoing layer is extended to cover the transition; both layers get ordinary editable keys.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "from", type: "any", description: "Outgoing layer", required: true },
    { name: "to", type: "any", description: "Incoming layer", required: true },
    {
      name: "type",
      type: "string",
      description: SCENE_TRANSITION_TYPES.join(" | "),
      required: true,
    },
    {
      name: "cut",
      type: "number",
      description: "Comp time of the cut (default: the incoming layer's inPoint)",
      required: false,
    },
    {
      name: "duration",
      type: "number",
      description: "Seconds (default 0.4–0.9 by type)",
      required: false,
    },
  ],
  toJsx(args) {
    if (!SCENE_TRANSITIONS[String(args.type)])
      return jsxFail(`type must be one of ${SCENE_TRANSITION_TYPES.join(", ")}`);
    let probe: ReturnType<typeof sceneTransitionJobs>;
    try {
      probe = sceneTransitionJobs(String(args.type), 0, args.duration as number | undefined);
    } catch (e) {
      return jsxFail((e as Error).message);
    }
    return `
            ${jsxCompPreamble(args)}
            ${ANIM_FN}
            ${SCENE_TRANSITION_FN}
            var _a = AE.findLayerInComp(_comp, ${jsxVal(args.from)});
            var _b = AE.findLayerInComp(_comp, ${jsxVal(args.to)});
            if (!_a || !_b) return { ok: false, error: "from/to layer not found" };
            var _tj = ${jsxVal(probe)};
            var _cut = ${jsxVal(args.cut ?? null)};
            if (_cut === null) _cut = _b.inPoint;
            var _dIn = _tj.inJob.start - _tj.outJob.start;
            _tj.outJob.start = _cut;
            _tj.inJob.start = _cut + _dIn;
            var _r = _sceneTransition(_comp, _a, _b, _tj);
            _r.ok = true;
            _r.type = ${jsxVal(String(args.type))};
            return _r;
        `;
  },
});

export { SCENE_TRANSITION_FN };
