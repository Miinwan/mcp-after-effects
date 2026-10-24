// Phase-2 presets with an overshoot or a bounce must reproduce the physical
// curve they stand for within 2 % of the move (keys fitted, not guessed),
// entrances and their mirrored exits alike.

import { describe, expect, it } from "vitest";

import type * as Fit from "../src/ease-fit.js";

process.env.AE_MCP_BRAND_DIR ??= "/tmp/nonexistent-brand-dir";
const motion = await import("../src/operations/motion.js");
const fit = await import("../src/ease-fit.js");

interface K {
  t: number;
  v: number | number[];
  i: number;
  o: number;
  si?: number | number[];
  so?: number | number[];
}

const at = (x: number | number[] | undefined, d: number) =>
  x === undefined ? 0 : Array.isArray(x) ? x[d] : x;

/** Largest error of a preset track vs ref(u), % of the track's range. */
function trackError(keys: K[], d: number, ref: (u: number) => number): number {
  const ak: Fit.AeKey[] = keys.map((k) => ({
    t: k.t,
    v: at(k.v, d),
    inSpeed: at(k.si, d),
    outSpeed: at(k.so, d),
    inInfluence: k.i,
    outInfluence: k.o,
  }));
  let e = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = 0; j <= 800; j++) {
    const u = j / 800;
    const r = ref(u);
    lo = Math.min(lo, r);
    hi = Math.max(hi, r);
    e = Math.max(e, Math.abs(fit.evalKeys(ak, u) - r));
  }
  return (e / (hi - lo)) * 100;
}

function track(preset: string, prop: string, opts = {}): K[] {
  const job = motion.presetJob(preset, opts);
  const tr = job.tracks.find((t) => t.prop === prop);
  expect(tr, `${preset} ${prop}`).toBeDefined();
  return tr!.keys as K[];
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f;
const sp68 = fit.spring(6, 8);
const sw = fit.spring(2.5, 11);
const CASES: [string, string, number, (u: number) => number, object?][] = [
  ["pop", "scale", 0, fit.backWithPeak(1.1)],
  ["pop", "scale", 0, fit.backWithPeak(1.25), { overshoot: 0.25 }],
  ["slide", "position", 0, (u) => 1 - fit.backWithPeak(1.15)(u), { overshoot: 0.15 }],
  ["rise", "position", 0, (u) => 1 - fit.backWithPeak(1.1)(u), { overshoot: 0.1 }],
  ["drop", "position", 0, (u) => 1 - fit.gravityHop(0.12)(u)],
  ["flip", "rotateY", 0, (u) => lerp(-90, 0, fit.backWithPeak(1 + 8 / 90)(u))],
  ["stretch", "scale", 0, (u) => lerp(1.6, 1, sp68(u))],
  ["stretch", "scale", 1, (u) => lerp(0.15, 1, sp68(u))],
  ["swing", "rotation", 0, (u) => lerp(-14, 0, sw(u))],
];

describe("phase-2 presets match their physical curve", () => {
  for (const [name, prop, d, ref, opts] of CASES) {
    const tag = `${name} ${prop}[${d}]${opts ? " " + JSON.stringify(opts) : ""}`;
    it(`${tag}: entrance within 2 %`, () => {
      expect(trackError(track(`${name}_in`, prop, opts), d, ref)).toBeLessThanOrEqual(2);
    });
    it(`${tag}: exit (mirrored) within 2 %`, () => {
      expect(
        trackError(track(`${name}_out`, prop, opts), d, (u) => ref(1 - u)),
      ).toBeLessThanOrEqual(2);
    });
  }

  it("overshoots are real keys at the turning points", () => {
    const pop = track("pop_in", "scale");
    const peak = pop.reduce((m, k) => (at(k.v, 0) > at(m.v, 0) ? k : m));
    expect(at(peak.v, 0)).toBeCloseTo(1.1, 2);
    expect(Math.abs(at(peak.si, 0))).toBeLessThan(0.05);
    const swing = track("swing_in", "rotation");
    expect(swing.length).toBeGreaterThanOrEqual(5);
  });

  it("the drop hits the floor with speed (a cusp, not an ease)", () => {
    const drop = track("drop_in", "position");
    const impact = drop.find((k) => Math.abs(at(k.v, 0)) < 0.01 && k.t > 0 && k.t < 1);
    expect(impact).toBeDefined();
    expect(Math.abs(at(impact!.si, 0))).toBeGreaterThan(1);
  });
});
