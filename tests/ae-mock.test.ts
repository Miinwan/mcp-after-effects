// The offline AE mock (tests/helpers/ae-mock.ts): first prove each rule
// reproduces what After Effects 26.5 does (measured 24/10/2026), then run the
// operations' real generated JSX — through their own run() where they have
// one — against it.

import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { AeTransport } from "../src/transport/AeTransport.js";
import { createAeMock, VERIFIED_MATCHNAMES, type AeMock } from "./helpers/ae-mock.js";

process.env.AE_MCP_BRAND_DIR ??= mkdtempSync(path.join(os.tmpdir(), "brand-"));
const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const motion = await import("../src/operations/motion.js");
const textMotion = await import("../src/operations/text-motion.js");
const fit = await import("../src/ease-fit.js");

let ae: AeMock;
beforeEach(() => {
  ae = createAeMock();
  const c = ae.addComp("Main", 1920, 1080, 10, 25);
  (c.layers.addSolid as (c: number[], n: string) => unknown)([1, 0, 0], "Box");
});

/** A transport that executes requests inside the mock. */
function mockTransport(mock: AeMock): AeTransport {
  return {
    async execute(req) {
      const r = mock.run(req.code);
      if (r.error && r.result === null)
        return {
          ok: false,
          result: null,
          error: r.error,
          errorCode: "JSX_THROW",
          stack: null,
          logs: [],
          durationMs: 0,
        };
      return {
        ok: true,
        result: r.result,
        error: null,
        errorCode: null,
        stack: null,
        logs: [],
        durationMs: 0,
      };
    },
  };
}

/** Run an operation the way ae_do does: run() when it has one, else its JSX. */
async function op(name: string, args: Record<string, unknown>) {
  const o = getOp(name)!;
  expect(o, name).toBeDefined();
  if (o.run) {
    const before = ae.issues.length;
    const result = (await o.run(args, mockTransport(ae))) as Record<string, unknown>;
    return {
      ok: result.ok !== false,
      result,
      error: (result.error as string) ?? null,
      issues: ae.issues.slice(before),
    };
  }
  const r = ae.run(o.toJsx(args));
  return { ...r, result: r.result as Record<string, unknown> };
}

const L = `var c = AE.findCompByNameOrId("Main"); var l = c.layer("Box");`;

describe("AE mock reproduces After Effects 26.5", () => {
  it("a name AE does not have reads as null, never invented", () => {
    const r = ae.run(`${L} var tg = l.property("ADBE Transform Group");
      return { bad: tg.property("ADBE Mask Expansion") === null, byName: tg.property("Scale") !== null, deep: l.property("Effects").property("Nope") === null };`);
    expect(r.result).toEqual({ bad: true, byName: true, deep: true });
  });

  it("addProperty with an unverified matchName is refused (AE can crash on it)", () => {
    const r = ae.run(`var l = AE.findCompByNameOrId("Main").layers.addShape();
      l.property("ADBE Root Vectors Group").addProperty("ADBE Vector Filter - Wiggle Transform"); return 1;`);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/CRASH/);
    const v = ae.run(
      `${L} return l.property("ADBE Effect Parade").canAddProperty("ADBE Vignette");`,
    );
    expect(v.result).toBe(false);
  });

  it("shape Contents: canAddProperty says yes to any made-up 'ADBE Vector Filter - …' (the crash trap)", () => {
    const r =
      ae.run(`var g = AE.findCompByNameOrId("Main").layers.addShape().property("ADBE Root Vectors Group");
      return { bogus: g.canAddProperty("ADBE Vector Filter - Bogus"), plain: g.canAddProperty("Bogus") };`);
    expect(r.result).toEqual({ bogus: true, plain: false });
  });

  it("adding an effect kills handles to the other effects and their params, not Transform", () => {
    const r = ae.run(`${L} var out = {};
      var pos = l.property("ADBE Transform Group").property("ADBE Position");
      var fx = l.property("ADBE Effect Parade");
      var e1 = fx.addProperty("ADBE Slider Control"); var s1 = e1.property(1);
      var e2 = fx.addProperty("ADBE Slider Control");
      out.secondName = e2.name;
      try { pos.setValue([10, 10]); out.transform = "valid"; } catch (a) { out.transform = a.message; }
      try { s1.setValue(5); out.param = "valid"; } catch (b) { out.param = "invalid"; }
      try { e1.name = "x"; out.other = "valid"; } catch (d) { out.other = "invalid"; }
      try { e2.name = "y"; out.added = "valid"; } catch (f) { out.added = "invalid"; }
      var e3 = fx.property(2); e3.moveTo(1);
      try { e3.name = "z"; out.moved = "valid"; } catch (g) { out.moved = "invalid"; }
      return out;`);
    expect(r.result).toEqual({
      transform: "valid",
      param: "invalid",
      other: "invalid",
      added: "valid",
      secondName: "Slider Control 2",
      moved: "invalid",
    });
  });

  it("hold-only properties take no bezier, no linear and no ease", () => {
    const r =
      ae.run(`${L} var cb = l.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control").property(1);
      var out = { bez: cb.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER), lin: cb.isInterpolationTypeValid(KeyframeInterpolationType.LINEAR) };
      cb.setValueAtTime(0, 1);
      try { cb.setInterpolationTypeAtKey(1, KeyframeInterpolationType.BEZIER); out.set = "ok"; } catch (a) { out.set = a.message; }
      try { cb.setTemporalEaseAtKey(1, [new KeyframeEase(0, 33)], [new KeyframeEase(0, 33)]); out.ease = "ok"; } catch (b) { out.ease = b.message; }
      return out;`);
    const o = r.result as Record<string, unknown>;
    expect(o.bez).toBe(false);
    expect(o.lin).toBe(false);
    expect(o.set).toMatch(/Invalid interpolation type/);
    expect(o.ease).toMatch(/BEZIER interpolation required/);
    const types = (VERIFIED_MATCHNAMES.effects["ADBE Dropdown Control"]?.params ?? []).filter(
      (p) => p.hold,
    );
    expect(types.length).toBeGreaterThan(0);
  });

  it("Scale wants three eases even on a 2D layer; influence 0 throws at construction", () => {
    const r = ae.run(`${L} var sc = l.property("ADBE Transform Group").property("ADBE Scale");
      sc.setValueAtTime(0, [10, 10]); sc.setValueAtTime(1, [100, 100]);
      var k = new KeyframeEase(0, 50), out = { len: sc.value.length };
      try { sc.setTemporalEaseAtKey(1, [k, k], [k, k]); out.two = "ok"; } catch (a) { out.two = "throws"; }
      try { sc.setTemporalEaseAtKey(1, [k, k, k], [k, k, k]); out.three = "ok"; } catch (b) { out.three = "throws"; }
      try { new KeyframeEase(0, 0); out.zero = "ok"; } catch (d) { out.zero = "throws"; }
      return out;`);
    expect(r.result).toEqual({ len: 3, two: "throws", three: "ok", zero: "throws" });
  });

  it("setValue on keys, a separated leader and a 2D layer's Z follower all throw", () => {
    const r = ae.run(`${L} var tg = l.property("ADBE Transform Group"), out = {};
      var op = tg.property("ADBE Opacity"); op.setValueAtTime(0, 0);
      try { op.setValue(50); out.keyed = "ok"; } catch (a) { out.keyed = "throws"; }
      tg.property("ADBE Position").dimensionsSeparated = true;
      try { tg.property("ADBE Position").setValue([1, 1]); out.leader = "ok"; } catch (b) { out.leader = "throws"; }
      try { tg.property("ADBE Position_2").setValue(5); out.z = "ok"; } catch (d) { out.z = "throws"; }
      tg.property("ADBE Position_0").setValue(42); out.x = tg.property("ADBE Position_0").value;
      return out;`);
    expect(r.result).toEqual({ keyed: "throws", leader: "throws", z: "throws", x: 42 });
  });

  it("two keys inside one frame are accepted silently, so the mock reports them", () => {
    const r = ae.run(`${L} var op = l.property("ADBE Transform Group").property("ADBE Opacity");
      op.setValueAtTime(0.5, 10); op.setValueAtTime(0.51, 20); op.setValueAtTime(0.5, 30); return op.numKeys;`);
    expect(r.result).toBe(2);
    expect(r.issues.join("\n")).toMatch(/two keys in one frame/);
  });

  it("flags beginUndoGroup in operation code and effects that open a dialog", () => {
    const r = ae.run(`app.beginUndoGroup("x"); app.endUndoGroup();
      var l = AE.findCompByNameOrId("Main").layer("Box"); l.property("ADBE Effect Parade").addProperty("ADBE Apply Color LUT2"); return 1;`);
    expect(r.issues.join("\n")).toMatch(/beginUndoGroup/);
    expect(r.issues.join("\n")).toMatch(/Choose LUT File/);
  });
});

describe("operations run clean against the mock", () => {
  it("keyframe.apply writes eased Scale keys with three eases", async () => {
    const r = await op("keyframe.apply", {
      comp: "Main",
      layer: "Box",
      property: ["Transform", "Scale"],
      keys: [
        { time: 0, value: [0, 0], interp: "ease", outInfluence: 15 },
        { time: 1, value: [100, 100], interp: "ease", inInfluence: 85 },
      ],
    });
    expect(r.error).toBeNull();
    expect(r.issues).toEqual([]);
    const p = ae.prop("Main", "Box", ["ADBE Transform Group", "ADBE Scale"]);
    expect(p.numKeys).toBe(2);
    expect(p.keys[0].outE.length).toBe(3);
  });

  for (const [prop, curve, from, to] of [
    [["Transform", "Scale"], "springElegant", [0, 0], [100, 100]],
    [["Transform", "Rotation"], "outBounce", 0, 180],
    [["Transform", "Position"], "outBack", [200, 540], [1500, 700]],
    [["Transform", "Opacity"], "inOutSine", 0, 100],
  ] as const) {
    it(`keyframe.fit_curve then verify_curve: ${prop[1]} ${curve}`, async () => {
      const args = { comp: "Main", layer: "Box", property: prop, curve, t0: 1, dur: 0.7, from, to };
      const w = await op("keyframe.fit_curve", args);
      expect(w.error).toBeNull();
      expect(w.issues).toEqual([]);
      const v = await op("keyframe.verify_curve", args);
      expect(v.result.ok, JSON.stringify(v.result)).toBe(true);
      expect(v.result.maxErrorPct as number).toBeLessThan(2);
    });
  }

  it("keyframe.fit_curve on separated Position writes per-axis speeds", async () => {
    ae.run(
      `${L} l.property("ADBE Transform Group").property("ADBE Position").dimensionsSeparated = true; return 1;`,
    );
    const args = {
      comp: "Main",
      layer: "Box",
      property: ["Transform", "Position"],
      curve: "springSnappy",
      t0: 0.5,
      dur: 0.8,
      from: [300, 300],
      to: [1600, 800],
    };
    const w = await op("keyframe.fit_curve", args);
    expect(w.error).toBeNull();
    const y = ae.prop("Main", "Box", ["ADBE Transform Group", "ADBE Position_1"]);
    expect(y.numKeys).toBeGreaterThan(3);
    expect(Math.abs(y.keys[1].inE[0].speed)).toBeGreaterThan(0);
    const v = await op("keyframe.verify_curve", args);
    expect(v.result.ok).toBe(true);
  });

  it("keyframe.fit_curve refuses a checkbox instead of throwing inside AE", async () => {
    ae.run(`${L} l.property("ADBE Effect Parade").addProperty("ADBE Checkbox Control"); return 1;`);
    const r = await op("keyframe.fit_curve", {
      comp: "Main",
      layer: "Box",
      property: ["Effects", "Checkbox Control", "Checkbox"],
      curve: "outCubic",
      t0: 0,
      dur: 1,
      from: 0,
      to: 1,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.result)).toMatch(/only takes HOLD keys/);
  });

  for (const preset of motion.ALL_PRESETS) {
    it(`anim.apply ${preset}`, async () => {
      const r = await op("anim.apply", { comp: "Main", layers: "Box", preset, start: 1 });
      expect(r.error, JSON.stringify(r.result)).toBeNull();
      expect(r.issues).toEqual([]);
      const lay = (r.result as { layers?: { skipped?: boolean; reason?: string }[] }).layers?.[0];
      expect(lay?.skipped, lay?.reason).not.toBe(true);
    });
  }

  it("anim.apply blur then wipe on one layer: effects added, nothing stale", async () => {
    for (const preset of ["blur_in", "wipe_out", "zoom_blur_in"]) {
      const r = await op("anim.apply", {
        comp: "Main",
        layers: "Box",
        preset,
        replace: true,
        start: preset === "wipe_out" ? 5 : 1,
      });
      expect(r.error, preset).toBeNull();
    }
    const fx = ae.prop("Main", "Box", ["ADBE Effect Parade"]);
    expect(fx.children.map((c) => c.matchName).sort()).toEqual([
      "ADBE Box Blur2",
      "ADBE Linear Wipe",
    ]);
  });

  it("fitted presets land on the physical curve in the mock too (pop_in)", async () => {
    await op("anim.apply", {
      comp: "Main",
      layers: "Box",
      preset: "pop_in",
      start: 1,
      duration: 0.6,
    });
    const p = ae.prop("Main", "Box", ["ADBE Transform Group", "ADBE Scale"]);
    const ref = fit.backWithPeak(1.1);
    let e = 0;
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const v = (p.valueAt(1 + u * 0.6) as number[])[0];
      e = Math.max(e, Math.abs(v / 100 - ref(u)));
    }
    expect(e * 100).toBeLessThan(2);
  });

  it("keyframe.set_easing and effect.add + property.set", async () => {
    ae.run(
      `${L} var o = l.property("ADBE Transform Group").property("ADBE Opacity"); o.setValueAtTime(0, 0); o.setValueAtTime(1, 100); return 1;`,
    );
    const e = await op("keyframe.set_easing", {
      comp: "Main",
      layer: "Box",
      property: ["Transform", "Opacity"],
      keyIndex: 2,
      preset: "easeIn",
    });
    expect(e.error).toBeNull();
    const a = await op("effect.add", {
      comp: "Main",
      layer: "Box",
      matchName: "ADBE Slider Control",
      name: "Amount",
    });
    expect(a.error).toBeNull();
    const s = await op("property.set", {
      comp: "Main",
      layer: "Box",
      property: ["Effects", "Amount", "Slider"],
      value: 12,
    });
    expect(s.error).toBeNull();
    expect(
      ae.prop("Main", "Box", ["ADBE Effect Parade", "Amount", "ADBE Slider Control-0001"])._value,
    ).toBe(12);
  });

  it("property.add refuses a made-up shape item instead of crashing AE, accepts a real one", async () => {
    ae.run(`AE.findCompByNameOrId("Main").layers.addShape().name = "Shp"; return 1;`);
    const bad = await op("property.add", {
      comp: "Main",
      layer: "Shp",
      property: ["Contents"],
      matchName: "ADBE Vector Filter - Wiggle Transform",
    });
    expect(bad.ok).toBe(false);
    expect(String(bad.result && (bad.result as { error?: string }).error)).toMatch(
      /would crash AE/,
    );
    const good = await op("property.add", {
      comp: "Main",
      layer: "Shp",
      property: ["Contents"],
      matchName: "ADBE Vector Filter - Wiggler",
    });
    expect(good.error).toBeNull();
  });

  it("effect.add refuses Apply Color LUT before AE is asked (it opens a file picker)", async () => {
    const r = await op("effect.add", {
      comp: "Main",
      layer: "Box",
      matchName: "ADBE Apply Color LUT2",
    });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Choose LUT File/);
    expect(r.issues).toEqual([]);
  });

  it("effect.add refuses a matchName that is not real", async () => {
    const r = await op("effect.add", { comp: "Main", layer: "Box", matchName: "ADBE Vignette" });
    expect(r.ok).toBe(false);
  });

  for (const preset of textMotion.ALL_TEXT_PRESETS) {
    it(`text.animate ${preset}`, async () => {
      ae.run(`AE.findCompByNameOrId("Main").layers.addText("Xin chào"); return 1;`);
      const r = await op("text.animate", { comp: "Main", layers: 1, preset });
      expect(r.error, JSON.stringify(r.result)).toBeNull();
      expect(r.issues).toEqual([]);
    });
  }
});
