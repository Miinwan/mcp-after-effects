import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type * as Fit from "../src/ease-fit.js";

import type { AeTransport, EvalRequest, EvalResult } from "../src/transport/AeTransport.js";
import { lintJsxFile } from "./helpers/lint-jsx.js";

const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const fit = await import("../src/ease-fit.js");
const { verifyRead } = await import("../src/operations/curve.js");

const tmp = mkdtempSync(path.join(os.tmpdir(), "curve-"));
let n = 0;

function assertValidJsx(jsx: string): void {
  expect(jsx).not.toContain('ok: false, error: "keyframe.');
  expect(() => new Function(jsx)).not.toThrow();
  const f = path.join(tmp, `gen${n++}.jsx`);
  writeFileSync(f, jsx);
  const errors = lintJsxFile(f).filter((x) => x.severity === "error");
  expect(errors.map((e) => `${e.rule}: ${e.text}`)).toEqual([]);
}

const reply = (result: unknown): EvalResult => ({
  ok: true,
  result,
  error: null,
  errorCode: null,
  stack: null,
  logs: [],
  durationMs: 0,
});

/** Play fitted keys back through the AE evaluator, in fractions of the move. */
function play(keys: Fit.AeKey[], ts: number[]): number[] {
  return ts.map((t) => fit.evalKeys(keys, t));
}

function grid(a: number, b: number, fps: number, sub = 4): number[] {
  const out: number[] = [];
  const nS = Math.round((b - a) * fps * sub);
  for (let i = 0; i <= nS; i++) out.push(a + i / (fps * sub));
  return out;
}

describe("ease fit (port of ease_fit.py)", () => {
  const cases: [string, number, number][] = [
    ["springElegant", 1, 0.65],
    ["springSnappy", 1.02, 0.8],
    ["outBack", 2, 0.6],
    ["outCubic", 0.5, 0.5],
    ["inOutExpo", 0.3, 0.6],
    ["gravity", 3.78, 0.53],
    ["outBounce", 1, 1],
    ["outExpo", 0, 0.4],
    ["inOutSine", 1.1, 0.7],
  ];
  for (const [name, t0, dur] of cases) {
    it(`${name}: keys on frames, within 2 % at every sub-frame`, () => {
      const f = fit.NAMED_CURVES[name];
      const r = fit.fitMove(f, t0, dur, { fps: 25 });
      expect(r.maxError).toBeLessThanOrEqual(0.02);
      for (const k of r.keys) expect(Math.abs(k.t * 25 - Math.round(k.t * 25))).toBeLessThan(1e-6);
      const [ks, ke] = fit.frameWindow(t0, dur, 25);
      expect(r.keys[0].t).toBeCloseTo(ks, 6);
      expect(r.keys[r.keys.length - 1].t).toBeCloseTo(ke, 6);
      const ts = grid(ks, ke, 25);
      const ref = ts.map((t) => (t <= t0 ? 0 : t >= t0 + dur ? 1 : f((t - t0) / dur)));
      const v = fit.compareCurves(ts, play(r.keys, ts), ref, 25);
      expect(v.maxErrorPct).toBeLessThanOrEqual(2);
      expect(v.timingErrorFrames).toBeLessThanOrEqual(1);
    });
  }

  it("spring: overshoot is a real key at the peak, and the target is crossed early", () => {
    const r = fit.fitMove(fit.NAMED_CURVES.springElegant, 0, 0.64, { fps: 25 });
    const peak = r.keys.reduce((m, k) => (k.v > m.v ? k : m));
    expect(peak.v).toBeGreaterThan(1.12);
    expect(Math.abs(peak.inSpeed)).toBeLessThan(0.5);
    // 1 - e^-5u cos 8u crosses 1 at u = pi/16 ≈ 0.2 of its settling window
    const ts = grid(0, 0.64, 25);
    const ae = play(r.keys, ts);
    const cross = ts[ae.findIndex((x) => x >= 1)];
    expect(cross / 0.64).toBeGreaterThan(0.15);
    expect(cross / 0.64).toBeLessThan(0.3);
  });

  it("a 2-key ease at the spring's duration is caught as wrong (the postmortem failure)", () => {
    const f = fit.NAMED_CURVES.springElegant;
    const keys: Fit.AeKey[] = [
      { t: 0, v: 0, outSpeed: 0, outInfluence: 15 },
      { t: 0.64, v: 1, inSpeed: 0, inInfluence: 85 },
    ];
    const ts = grid(0, 0.64, 25);
    const ref = ts.map((t) => (t >= 0.64 ? 1 : f(t / 0.64)));
    const v = fit.compareCurves(ts, play(keys, ts), ref, 25);
    expect(v.ok).toBe(false);
    expect(v.maxErrorPct).toBeGreaterThan(30);
  });

  it("fitSamples fits a sampled channel in its own units", () => {
    const times: number[] = [];
    const values: number[] = [];
    for (let i = 0; i <= 200; i++) {
      const t = 2 + i * 0.004;
      times.push(t);
      // camera punch with drift: up 40 px and back to 10 px
      const u = i / 200;
      values.push(100 + 40 * Math.sin(Math.PI * u) + 10 * u);
    }
    const r = fit.fitSamples(times, values, { fps: 30 });
    expect(r.maxError).toBeLessThanOrEqual(0.02);
    expect(r.keys[0].v).toBeCloseTo(100, 3);
    expect(r.keys.length).toBeGreaterThanOrEqual(3);
  });

  it("resolves names, cubic-bezier strings and spring objects", () => {
    expect(typeof fit.resolveCurve("outBack")).toBe("function");
    expect(typeof fit.resolveCurve("easeOutCubic")).toBe("function");
    const cb = fit.resolveCurve("cubic-bezier(0.25, 0.1, 0.25, 1)");
    expect(typeof cb).toBe("function");
    expect((cb as Fit.CurveFn)(1)).toBe(1);
    expect(typeof fit.resolveCurve({ type: "spring", damping: 6, frequency: 10 })).toBe("function");
    expect(fit.resolveCurve("wobble")).toMatch(/unknown curve/);
    expect(fit.resolveCurve({ type: "spring", damping: -1 })).toMatch(/damping/);
  });

  it("AE evaluator: linear and hold sides", () => {
    const keys: Fit.AeKey[] = [
      { t: 0, v: 0, outType: "linear" },
      { t: 1, v: 10, inType: "linear", outType: "hold" },
      { t: 2, v: 20, inType: "linear" },
    ];
    expect(fit.evalKeys(keys, 0.5)).toBeCloseTo(5, 6);
    expect(fit.evalKeys(keys, 1.5)).toBe(10);
  });
});

describe("keyframe.fit_curve", () => {
  const op = getOp("keyframe.fit_curve")!;
  const args = {
    comp: "Main",
    layer: "Logo",
    property: ["Transform", "Scale"],
    curve: "springElegant",
    t0: 1,
    dur: 0.65,
    from: [0, 0],
    to: [100, 100],
    fps: 25,
  };

  it("is registered and mutating", () => {
    expect(op).toBeDefined();
    expect(op.readOnly).not.toBe(true);
  });

  it("generates ES3-clean JSX that refuses hold-only properties", () => {
    const jsx = op.toJsx(args);
    assertValidJsx(jsx);
    expect(jsx).toContain("isInterpolationTypeValid");
    expect(jsx).toContain("AE.applyKeySpecs");
  });

  it("samples mode also generates valid JSX", () => {
    const times = Array.from({ length: 60 }, (_, i) => i / 100);
    const values = times.map((t) => 50 * Math.sin(t * 6));
    assertValidJsx(op.toJsx({ ...args, curve: undefined, samples: { times, values } }));
  });

  it("rejects bad input before AE is contacted", () => {
    expect(op.toJsx({ ...args, curve: "nope" })).toContain("unknown curve");
    expect(op.toJsx({ ...args, to: undefined })).toContain("to (number");
    expect(op.toJsx({ ...args, samples: { times: [0, 1], values: [0, 1] } })).toContain(
      "exactly one",
    );
    expect(op.toJsx({ ...args, fps: undefined })).toContain("pass fps");
  });

  it("dryRun with fps never calls AE and reports keys + error", async () => {
    const calls: EvalRequest[] = [];
    const t: AeTransport = {
      async execute(req) {
        calls.push(req);
        return reply(null);
      },
    };
    const r = (await op.run!({ ...args, dryRun: true }, t)) as {
      ok: boolean;
      maxErrorPct: number;
      keys: { frame: number }[];
    };
    expect(calls).toHaveLength(0);
    expect(r.ok).toBe(true);
    expect(r.maxErrorPct).toBeLessThanOrEqual(2);
    expect(r.keys[0].frame).toBe(25);
  });

  it("without fps: reads the comp rate ungrouped, then writes in one undo group", async () => {
    const calls: EvalRequest[] = [];
    const t: AeTransport = {
      async execute(req) {
        calls.push(req);
        if (calls.length === 1) return reply({ ok: true, fps: 30 });
        return reply({ ok: true, layers: [{ ok: true, keys: 4 }], warnings: [] });
      },
    };
    const r = (await op.run!({ ...args, fps: undefined }, t)) as { ok: boolean; fps: number };
    expect(calls).toHaveLength(2);
    expect(calls[0].undoGroup).toBe(false);
    expect(calls[1].undoGroup).not.toBe(false);
    expect(r.ok).toBe(true);
    expect(r.fps).toBe(30);
    expect(calls[1].code).toContain('"fps":30');
  });
});

describe("keyframe.verify_curve", () => {
  const op = getOp("keyframe.verify_curve")!;

  it("is read-only and Node-side", () => {
    expect(op.readOnly).toBe(true);
    expect(op.toJsx({})).toContain("cannot be used inside batch.run");
  });

  /** A fake AE that plays the given 2-D keys (values in px) at the requested times. */
  function fakeAe(keys: Fit.AeKey[], from: number[], to: number[]): AeTransport {
    return {
      async execute(req) {
        const job = JSON.parse(/var _job = (\{.*?\});/.exec(req.code)![1]);
        const fps = job.fps ?? 25;
        const ks = Math.floor(job.t0 * fps + 1e-6) / fps;
        const ke = Math.ceil((job.t0 + job.dur) * fps - 1e-6) / fps;
        const times = grid(ks, ke, fps, job.sub);
        const values = times.map((x) => {
          const u = fit.evalKeys(keys, x);
          return from.map((a, i) => a + (to[i] - a) * u);
        });
        return reply({ ok: true, fps, ks, ke, times, values, from, to, keys: [] });
      },
    };
  }

  const base = {
    comp: "Main",
    layer: 1,
    property: ["Transform", "Position"],
    curve: "outBack",
    t0: 1,
    dur: 0.6,
  };

  it("passes keys written by fit_curve", async () => {
    const r = fit.fitMove(fit.NAMED_CURVES.outBack, 1, 0.6, { fps: 25 });
    const v = (await op.run!(base, fakeAe(r.keys, [100, 500], [900, 500]))) as {
      ok: boolean;
      maxErrorPct: number;
    };
    expect(v.ok).toBe(true);
    expect(v.maxErrorPct).toBeLessThan(1);
  });

  it("fails a hand-made 2-key ease and names the frame", async () => {
    const keys: Fit.AeKey[] = [
      { t: 1, v: 0, outSpeed: 0, outInfluence: 15 },
      { t: 1.6, v: 1, inSpeed: 0, inInfluence: 85 },
    ];
    const v = (await op.run!(base, fakeAe(keys, [100, 500], [900, 500]))) as {
      ok: boolean;
      maxErrorPct: number;
      worstFrame: number;
      hint: string;
    };
    expect(v.ok).toBe(false);
    expect(v.maxErrorPct).toBeGreaterThan(2);
    expect(v.worstFrame).toBeGreaterThanOrEqual(25);
    expect(v.hint).toMatch(/fit_curve/);
  });

  it("verifyRead measures perpendicular drift too", () => {
    const ts = grid(0, 1, 25);
    const src = { mode: "curve" as const, f: fit.NAMED_CURVES.linear, t0: 0, dur: 1 };
    const values = ts.map((t) => [t * 100, 5]);
    const v = verifyRead(
      { ok: true, fps: 25, ks: 0, ke: 1, times: ts, values, from: [0, 0], to: [100, 0], keys: [] },
      src,
      2,
      1,
    );
    expect(v.maxErrorPct).toBeCloseTo(5, 1);
    expect(v.ok).toBe(false);
  });
});
