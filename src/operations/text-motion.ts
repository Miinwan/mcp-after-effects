// Animation INSIDE text: per-character / per-word text animators (cascade
// entrances and exits, continuous waves) and a light sweep for any layer —
// including titles that are pictures of text, like PSD headlines.
//
// Everything lands as a named text animator ("Chữ · <preset>") or a named
// effect ("Shine (anim)") with ordinary keyframes and sliders, so it can be
// tuned by hand in the Timeline / Effect Controls afterwards.

import { jsxCompPreamble, jsxFail, jsxVal, registerOp, type OperationParam } from "../registry.js";
import { hexToRgb } from "./studio.js";
import { ANIM_FN } from "./snippets.js";

/** Range-selector Shape popup values (verified on AE 26.5). */
const SHAPE = { square: 1, rampUp: 2, rampDown: 3, triangle: 4, round: 5, smooth: 6 } as const;
/** Based On popup values. */
const BASED = { chars: 1, charsNoSpaces: 2, words: 3, lines: 4 } as const;

interface TextProp {
  m: string;
  v: number | number[];
  /** Value is in units of the font size (scaled in AE). */
  em?: boolean;
}

interface TextDef {
  kind: "in" | "loop";
  label: string;
  props: TextProp[];
  duration: number;
  spread?: number;
  shape?: number;
  basedOn?: number;
  randomize?: boolean;
  linear?: boolean;
  /** Loop: expression body using F (cycles/s) and K (delay per character) sliders. */
  expr?: string;
  freq?: number;
  delay?: number;
}

const OPACITY0: TextProp = { m: "ADBE Text Opacity", v: 0 };

const TEXT_DEFS: Record<string, TextDef> = {
  char_fade: { kind: "in", label: "Hiện dần", props: [OPACITY0], duration: 0.8, spread: 40 },
  typewriter: {
    kind: "in",
    label: "Đánh máy",
    props: [OPACITY0],
    duration: 1.2,
    shape: SHAPE.square,
    linear: true,
  },
  char_rise: {
    kind: "in",
    label: "Bay lên",
    props: [{ m: "ADBE Text Position 3D", v: [0, 0.6, 0], em: true }, OPACITY0],
    duration: 0.8,
    spread: 35,
  },
  char_drop: {
    kind: "in",
    label: "Rơi xuống",
    props: [{ m: "ADBE Text Position 3D", v: [0, -0.9, 0], em: true }, OPACITY0],
    duration: 0.8,
    spread: 35,
  },
  char_pop: {
    kind: "in",
    label: "Pop từng chữ",
    props: [{ m: "ADBE Text Scale 3D", v: [0, 0, 100] }, OPACITY0],
    duration: 0.7,
    spread: 30,
  },
  char_blur: {
    kind: "in",
    label: "Nhòe vào",
    props: [
      { m: "ADBE Text Blur", v: [0.5, 0.5], em: true },
      OPACITY0,
      { m: "ADBE Text Scale 3D", v: [130, 130, 100] },
    ],
    duration: 0.9,
    spread: 45,
  },
  char_rotate: {
    kind: "in",
    label: "Xoay vào",
    props: [
      { m: "ADBE Text Rotation", v: -90 },
      { m: "ADBE Text Position 3D", v: [0, 0.4, 0], em: true },
      OPACITY0,
    ],
    duration: 0.8,
    spread: 35,
  },
  char_random: {
    kind: "in",
    label: "Ngẫu nhiên",
    props: [OPACITY0, { m: "ADBE Text Scale 3D", v: [60, 60, 100] }],
    duration: 0.9,
    spread: 25,
    randomize: true,
  },
  word_pop: {
    kind: "in",
    label: "Pop từng từ",
    props: [{ m: "ADBE Text Scale 3D", v: [0, 0, 100] }, OPACITY0],
    duration: 0.7,
    spread: 35,
    basedOn: BASED.words,
  },
  tracking_in: {
    kind: "in",
    label: "Giãn chữ",
    props: [{ m: "ADBE Text Tracking Amount", v: 350 }, OPACITY0],
    duration: 1,
    spread: 100,
  },
  // Loops: an Expression Selector drives how much of the animator each
  // character gets, travelling across the text.
  wave: {
    kind: "loop",
    label: "Sóng chữ",
    props: [{ m: "ADBE Text Position 3D", v: [0, -0.18, 0], em: true }],
    duration: 0,
    expr: "selectorValue * Math.sin((time - sa) * F * Math.PI * 2 - textIndex * K) * ramp",
    freq: 1,
    delay: 0.45,
  },
  scale_wave: {
    kind: "loop",
    label: "Chữ to nhỏ",
    props: [{ m: "ADBE Text Scale 3D", v: [128, 128, 100] }],
    duration: 0,
    expr: "selectorValue * Math.max(0, Math.sin((time - sa) * F * Math.PI * 2 - textIndex * K)) * ramp",
    freq: 0.7,
    delay: 0.35,
  },
  jitter: {
    kind: "loop",
    label: "Rung chữ",
    props: [{ m: "ADBE Text Rotation", v: 6 }],
    duration: 0,
    expr: "seedRandom(textIndex, true); var w = noise((time - sa) * F * 3 + random(100)); selectorValue * w * ramp",
    freq: 1,
    delay: 0,
  },
};

export const TEXT_IN_PRESETS = Object.keys(TEXT_DEFS).filter((k) => TEXT_DEFS[k].kind === "in");
export const TEXT_LOOP_PRESETS = Object.keys(TEXT_DEFS).filter((k) => TEXT_DEFS[k].kind === "loop");

/** 'char_fade' ↔ 'char_fade_out', 'tracking_in' ↔ 'tracking_out'. */
function outName(inName: string): string {
  return inName.endsWith("_in") ? inName.slice(0, -3) + "_out" : inName + "_out";
}
function inNameOf(outPreset: string): string | null {
  for (const k of TEXT_IN_PRESETS) if (outName(k) === outPreset) return k;
  return null;
}
export const ALL_TEXT_PRESETS = [
  ...TEXT_IN_PRESETS,
  ...TEXT_IN_PRESETS.map(outName),
  ...TEXT_LOOP_PRESETS,
];

export function isTextPreset(p: string): boolean {
  return ALL_TEXT_PRESETS.includes(p);
}

export interface TextOptions {
  start?: number | null;
  duration?: number;
  spread?: number;
  basedOn?: "chars" | "words" | "lines";
  frequency?: number;
  replace?: boolean;
}

export interface TextJob {
  type: "text";
  preset: string;
  name: string;
  kind: "in" | "out" | "loop";
  start: number | null;
  duration: number;
  spread: number;
  shape: number;
  basedOn: number;
  randomize: boolean;
  linear: boolean;
  ease: [number, number];
  props: TextProp[];
  expr: string;
  startAfter: number | "auto" | null;
  controls: { name: string; value: number }[];
  replace: boolean;
}

export function textJob(preset: string, o: TextOptions = {}): TextJob {
  let base = preset;
  let kind: TextJob["kind"];
  if (TEXT_DEFS[preset]) kind = TEXT_DEFS[preset].kind === "loop" ? "loop" : "in";
  else {
    const i = inNameOf(preset);
    if (!i)
      throw new Error(`unknown text preset '${preset}'. Known: ${ALL_TEXT_PRESETS.join(", ")}`);
    base = i;
    kind = "out";
  }
  const d = TEXT_DEFS[base];
  const basedOn = o.basedOn
    ? { chars: BASED.chars, words: BASED.words, lines: BASED.lines }[o.basedOn]
    : (d.basedOn ?? BASED.chars);
  const name = `Chữ · ${d.label}${kind === "out" ? " (ra)" : ""}`;
  let expr = "";
  const controls: TextJob["controls"] = [];
  if (kind === "loop") {
    const fName = `${d.label} · tần số (lần/giây)`;
    const kName = `${d.label} · độ trễ mỗi chữ`;
    controls.push({ name: fName, value: o.frequency ?? d.freq ?? 1 });
    if (d.delay) controls.push({ name: kName, value: d.delay });
    expr = [
      "var sa = __SA__;",
      "var ramp = ease(time, sa, sa + 0.3, 0, 1);",
      `var F = effect(${JSON.stringify(fName)})("ADBE Slider Control-0001");`,
      d.delay
        ? `var K = effect(${JSON.stringify(kName)})("ADBE Slider Control-0001");`
        : "var K = 0;",
      d.expr!,
    ].join("\n");
  }
  const duration = o.duration ?? d.duration;
  if (kind !== "loop" && !(duration > 0)) throw new Error("duration must be > 0 seconds");
  return {
    type: "text",
    preset,
    name,
    kind,
    start: o.start ?? null,
    duration,
    spread: Math.min(100, Math.max(1, o.spread ?? d.spread ?? 40)),
    shape: d.shape ?? SHAPE.rampUp,
    basedOn,
    randomize: !!d.randomize,
    linear: !!d.linear,
    ease: kind === "out" ? [33, 15] : [15, 85],
    props: d.props,
    expr,
    startAfter: kind === "loop" ? (o.start ?? "auto") : null,
    controls,
    replace: o.replace ?? false,
  };
}

export interface ShineOptions {
  start?: number | null;
  duration?: number;
  repeatEvery?: number | null;
  angle?: number;
  width?: number;
  intensity?: number;
  color?: unknown;
  replace?: boolean;
}

export interface ShineJob {
  type: "shine";
  preset: "shine";
  start: number | null;
  duration: number;
  repeatEvery: number | null;
  angle: number;
  width: number;
  intensity: number;
  color: number[];
  replace: boolean;
}

export function shineJob(o: ShineOptions = {}): ShineJob {
  let color = [1, 0.98, 0.94, 1];
  if (o.color !== undefined && o.color !== null) {
    const c = hexToRgb(o.color);
    if (!c) throw new Error("color must be '#RRGGBB' or [r,g,b]");
    color = [...c, 1];
  }
  const duration = o.duration ?? 0.8;
  if (!(duration > 0)) throw new Error("duration must be > 0 seconds");
  if (o.repeatEvery != null && !(o.repeatEvery > duration))
    throw new Error("repeatEvery must be longer than duration");
  return {
    type: "shine",
    preset: "shine",
    start: o.start ?? null,
    duration,
    repeatEvery: o.repeatEvery ?? null,
    angle: o.angle ?? -25,
    width: o.width ?? 0.35,
    intensity: o.intensity ?? 60,
    color,
    replace: o.replace ?? false,
  };
}

const LAYERS: OperationParam = {
  name: "layers",
  type: "any",
  description: "Layer index, name, { id }, 'selected', 'all', or an array of those",
  required: true,
};

registerOp({
  name: "text.animate",
  category: "text",
  description:
    "Animate the letters INSIDE a text layer with a text animator + selector (per character, word or line). " +
    `Entrances: ${TEXT_IN_PRESETS.join(", ")} — char_fade (letters fade in left to right), typewriter, char_rise / char_drop (letters fly up / fall in), char_pop (each letter scales 0→100), char_blur (letters resolve from blur), char_rotate, char_random (random order), word_pop, tracking_in (letter spacing closes). ` +
    `Exits: the same with _out (${TEXT_IN_PRESETS.map(outName).join(", ")}). ` +
    `Loops: ${TEXT_LOOP_PRESETS.join(", ")} — wave (letters bob in a travelling wave), scale_wave (letters grow and shrink one after another: "chữ to nhỏ chạy qua"), jitter (playful wobble); speed and delay per letter are Slider Controls, the size is the animator's own value. ` +
    "Distances follow the font size. Each preset makes one animator named 'Chữ · <tên>' that can be edited by hand. Text layers only: for titles that are images use anim.shine / anim.apply.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    LAYERS,
    {
      name: "preset",
      type: "string",
      description: "Preset name (see description)",
      required: true,
    },
    {
      name: "start",
      type: "number",
      description:
        "Comp time (s) to begin (default: entrance at inPoint, exit at outPoint − duration, loop after the entrance finishes)",
      required: false,
    },
    {
      name: "duration",
      type: "number",
      description: "Seconds the whole text takes (default 0.7–1.2 by preset)",
      required: false,
    },
    {
      name: "spread",
      type: "number",
      description:
        "How many letters move at once, % of the text (default 25–45; small = crisp one-by-one, 100 = all together)",
      required: false,
    },
    {
      name: "basedOn",
      type: "string",
      description: "chars (default) | words | lines",
      required: false,
    },
    {
      name: "frequency",
      type: "number",
      description: "Loops: cycles per second (slider start value)",
      required: false,
    },
    {
      name: "stagger",
      type: "number",
      description: "Seconds added per following layer",
      required: false,
    },
    {
      name: "replace",
      type: "boolean",
      description: "Rebuild an animator with the same name (default false: skip and report)",
      required: false,
    },
  ],
  toJsx(args) {
    let job: TextJob;
    try {
      job = textJob(String(args.preset), {
        start: (args.start as number | undefined) ?? null,
        duration: args.duration as number | undefined,
        spread: args.spread as number | undefined,
        basedOn: args.basedOn as TextOptions["basedOn"],
        frequency: args.frequency as number | undefined,
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
            var _stagger = ${jsxVal(args.stagger ?? 0)};
            var _base = _job.start;
            var _out = [];
            for (var _i = 0; _i < _layers.length; _i++) {
                if (_base !== null) _job.start = _base + _stagger * _i;
                else if (_stagger && _job.kind === "out") _job.start = _layers[_i].outPoint - _job.duration - _stagger * (_layers.length - 1 - _i);
                else if (_stagger) _job.start = _layers[_i].inPoint + _stagger * _i;
                _out.push(_txtApply(_layers[_i], _job));
            }
            return { ok: true, comp: _comp.name, preset: _job.preset, layers: _out };
        `;
  },
});

registerOp({
  name: "anim.shine",
  category: "anim",
  description:
    "Sweep a band of light across a layer (CC Light Sweep, named 'Shine (anim)'): works on text layers AND on titles, logos or products that are images. Starts after the layer's entrance by default; repeatEvery makes it pass again every N seconds (keys + loopOut, editable). Angle, width (fraction of the layer's short side), intensity and colour are adjustable.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    LAYERS,
    {
      name: "start",
      type: "number",
      description: "Comp time (s) of the first pass (default: just after the entrance)",
      required: false,
    },
    {
      name: "duration",
      type: "number",
      description: "Seconds one pass takes (default 0.8)",
      required: false,
    },
    {
      name: "repeatEvery",
      type: "number",
      description: "Seconds between passes (omit for a single pass)",
      required: false,
    },
    {
      name: "angle",
      type: "number",
      description: "Sweep direction in degrees (default −25)",
      required: false,
    },
    {
      name: "width",
      type: "number",
      description: "Band width as a fraction of the layer's short side (default 0.35)",
      required: false,
    },
    {
      name: "intensity",
      type: "number",
      description: "Sweep intensity (default 60)",
      required: false,
    },
    {
      name: "color",
      type: "any",
      description: "Light colour '#RRGGBB' (default warm white)",
      required: false,
    },
    {
      name: "stagger",
      type: "number",
      description: "Seconds added per following layer",
      required: false,
    },
    {
      name: "replace",
      type: "boolean",
      description: "Rebuild an existing 'Shine (anim)' (default false)",
      required: false,
    },
  ],
  toJsx(args) {
    let job: ShineJob;
    try {
      job = shineJob(args as ShineOptions);
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
            var _base = _job.start;
            var _out = [];
            for (var _i = 0; _i < _layers.length; _i++) {
                if (_base !== null) _job.start = _base + _stagger * _i;
                _out.push(_shineApply(_layers[_i], _job));
            }
            return { ok: true, comp: _comp.name, layers: _out };
        `;
  },
});
