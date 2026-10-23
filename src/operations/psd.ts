// PSD → animation: import a layered PSD as a comp, work out what each layer
// is (background, logo, headline, info, CTA, hero, decor) from its name or,
// failing that, its size and position, and turn that into an anim.apply_plan
// plan. psd.plan only proposes — Claude or anh edits the plan before it runs;
// psd.auto_animate runs it straight away.

import { jsxCompPreamble, jsxFail, jsxVal, registerOp } from "../registry.js";
import type { AeTransport } from "../transport/AeTransport.js";
import {
  resolvePlan,
  SCENE_TRANSITION_FN,
  SCENE_TRANSITION_TYPES,
  sceneTransitionJobs,
  type Direction,
  type PlanLoop,
  type PlanStep,
} from "./motion.js";
import { ANIM_FN } from "./snippets.js";

// ---------------------------------------------------------------------------
// Scanning the comp
// ---------------------------------------------------------------------------

export interface ScannedLayer {
  index: number;
  id: number;
  name: string;
  isText: boolean;
  isComp: boolean;
  enabled: boolean;
  /** [left, top, right, bottom] in comp pixels at the scan time. */
  bounds: number[];
  /** Share of the comp frame the bounds cover (0–1). */
  area: number;
  /** Rendered font size × scale for text layers, else 0. */
  fontSize: number;
  hasKeys: boolean;
}

export interface ScannedComp {
  name: string;
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  layers: ScannedLayer[];
}

/** Defines `_psdScan(comp, t)` → ScannedComp. */
const SCAN_FN = `
    function _psdScan(comp, t) {
        var out = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var l = comp.layer(i);
            var r = null;
            try { r = l.sourceRectAtTime(t, false); } catch (eR) { r = null; }
            var tg = l.property("ADBE Transform Group");
            var b = [0, 0, 0, 0];
            if (r && tg) {
                var pos = tg.property("ADBE Position").valueAtTime(t, false);
                var anc = tg.property("ADBE Anchor Point").valueAtTime(t, false);
                var sc = tg.property("ADBE Scale").valueAtTime(t, false);
                var x0 = pos[0] + (r.left - anc[0]) * sc[0] / 100;
                var y0 = pos[1] + (r.top - anc[1]) * sc[1] / 100;
                var x1 = x0 + r.width * sc[0] / 100;
                var y1 = y0 + r.height * sc[1] / 100;
                b = [Math.round(Math.min(x0, x1)), Math.round(Math.min(y0, y1)), Math.round(Math.max(x0, x1)), Math.round(Math.max(y0, y1))];
            }
            var cw = Math.max(0, Math.min(b[2], comp.width) - Math.max(b[0], 0));
            var ch = Math.max(0, Math.min(b[3], comp.height) - Math.max(b[1], 0));
            var fs = 0;
            var isText = l instanceof TextLayer;
            if (isText) {
                try { fs = l.property("ADBE Text Properties").property("ADBE Text Document").valueAtTime(t, false).fontSize * (tg ? tg.property("ADBE Scale").valueAtTime(t, false)[1] / 100 : 1); } catch (eF) { fs = 0; }
            }
            var keyed = false;
            if (tg) {
                for (var p = 1; p <= tg.numProperties; p++) { try { if (tg.property(p).numKeys > 0) keyed = true; } catch (eK) { } }
            }
            out.push({
                index: i,
                id: l.id,
                name: l.name,
                isText: isText,
                isComp: (l.source instanceof CompItem),
                enabled: l.enabled,
                bounds: b,
                area: Math.round((cw * ch) / (comp.width * comp.height) * 10000) / 10000,
                fontSize: Math.round(fs * 10) / 10,
                hasKeys: keyed
            });
        }
        return { name: comp.name, width: comp.width, height: comp.height, duration: comp.duration, frameRate: comp.frameRate, layers: out };
    }
`;

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export type Role = "background" | "logo" | "headline" | "info" | "cta" | "hero" | "decor";

/** Keywords per role, matched against the layer name with accents removed. */
const ROLE_KEYWORDS: [Role, string[]][] = [
  ["background", ["bg", "nen", "background", "backdrop", "hinh nen"]],
  ["logo", ["logo", "nhan hieu"]],
  ["cta", ["cta", "nut", "button", "dang ky", "dang ki", "book now", "mua ngay", "lien he"]],
  ["headline", ["title", "tieu de", "headline", "heading", "chu lon", "ten su kien"]],
  [
    "info",
    [
      "ngay",
      "gio",
      "dia diem",
      "date",
      "time",
      "sub",
      "subtitle",
      "thoi gian",
      "tang",
      "gia",
      "price",
      "dia chi",
      "thong tin",
      "info",
    ],
  ],
  [
    "hero",
    [
      "san pham",
      "sp",
      "nguoi",
      "model",
      "hero",
      "kv",
      "key visual",
      "mascot",
      "linh vat",
      "nhan vat",
      "product",
      "mon",
    ],
  ],
  [
    "decor",
    [
      "decor",
      "trang tri",
      "icon",
      "sao",
      "star",
      "hoa",
      "la",
      "bong bay",
      "confetti",
      "sparkle",
      "lap lanh",
      "may",
      "cloud",
      "keo",
      "candy",
      "ribbon",
      "particle",
      "zoom line",
      "line",
      "tia",
      "streak",
      "burst",
    ],
  ],
];

export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Role from the name alone, or null. Whole-word match, so "sub" never hits "subway". */
export function roleFromName(name: string): Role | null {
  const n = ` ${normalizeName(name)} `;
  for (const [role, words] of ROLE_KEYWORDS) {
    for (const w of words) if (n.includes(` ${w} `)) return role;
  }
  return null;
}

export interface RoledLayer extends ScannedLayer {
  role: Role;
  roleFrom: "name" | "geometry";
}

/** PSD fill / outline layers that back the artwork above them (sticker borders). */
export function isBacking(name: string): boolean {
  return /^(color fill|solid color|fill|shape|vien|outline|sticker|stroke)\b/.test(
    normalizeName(name),
  );
}

/** Give every enabled layer a role: name first, then size and position. */
export function assignRoles(comp: ScannedComp): RoledLayer[] {
  const layers = comp.layers.filter((l) => l.enabled);
  const out: RoledLayer[] = layers.map((l) => {
    const r = roleFromName(l.name);
    return { ...l, role: r ?? "decor", roleFrom: r ? "name" : "geometry" };
  });
  const unknown = out.filter((l) => l.roleFrom === "geometry");
  // Biggest text by rendered size → headline (only if no headline was named).
  const texts = unknown
    .filter((l) => l.isText)
    .sort((a, b) => b.fontSize - a.fontSize || b.area - a.area);
  const hasHeadline = out.some((l) => l.role === "headline" && l.roleFrom === "name");
  texts.forEach((l, n) => {
    l.role = n === 0 && !hasHeadline ? "headline" : "info";
  });
  for (const l of unknown) {
    if (l.isText) continue;
    if (l.area >= 0.85) l.role = "background";
    else if (l.area < 0.03) l.role = "decor";
    else l.role = "hero";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type Style = "smooth" | "pop" | "energetic";

interface RoleRecipe {
  preset: string;
  at: number;
  stagger: number;
  duration?: number;
  direction?: Direction;
  distance?: number;
  overshoot?: number;
  loop?: string;
}

/** Entrance recipe per style and role. Times are seconds at tempo 1. */
const RECIPES: Record<Style, Partial<Record<Role, RoleRecipe>>> = {
  smooth: {
    hero: { preset: "rise_in", at: 0.2, stagger: 0.12, duration: 0.8, loop: "float" },
    headline: { preset: "rise_in", at: 0.45, stagger: 0.1, duration: 0.8 },
    info: { preset: "rise_in", at: 0.8, stagger: 0.12, duration: 0.7 },
    decor: { preset: "fade_in", at: 1.0, stagger: 0.08, duration: 0.6, loop: "float" },
    logo: { preset: "fade_in", at: 1.3, stagger: 0, duration: 0.6 },
    cta: { preset: "rise_in", at: 1.5, stagger: 0.1, duration: 0.7, loop: "pulse" },
  },
  pop: {
    hero: { preset: "pop_in", at: 0.15, stagger: 0.1, duration: 0.55, loop: "float" },
    headline: { preset: "pop_in", at: 0.35, stagger: 0.08, duration: 0.5 },
    info: { preset: "rise_in", at: 0.6, stagger: 0.08, duration: 0.5 },
    decor: { preset: "pop_in", at: 0.75, stagger: 0.06, duration: 0.45, loop: "sway" },
    logo: { preset: "fade_in", at: 0.9, stagger: 0, duration: 0.4 },
    cta: { preset: "pop_in", at: 1.05, stagger: 0.08, duration: 0.5, loop: "pulse" },
  },
  energetic: {
    // Event-reel style: elements whip up from below with motion blur, headline pops hard.
    hero: {
      preset: "slide_in",
      at: 0.1,
      stagger: 0.08,
      duration: 0.45,
      direction: "down",
      overshoot: 0.06,
      loop: "float",
    },
    headline: { preset: "pop_in", at: 0.2, stagger: 0.06, duration: 0.4, overshoot: 0.12 },
    info: { preset: "rise_in", at: 0.4, stagger: 0.06, duration: 0.4 },
    decor: {
      preset: "pop_in",
      at: 0.5,
      stagger: 0.05,
      duration: 0.35,
      overshoot: 0.15,
      loop: "sway",
    },
    logo: { preset: "fade_in", at: 0.6, stagger: 0, duration: 0.3 },
    cta: { preset: "pop_in", at: 0.75, stagger: 0.06, duration: 0.4, loop: "pulse" },
  },
};

const ROLE_ORDER: Role[] = ["hero", "headline", "info", "decor", "logo", "cta"];

/** Style from the brief's wording when none was given. */
export function styleFromBrief(brief: string | undefined): Style | null {
  if (!brief) return null;
  const b = normalizeName(brief);
  if (/\b(cham|nhe nhang|sang trong|tinh te|em diu|thu gian|luxury|elegant|calm|slow)\b/.test(b))
    return "smooth";
  if (/\b(soi dong|nhanh|manh|nang dong|giat|energetic|fast|hype|tiktok)\b/.test(b))
    return "energetic";
  if (/\b(vui|de thuong|tre trung|cute|fun|playful|pop)\b/.test(b)) return "pop";
  return null;
}

export interface PlanOptions {
  style?: Style;
  brief?: string;
  /** Seconds the piece runs (default: comp duration). */
  duration?: number;
  /** Add exits before the end (default false). */
  exit?: boolean;
  /** Roles or layer names that must not move (e.g. ['logo'] for a fixed brand mark). */
  keepStatic?: string[];
  /** Seed for the composed look (directions, presets, text styles, loops, exits, accents, tempo). Omit for the plain style recipe. */
  seed?: number;
  /** The previous scene's look, so this one avoids repeating it. */
  avoid?: VariantDef | null;
}

interface VariantDef {
  label: string;
  role: Partial<Record<Role, { preset?: string; direction?: Direction; loop?: string | null }>>;
  /** Text-layer headline / info get per-letter animation instead. */
  textHeadline: string;
  textInfo: string;
  /** Loop added to a text headline after it lands. */
  textLoop?: string;
  exit: { preset: string; direction: Direction };
  shine: boolean;
  /** Multiplies the style tempo (0.85–1.15) so jobs do not share one rhythm. */
  tempo: number;
}

// Pools the composer draws from. Adding a look = adding an entry here.
type Pick = { preset: string; direction?: Direction };
const DIRS: Direction[] = ["down", "left", "right", "up"];
const POOLS = {
  hero: [
    "slide_in",
    "drop_in",
    "pop_in",
    "rise_in",
    "scale_in",
    "rotate_in",
    "stretch_in",
    "blur_in",
    "whip_in",
    "swing_in",
    "flip_in",
    "zoom_blur_in",
  ],
  headline: [
    "pop_in",
    "stretch_in",
    "scale_in",
    "wipe_in",
    "blur_in",
    "drop_in",
    "rise_in",
    "zoom_blur_in",
    "flip_in",
  ],
  decor: ["pop_in", "rotate_in", "scale_in", "drop_in", "fade_in", "stretch_in", "swing_in"],
  textHeadline: [
    "char_pop",
    "char_rise",
    "char_drop",
    "char_blur",
    "char_rotate",
    "char_random",
    "tracking_in",
    "typewriter",
  ],
  textInfo: ["char_fade", "word_pop", "typewriter", "char_rise", "tracking_in", "char_random"],
  textLoop: ["wave", "scale_wave", "jitter", null, null],
  heroLoop: ["float", "sway", "float", "hop", null],
  decorLoop: ["sway", "float", "twinkle", "flutter"],
  exit: [
    "slide_out",
    "pop_out",
    "scale_out",
    "blur_out",
    "fade_out",
    "drop_out",
    "rotate_out",
    "whip_out",
    "flip_out",
    "zoom_blur_out",
  ],
};

/** Small deterministic PRNG (mulberry32) so a seed always rebuilds the same look. */
export function rngFor(seed: number): () => number {
  return rng(seed);
}
function rng(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Compose a scene look from the pools. `avoid` is the previous scene's look:
 * its hero, headline and exit choices are not reused, so neighbours differ.
 */
export function composeVariant(seed: number, avoid?: VariantDef | null): VariantDef {
  const r = rng(seed);
  const pick = <T>(xs: readonly T[], not?: T): T => {
    const pool = xs.filter((x) => x !== not);
    // null is a real choice ("no loop"), so no ?? fallback here.
    return pool.length ? pool[Math.floor(r() * pool.length)] : xs[0];
  };
  const dirFor = (preset: string): Direction | undefined => {
    if (preset === "drop_in") return "up";
    if (preset === "rise_in") return "down";
    if (preset === "swing_in") return "up";
    if (["slide_in", "wipe_in", "whip_in"].includes(preset)) return pick(DIRS);
    return undefined;
  };
  const hero: Pick = { preset: pick(POOLS.hero, avoid?.role.hero?.preset) };
  hero.direction = dirFor(hero.preset);
  const headline: Pick = { preset: pick(POOLS.headline, avoid?.role.headline?.preset) };
  headline.direction = dirFor(headline.preset);
  const decor: Pick = { preset: pick(POOLS.decor, avoid?.role.decor?.preset) };
  const exitPreset = pick(POOLS.exit, avoid?.exit.preset);
  const v: VariantDef = {
    label: "",
    role: {
      hero: { ...hero, loop: pick(POOLS.heroLoop) },
      headline,
      decor: { ...decor, loop: pick(POOLS.decorLoop) },
    },
    textHeadline: pick(POOLS.textHeadline, avoid?.textHeadline),
    textInfo: pick(POOLS.textInfo, avoid?.textInfo),
    textLoop: pick(POOLS.textLoop) ?? undefined,
    exit: { preset: exitPreset, direction: pick(DIRS) },
    shine: r() < 0.5,
    tempo: Math.round((0.85 + r() * 0.3) * 100) / 100,
  };
  v.label =
    `seed ${seed}: hero ${hero.preset}${hero.direction ? ` (${hero.direction})` : ""}, headline ${headline.preset}` +
    `${headline.direction ? ` (${headline.direction})` : ""}, decor ${decor.preset}, text ${v.textHeadline}/${v.textInfo}` +
    `${v.textLoop ? ` + ${v.textLoop}` : ""}, exit ${exitPreset} ${v.exit.direction}${v.shine ? ", shine" : ""}, tempo ×${v.tempo}`;
  return v;
}

export interface PsdPlan {
  style: Style;
  tempo: number;
  roles: { name: string; index: number; id: number; role: Role; roleFrom: string }[];
  plan: (PlanStep & { name: string; role: Role })[];
  loops: (PlanLoop & { name: string })[];
  notes: string[];
}

const TEMPO: Record<Style, number> = { smooth: 1.3, pop: 1, energetic: 0.8 };
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Rotating or scaling a canvas-sized layer pivots round the canvas centre,
 * swinging masked artwork across the frame — such layers only translate or fade.
 */
function canvasSafe(l: ScannedLayer, preset: string): string {
  if (l.area < 0.85) return preset;
  const base = preset.replace(/_(in|out)$/, "");
  const end = preset.endsWith("_out") ? "_out" : "_in";
  if (["rotate", "scale", "pop", "stretch"].includes(base))
    return (end === "_in" ? "rise" : "fade") + end;
  return preset;
}

export function planFromScan(comp: ScannedComp, opts: PlanOptions = {}): PsdPlan {
  const notes: string[] = [];
  const style: Style = opts.style ?? styleFromBrief(opts.brief) ?? "pop";
  if (!opts.style && opts.brief)
    notes.push(
      `style '${style}' chosen from the brief wording — read the brief and adjust the plan if it asks for something specific`,
    );
  let tempo = TEMPO[style];
  const total = opts.duration ?? comp.duration;
  const layers = assignRoles(comp);
  const statics = new Set((opts.keepStatic ?? []).map((s) => normalizeName(s)));
  const isStatic = (l: RoledLayer) => statics.has(l.role) || statics.has(normalizeName(l.name));
  const plan: PsdPlan["plan"] = [];
  const loops: PsdPlan["loops"] = [];

  // Only the bottom-most background drifts. A full-frame layer higher up is
  // usually artwork on a canvas-sized layer (a product smart object, a
  // masked fill), so geometry-guessed ones animate as heroes; ones NAMED as
  // background stay static.
  const bgs = layers
    .filter((x) => x.role === "background" && !isStatic(x))
    .sort((a, b) => b.index - a.index);
  if (bgs.length) {
    const l = bgs[0];
    plan.push({
      layer: { id: l.id },
      name: l.name,
      role: "background",
      preset: "ken_burns",
      start: 0,
      duration: r2(total),
      motionBlur: false,
    });
  }
  for (const l of bgs.slice(1)) {
    if (l.roleFrom === "geometry") {
      l.role = "hero";
      notes.push(`'${l.name}' is canvas-sized but sits above the background — animated as a hero`);
    } else {
      notes.push(`'${l.name}' is named as background and left static`);
    }
  }
  // Backings follow the nearest non-backing artwork above them instead of
  // animating on their own.
  const followers = new Map<number, RoledLayer>();
  for (const l of layers) {
    if (!isBacking(l.name) || l.role === "background" || isStatic(l)) continue;
    const host = layers
      .filter(
        (h) => h.index < l.index && !isBacking(h.name) && h.role !== "background" && !isStatic(h),
      )
      .sort((a, b) => b.index - a.index)[0];
    if (host) followers.set(l.id, host);
  }
  const recipes = RECIPES[style];
  const vdef =
    opts.seed === undefined || opts.seed === null ? null : composeVariant(opts.seed, opts.avoid);
  if (vdef) {
    notes.push(`look ${vdef.label}`);
    tempo = r2(tempo * vdef.tempo);
  }
  const entered: PsdPlan["plan"] = [];
  const layerById = new Map(layers.map((l) => [l.id, l as ScannedLayer]));
  for (const role of ROLE_ORDER) {
    const rc = recipes[role];
    if (!rc) continue;
    // Top of the frame first, then left to right — reading order.
    const group = layers
      .filter((l) => l.role === role && !isStatic(l) && !followers.has(l.id))
      .sort((a, b) => a.bounds[1] - b.bounds[1] || a.bounds[0] - b.bounds[0]);
    const ov = vdef?.role[role] ?? {};
    const preset = ov.preset ?? rc.preset;
    const direction = ov.direction ?? rc.direction;
    group.forEach((l, n) => {
      const start = r2((rc.at + rc.stagger * n) * tempo);
      const textPreset =
        l.isText && vdef
          ? role === "headline"
            ? vdef.textHeadline
            : role === "info" || role === "cta"
              ? vdef.textInfo
              : null
          : null;
      const step = {
        layer: { id: l.id },
        name: l.name,
        role,
        preset: textPreset ?? canvasSafe(l, preset),
        start,
        duration: r2((textPreset ? 0.9 : (rc.duration ?? 0.6)) * tempo),
        ...(!textPreset && direction ? { direction } : {}),
        ...(!textPreset && rc.overshoot ? { overshoot: rc.overshoot } : {}),
        ...(!textPreset &&
        style === "energetic" &&
        direction &&
        ["slide_in", "drop_in"].includes(preset)
          ? { distance: Math.round(comp.height * 0.3) }
          : {}),
      };
      plan.push(step);
      entered.push(step);
      const landed = r2(start + step.duration);
      if (vdef && role === "headline") {
        if (l.isText && vdef.textLoop)
          plan.push({
            layer: { id: l.id },
            name: l.name,
            role,
            preset: vdef.textLoop,
            start: r2(landed + 0.2),
          });
        if (vdef.shine)
          plan.push({
            layer: { id: l.id },
            name: l.name,
            role,
            preset: "shine",
            start: r2(landed + 0.15),
            duration: 0.7,
          });
      }
      if (vdef && role === "cta")
        plan.push({
          layer: { id: l.id },
          name: l.name,
          role,
          preset: "shine",
          start: r2(landed + 0.2),
          duration: 0.6,
          repeatEvery: 1.6,
        });
      // Decor alternates float/sway so neighbours do not move alike.
      let loop = ov.loop !== undefined ? ov.loop : rc.loop;
      if (role === "decor" && loop) loop = n % 2 === 0 ? loop : loop === "sway" ? "float" : "sway";
      if (loop) loops.push({ layer: { id: l.id }, name: l.name, type: loop });
    });
  }
  for (const [id, host] of followers) {
    const l = layers.find((x) => x.id === id)!;
    plan.push({
      layer: { id },
      name: l.name,
      role: l.role,
      preset: "follow",
      to: { id: host.id },
    } as PsdPlan["plan"][number]);
    notes.push(`'${l.name}' backs '${host.name}' and follows it (parented, opacity linked)`);
  }
  for (const l of layers.filter(isStatic))
    notes.push(`'${l.name}' (${l.role}) kept static as asked`);
  const ends = entered.map((p) => (p.start ?? 0) + (p.duration ?? 0));
  const settled = ends.length ? Math.max(...ends) : 0;
  if (settled > total - 1.5)
    notes.push(
      `entrances finish at ${r2(settled)} s, leaving under 1.5 s to read before ${r2(total)} s — lengthen the comp or tighten the plan`,
    );
  if (opts.exit) {
    const movers = entered.slice().reverse();
    movers.forEach((p, n) => {
      plan.push({
        layer: p.layer,
        name: p.name,
        role: p.role,
        preset: canvasSafe(
          layerById.get((p.layer as { id: number }).id)!,
          vdef ? vdef.exit.preset : style === "smooth" ? "fade_out" : "slide_out",
        ),
        direction: vdef ? vdef.exit.direction : "down",
        start: r2(total - 0.55 * tempo - 0.04 * (movers.length - 1 - n)),
        duration: r2(0.4 * tempo),
      });
    });
  }
  if (!layers.some((l) => l.role === "headline"))
    notes.push("no headline found — rename the title layer (e.g. 'Tiêu đề') or edit the plan");
  return {
    style,
    tempo,
    roles: layers.map((l) => ({
      name: l.name,
      index: l.index,
      id: l.id,
      role: l.role,
      roleFrom: l.roleFrom,
    })),
    plan,
    loops,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

function nodeOnly(name: string): string {
  return jsxFail(`${name} runs on the MCP server side and cannot be used inside batch.run`);
}

async function scan(
  transport: AeTransport,
  comp: unknown,
  time: number | null,
): Promise<ScannedComp | { ok: false; error: string }> {
  const res = await transport.execute({
    label: "psd.scan",
    undoGroup: false,
    code: `
        ${jsxCompPreamble({ comp })}
        ${SCAN_FN}
        var _t = ${jsxVal(time)};
        if (_t === null) _t = Math.min(_comp.duration - _comp.frameDuration, Math.max(0, _comp.duration * 0.6));
        var _s = _psdScan(_comp, _t);
        _s.ok = true;
        return _s;
    `,
  });
  if (!res.ok) return { ok: false, error: res.error ?? "scan failed" };
  const r = res.result as ScannedComp & { ok?: boolean; error?: string };
  if (r.ok === false) return { ok: false, error: String(r.error) };
  const { ok: _ok, ...scanned } = r;
  return scanned;
}

registerOp({
  name: "psd.import",
  category: "psd",
  description:
    "Import a layered PSD as a comp ready to animate: cropped layers (each layer keeps its own size and a centred anchor) when AE allows, else full-frame layers; sets fps and duration and stretches every layer (and nested group precomps) to the full duration; optionally converts PSD text to editable text. " +
    "Returns every layer with its comp bounds, share of the frame and whether it is text — the input for psd.plan. After editableText, run text.qa (fonts missing Vietnamese glyphs show up there).",
  params: [
    { name: "path", type: "string", description: "Absolute path of the .psd", required: true },
    { name: "fps", type: "number", description: "Frame rate (default 25)", required: false },
    { name: "duration", type: "number", description: "Seconds (default 10)", required: false },
    {
      name: "folder",
      type: "string",
      description: "Project folder to put the comp in (created if missing)",
      required: false,
    },
    {
      name: "editableText",
      type: "boolean",
      description: "Convert PSD text layers to editable AE text (default false)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${SCAN_FN}
            var _f = new File(${jsxVal(args.path)});
            if (!_f.exists) return { ok: false, error: "file not found: " + ${jsxVal(args.path)} };
            var _io = new ImportOptions(_f);
            var _mode = null;
            if (_io.canImportAs(ImportAsType.COMP_CROPPED_LAYERS)) { _io.importAs = ImportAsType.COMP_CROPPED_LAYERS; _mode = "cropped layers"; }
            else if (_io.canImportAs(ImportAsType.COMP)) { _io.importAs = ImportAsType.COMP; _mode = "comp"; }
            else return { ok: false, error: "After Effects cannot import this file as a layered comp" };
            var _comp = app.project.importFile(_io);
            if (!(_comp instanceof CompItem)) return { ok: false, error: "import did not produce a comp" };
            var _fps = ${jsxVal(args.fps ?? 25)};
            var _dur = ${jsxVal(args.duration ?? 10)};
            var _seen = {};
            function _stretch(c) {
                if (_seen["c" + c.id]) return;
                _seen["c" + c.id] = true;
                c.frameRate = _fps;
                c.duration = _dur;
                for (var i = 1; i <= c.numLayers; i++) {
                    var l = c.layer(i);
                    if (l.source instanceof CompItem) _stretch(l.source);
                    try { l.inPoint = 0; l.outPoint = _dur; } catch (eS) { }
                }
            }
            _stretch(_comp);
            var _folderName = ${jsxVal(args.folder ?? null)};
            if (_folderName) {
                var _fold = AE.findFolder(_folderName);
                if (!_fold) _fold = app.project.items.addFolder(_folderName);
                _comp.parentFolder = _fold;
            }
            var _converted = null;
            if (${jsxVal(args.editableText === true)}) {
                _comp.openInViewer();
                var _all = [];
                for (var _i = 1; _i <= _comp.numLayers; _i++) _all.push(_comp.layer(_i));
                var _cmd = app.findMenuCommandId("Convert to Editable Text");
                if (!_cmd) _cmd = 3799;
                AE.withSelection(_comp, _all, function () { app.executeCommand(_cmd); });
                var _texts = 0;
                for (var _j = 1; _j <= _comp.numLayers; _j++) if (_comp.layer(_j) instanceof TextLayer) _texts++;
                _converted = _texts;
            }
            var _s = _psdScan(_comp, 0);
            return { ok: true, comp: _comp.name, id: _comp.id, mode: _mode, size: [_comp.width, _comp.height], fps: _fps, duration: _dur, editableTextLayers: _converted, layers: _s.layers, next: "psd.plan { comp } to propose an animation" + (_converted !== null ? "; text.qa { comp } to check fonts" : "") };
        `;
  },
});

const PLAN_PARAMS = [
  {
    name: "comp",
    type: "any" as const,
    description: "Comp name or id (an imported PSD or any comp)",
    required: true,
  },
  {
    name: "style",
    type: "string" as const,
    description: "smooth | pop (default) | energetic (event-reel whips with motion blur)",
    required: false,
  },
  {
    name: "brief",
    type: "string" as const,
    description:
      "Client brief text; picks the style when none is given and is returned for you to adjust the plan",
    required: false,
  },
  {
    name: "duration",
    type: "number" as const,
    description: "Seconds the piece runs (default comp duration)",
    required: false,
  },
  {
    name: "exit",
    type: "boolean" as const,
    description: "Add exits at the end (default false)",
    required: false,
  },
  {
    name: "keepStatic",
    type: "array" as const,
    description: "Roles or layer names that must not move, e.g. ['logo']",
    required: false,
  },
  {
    name: "scanTime",
    type: "number" as const,
    description: "Time to measure layers at (default 60 % of the comp)",
    required: false,
  },
  {
    name: "seed",
    type: "number" as const,
    description:
      "Compose a fresh look from the motion pools (hero/headline/decor entrances and directions, per-letter text styles, loops, exits, shine, tempo) — a different seed gives a different job look; the same seed rebuilds it. Omit for the plain style recipe. Treat the result as a starting point and adapt it to the brief",
    required: false,
  },
];

function planOptions(args: Record<string, unknown>): PlanOptions | string {
  const style = args.style as Style | undefined;
  if (style !== undefined && !(style in RECIPES))
    return `style must be one of ${Object.keys(RECIPES).join(", ")}`;
  return {
    style,
    brief: args.brief as string | undefined,
    duration: args.duration as number | undefined,
    exit: args.exit as boolean | undefined,
    keepStatic: args.keepStatic as string[] | undefined,
    seed: args.seed as number | undefined,
  };
}

/** Scan a comp, plan it and apply the plan as one undo step. */
async function animateComp(
  transport: AeTransport,
  comp: unknown,
  opts: PlanOptions,
  scanTime: number | null,
) {
  const s = await scan(transport, comp, scanTime);
  if ("error" in s) return s;
  const p = planFromScan(s, opts);
  let resolved: ReturnType<typeof resolvePlan>;
  try {
    resolved = resolvePlan(p.plan, p.loops);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
  const { planJsx } = await import("./motion.js");
  const res = await transport.execute({
    label: "psd.animate",
    code: `
          ${jsxCompPreamble({ comp })}
          ${ANIM_FN}
          ${planJsx(resolved)}
          var _okSteps = 0;
          for (var _c = 0; _c < _planOut.steps.length; _c++) if (!_planOut.steps[_c].skipped) _okSteps++;
          return { ok: true, animated: _okSteps, steps: _planOut.steps, loops: _planOut.loops };
      `,
  });
  if (!res.ok) return { ok: false as const, error: res.error ?? "apply failed" };
  return { ok: true as const, comp: s.name, plan: p, applied: res.result };
}

registerOp({
  name: "psd.plan",
  category: "psd",
  readOnly: true,
  description:
    "Propose an animation for a comp built from a PSD (does not change anything): gives each layer a role — background, logo, headline, info, cta, hero, decor — from its name (Vietnamese or English keywords: nền/bg, tiêu đề/title, ngày/giờ/địa điểm, nút/cta, sản phẩm/mascot/kv, trang trí/sao/mây…) or else from size and position, then lays out the default order: background Ken Burns 100→106 %, hero, headline, info staggered, decor pop + float/sway, logo, CTA pop + pulse. " +
    "Returns { plan, loops } in anim.apply_plan's shape plus roles and notes. Edit it (or let anh edit it) and run anim.apply_plan, or use psd.auto_animate to do both.",
  params: PLAN_PARAMS,
  toJsx: () => nodeOnly("psd.plan"),
  async run(args, transport) {
    const opts = planOptions(args);
    if (typeof opts === "string") return { ok: false, error: opts };
    const s = await scan(transport, args.comp, (args.scanTime as number | undefined) ?? null);
    if ("error" in s) return s;
    const p = planFromScan(s, opts);
    return {
      ok: true,
      comp: s.name,
      ...p,
      ...(args.brief ? { brief: args.brief } : {}),
      next: "anim.apply_plan { comp, plan, loops }",
    };
  },
});

registerOp({
  name: "psd.auto_animate",
  category: "psd",
  description:
    "psd.plan + anim.apply_plan in one call, for when there is no brief to read: scans the comp, assigns roles, builds the plan and applies it as ONE undo step. Pass `path` to import the PSD first (psd.import, a separate undo step). Returns the plan it used so it can be adjusted afterwards with anim.adjust / anim.apply. Check the result with anim.review and a contact sheet.",
  params: [
    ...PLAN_PARAMS.map((p) => (p.name === "comp" ? { ...p, required: false } : p)),
    {
      name: "path",
      type: "string",
      description: "PSD to import first (then comp is the imported one)",
      required: false,
    },
    {
      name: "fps",
      type: "number",
      description: "With path: frame rate (default 25)",
      required: false,
    },
    {
      name: "editableText",
      type: "boolean",
      description: "With path: convert PSD text to editable text",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("psd.auto_animate"),
  async run(args, transport) {
    const opts = planOptions(args);
    if (typeof opts === "string") return { ok: false, error: opts };
    let comp = args.comp;
    let imported: unknown = null;
    if (args.path) {
      const { getOp } = await import("../registry.js");
      const imp = getOp("psd.import")!;
      const res = await transport.execute({
        label: "psd.import",
        code: imp.toJsx({
          path: args.path,
          fps: args.fps,
          duration: args.duration ?? 10,
          editableText: args.editableText,
        }),
      });
      if (!res.ok) return { ok: false, error: res.error ?? "import failed" };
      imported = res.result;
      const r = imported as { ok: boolean; error?: string; id?: number };
      if (!r.ok) return { ok: false, error: r.error };
      comp = r.id;
    }
    if (comp === undefined || comp === null)
      return { ok: false, error: "pass comp, or path to import a PSD" };
    const r = await animateComp(
      transport,
      comp,
      opts,
      (args.scanTime as number | undefined) ?? null,
    );
    if (!r.ok) return r;
    return {
      ok: true,
      comp: r.comp,
      ...(imported ? { imported: { mode: (imported as { mode?: string }).mode } } : {}),
      style: r.plan.style,
      roles: r.plan.roles,
      plan: r.plan.plan,
      loops: r.plan.loops,
      notes: r.plan.notes,
      applied: r.applied,
      next: "anim.review { comp } and ae_render_frame with times + contactSheet to check it",
    };
  },
});

registerOp({
  name: "psd.sequence_scenes",
  category: "psd",
  description:
    "For a PSD laid out as one group per scene (Intro, Cảnh 1, Cảnh 2… imported as precomps): put the scenes back to back on the main comp — enabled, each starting where the previous ends (minus overlap), the comp duration fitted to the total. Default order is the PSD's bottom-to-top scene order; full-frame non-scene layers (e.g. 'Background') are stretched under all of them. " +
    "Then animate each scene precomp with psd.auto_animate { comp: <scene>, duration: <sceneDuration>, exit: true }.",
  params: [
    { name: "comp", type: "any", description: "The imported PSD comp", required: true },
    {
      name: "scenes",
      type: "array",
      description:
        "Scene layer names in play order (default: every precomp layer except background-like ones, bottom to top)",
      required: false,
    },
    {
      name: "sceneDuration",
      type: "number",
      description: "Seconds per scene (default 2.75)",
      required: false,
    },
    {
      name: "overlap",
      type: "number",
      description: "Seconds each scene overlaps the next (default 0)",
      required: false,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _names = ${jsxVal(args.scenes ?? null)};
            var _len = ${jsxVal(args.sceneDuration ?? 2.75)};
            var _ov = ${jsxVal(args.overlap ?? 0)};
            var _scenes = [];
            var _others = [];
            if (_names) {
                for (var _n = 0; _n < _names.length; _n++) {
                    var _f = AE.findLayerInComp(_comp, _names[_n]);
                    if (!_f) return { ok: false, error: "no scene layer named " + _names[_n] };
                    _scenes.push(_f);
                }
            } else {
                for (var _i = _comp.numLayers; _i >= 1; _i--) {
                    var _l = _comp.layer(_i);
                    var _bgLike = /^(bg|background|nen|nền)/i.test(_l.name);
                    if (_l.source instanceof CompItem && !_bgLike) _scenes.push(_l);
                }
            }
            if (!_scenes.length) return { ok: false, error: "no scene precomps found" };
            var _total = _scenes.length * _len - (_scenes.length - 1) * _ov;
            _comp.duration = Math.max(_comp.duration, _total);
            var _out = [];
            for (var _s = 0; _s < _scenes.length; _s++) {
                var _sc = _scenes[_s];
                var _t = _s * (_len - _ov);
                if (_sc.source.duration < _len) _sc.source.duration = _len;
                _sc.enabled = true;
                _sc.startTime = _t;
                _sc.inPoint = _t;
                _sc.outPoint = _t + _len;
                _out.push({ scene: _sc.name, comp: _sc.source.name, from: _t, to: _t + _len });
            }
            for (var _k = 1; _k <= _comp.numLayers; _k++) {
                var _o = _comp.layer(_k);
                var _isScene = false;
                for (var _q = 0; _q < _scenes.length; _q++) if (_scenes[_q].index === _o.index) _isScene = true;
                if (_isScene || !_o.enabled) continue;
                try { _o.inPoint = 0; _o.outPoint = _total; } catch (eO) { }
                _others.push(_o.name);
            }
            _comp.duration = _total;
            _comp.workAreaStart = 0;
            _comp.workAreaDuration = _total;
            return { ok: true, comp: _comp.name, duration: _total, scenes: _out, underlay: _others, next: "psd.auto_animate on each scene comp with duration " + _len + " and exit: true" };
        `;
  },
});

registerOp({
  name: "psd.animate_scenes",
  category: "psd",
  description:
    "One call for a multi-scene PSD (one group per scene): psd.sequence_scenes, then psd.auto_animate on every scene with its OWN composed look (seeded mix of entrances, directions, text styles, loops, exits, accents and tempo) so neither scenes nor jobs repeat one style; every scene but the last gets exits. Each scene is its own undo step, so one scene can be undone and redone alone. Returns each scene's plan.",
  params: [
    { name: "comp", type: "any", description: "The imported PSD comp", required: true },
    {
      name: "scenes",
      type: "array",
      description: "Scene layer names in play order (default: bottom to top)",
      required: false,
    },
    {
      name: "sceneDuration",
      type: "number",
      description: "Seconds per scene (default 2.75)",
      required: false,
    },
    {
      name: "style",
      type: "string",
      description: "smooth | pop | energetic (default energetic)",
      required: false,
    },
    {
      name: "keepStatic",
      type: "array",
      description: "Roles or layer names that never move, e.g. ['logo']",
      required: false,
    },
    {
      name: "seed",
      type: "number",
      description:
        "Look seed for the job (default: random, returned so a liked version can be rebuilt). Each scene derives its own look and never repeats the previous scene's hero, headline or exit",
      required: false,
    },
    {
      name: "brief",
      type: "string",
      description: "Client brief, passed to each plan",
      required: false,
    },
    {
      name: "transition",
      type: "string",
      description:
        "Between scenes: 'auto' (default: a different seeded transition per cut — push, slide_up, whip, flip, dream, zoom), one of those names for every cut, or 'none' (each scene animates its own exit instead)",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("psd.animate_scenes"),
  async run(args, transport) {
    const { getOp } = await import("../registry.js");
    const seq = await transport.execute({
      label: "psd.sequence_scenes",
      code: getOp("psd.sequence_scenes")!.toJsx(args),
    });
    if (!seq.ok) return { ok: false, error: seq.error ?? "sequence failed" };
    const sr = seq.result as {
      ok: boolean;
      error?: string;
      scenes: { scene: string; comp: string }[];
    };
    if (!sr.ok) return { ok: false, error: sr.error };
    const len = (args.sceneDuration as number | undefined) ?? 2.75;
    const seed = typeof args.seed === "number" ? args.seed : Math.floor(Math.random() * 1_000_000);
    const tmode = String(args.transition ?? "auto");
    if (tmode !== "auto" && tmode !== "none" && !SCENE_TRANSITION_TYPES.includes(tmode))
      return {
        ok: false,
        error: `transition must be auto, none or one of ${SCENE_TRANSITION_TYPES.join(", ")}`,
      };
    const withTransitions = tmode !== "none";
    const out = [];
    let prev: VariantDef | null = null;
    for (let i = 0; i < sr.scenes.length; i++) {
      const sceneSeed = seed + i * 7919;
      const opts = planOptions({
        ...args,
        style: args.style ?? "energetic",
        duration: len,
        exit: !withTransitions && i < sr.scenes.length - 1,
      });
      if (typeof opts === "string") return { ok: false, error: opts };
      opts.seed = sceneSeed;
      opts.avoid = prev;
      const r = await animateComp(transport, sr.scenes[i].comp, opts, null);
      if (!r.ok) return { ok: false, error: `scene ${sr.scenes[i].scene}: ${r.error}`, done: out };
      prev = composeVariant(sceneSeed, prev);
      out.push({
        scene: sr.scenes[i].scene,
        seed: sceneSeed,
        look: prev.label,
        notes: r.plan.notes,
        steps: r.plan.plan.length,
      });
    }
    const cuts: unknown[] = [];
    const statics = ((args.keepStatic as string[] | undefined) ?? []).map((x) => normalizeName(x));
    const pinLogo = withTransitions && statics.includes("logo");
    if (withTransitions && sr.scenes.length > 1) {
      const r = rngFor(seed + 1);
      let prevType = "";
      const plan = [];
      for (let i = 1; i < sr.scenes.length; i++) {
        let type = tmode;
        if (tmode === "auto") {
          const pool = SCENE_TRANSITION_TYPES.filter((t) => t !== prevType);
          type = pool[Math.floor(r() * pool.length)];
        }
        prevType = type;
        plan.push({
          from: sr.scenes[i - 1].scene,
          to: sr.scenes[i].scene,
          jobs: sceneTransitionJobs(type, 0),
          type,
        });
      }
      const res = await transport.execute({
        label: "psd.scene_transitions",
        code: `
            ${jsxCompPreamble({ comp: args.comp })}
            ${ANIM_FN}
            ${SCENE_TRANSITION_FN}
            var _plan = ${jsxVal(plan)};
            var _out = [];
            for (var _i = 0; _i < _plan.length; _i++) {
                var _a = AE.findLayerInComp(_comp, _plan[_i].from);
                var _b = AE.findLayerInComp(_comp, _plan[_i].to);
                if (!_a || !_b) { _out.push({ skipped: true, reason: "scene layer missing" }); continue; }
                var _tj = _plan[_i].jobs;
                var _dIn = _tj.inJob.start - _tj.outJob.start;
                _tj.outJob.start = _b.inPoint;
                _tj.inJob.start = _b.inPoint + _dIn;
                var _r = _sceneTransition(_comp, _a, _b, _tj);
                _r.type = _plan[_i].type;
                _out.push(_r);
            }
            for (var _k = 1; _k <= _comp.numLayers; _k++) if (_comp.layer(_k).outPoint > _comp.duration) _comp.duration = _comp.layer(_k).outPoint;
            // A logo kept static in every scene would ride along with each
            // transition (two logos on screen): pin one copy on the main comp
            // above the scenes and switch the scene copies off.
            var _pinned = null;
            if (${jsxVal(pinLogo)}) {
                var _scs = ${jsxVal(sr.scenes.map((x) => x.comp))};
                for (var _s = 0; _s < _scs.length; _s++) {
                    var _sc = AE.findCompByNameOrId(_scs[_s]);
                    if (!_sc) continue;
                    for (var _li = 1; _li <= _sc.numLayers; _li++) {
                        var _ly = _sc.layer(_li);
                        if (!/^\s*logo/i.test(_ly.name) || !_ly.enabled) continue;
                        if (!_pinned) {
                            _ly.copyToComp(_comp);
                            _pinned = _comp.layer(1);
                            _pinned.name = "Logo (ghim)";
                            _pinned.startTime = 0;
                            _pinned.inPoint = 0;
                            _pinned.outPoint = _comp.duration;
                        }
                        _ly.enabled = false;
                    }
                }
            }
            return { ok: true, cuts: _out, pinnedLogo: _pinned ? _pinned.name : null };
        `,
      });
      if (!res.ok) return { ok: false, error: `transitions: ${res.error}`, done: out };
      for (const c of (res.result as { cuts: { type: string; from: string; to: string }[] }).cuts)
        cuts.push({ type: c.type, from: c.from, to: c.to });
    }
    return {
      ok: true,
      seed,
      sequence: seq.result,
      scenes: out,
      transitions: cuts,
      next: "render a contact sheet of the main comp; fix single scenes with anim.adjust / anim.apply { replace: true }; a new seed gives a different look",
    };
  },
});
