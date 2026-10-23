import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { lintJsxFile } from "./helpers/lint-jsx.js";

process.env.AE_MCP_BRAND_DIR = mkdtempSync(path.join(os.tmpdir(), "brand-"));

const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const motion = await import("../src/operations/motion.js");

const tmp = mkdtempSync(path.join(os.tmpdir(), "motion-"));
let n = 0;

/** Generated body must parse as a function and pass the ES3 lint. */
function assertValidJsx(jsx: string): void {
  expect(jsx).not.toContain('ok: false, error: "unknown');
  expect(() => new Function(jsx)).not.toThrow();
  const f = path.join(tmp, `gen${n++}.jsx`);
  writeFileSync(f, jsx);
  const errors = lintJsxFile(f).filter((x) => x.severity === "error");
  expect(errors.map((e) => `${e.rule}: ${e.text}`)).toEqual([]);
}

describe("motion presets", () => {
  it("registers the motion ops", () => {
    for (const name of [
      "anim.apply",
      "anim.loop",
      "anim.apply_plan",
      "expression.apply_preset",
      "template.lower_third",
      "template.title_card",
      "template.logo_reveal",
      "template.transition",
    ]) {
      expect(getOp(name), name).toBeDefined();
    }
  });

  it("covers every preset the brief lists", () => {
    for (const p of [
      "fade_in",
      "rise_in",
      "slide_in",
      "scale_in",
      "pop_in",
      "drop_in",
      "rotate_in",
      "blur_in",
      "wipe_in",
      "stretch_in",
      "pulse",
      "shake",
      "nudge",
    ]) {
      expect(motion.ALL_PRESETS).toContain(p);
    }
    expect(motion.EXIT_PRESETS).toContain("pop_out");
  });

  it.each(motion.ALL_PRESETS)("anim.apply %s generates valid ES3", (preset) => {
    const jsx = getOp("anim.apply")!.toJsx({
      comp: "Main",
      layers: ["Title", 2],
      preset,
      stagger: 0.1,
      direction: "up",
    });
    assertValidJsx(jsx);
  });

  it("entrance eases: leaving key 15, landing key 85", () => {
    const job = motion.presetJob("fade_in");
    const [k0, k1] = job.tracks[0].keys;
    expect(k0.o).toBe(15);
    expect(k1.i).toBe(85);
  });

  it("exit is the entrance mirrored with swapped eases", () => {
    const inn = motion.presetJob("pop_in");
    const out = motion.presetJob("pop_out");
    const a = inn.tracks[0].keys;
    const b = out.tracks[0].keys;
    expect(b.map((k) => k.t)).toEqual(a.map((k) => 1 - k.t).reverse());
    expect(b[0].o).toBe(a[a.length - 1].i);
    expect(b[b.length - 1].v).toEqual([0, 0]);
    expect(out.kind).toBe("out");
  });

  it("pop overshoots to 110 % by default and honours overshoot", () => {
    expect(motion.presetJob("pop_in").tracks[0].keys[1].v).toEqual([1.1, 1.1]);
    expect(motion.presetJob("pop_in", { overshoot: 0.2 }).tracks[0].keys[1].v).toEqual([1.2, 1.2]);
  });

  it("slide only overshoots when asked", () => {
    expect(motion.presetJob("slide_in").tracks[0].keys).toHaveLength(2);
    expect(motion.presetJob("slide_in", { overshoot: 0.1 }).tracks[0].keys).toHaveLength(3);
  });

  it("blur distance rescales the radius", () => {
    const job = motion.presetJob("blur_in", { distance: 80 });
    expect(job.tracks[0].keys[0].v).toBe(80);
    expect(job.distance).toBeNull();
  });

  it("rejects unknown presets and bad input before touching AE", () => {
    expect(getOp("anim.apply")!.toJsx({ comp: "C", layers: 1, preset: "explode_in" })).toContain(
      "unknown preset",
    );
    expect(
      getOp("anim.apply")!.toJsx({
        comp: "C",
        layers: 1,
        preset: "slide_in",
        direction: "diagonal",
      }),
    ).toContain("direction must be");
    expect(() => motion.presetJob("fade_in", { duration: 0 })).toThrow(/duration/);
  });

  it("arguments reach the JSX only as JSON literals", () => {
    const jsx = getOp("anim.apply")!.toJsx({
      comp: 'x"); alert(1); ("',
      layers: 'a"b',
      preset: "fade_in",
    });
    expect(jsx).toContain(JSON.stringify('x"); alert(1); ("'));
    assertValidJsx(jsx);
  });
});

describe("loops and expression presets", () => {
  it.each([...motion.LOOP_TYPES])("anim.loop %s is additive and seeded", (type) => {
    const job = motion.loopJob(type);
    expect(job.exprArr).toContain("__SA__");
    expect(job.exprArr).toContain("__SEED__");
    expect(job.exprArr).toMatch(/value/);
    const expr = job.exprArr.replace("__SA__", "0.6").replace("__SEED__", "3");
    expect(
      () =>
        new Function("value", "time", "thisComp", "ease", "seedRandom", "random", "wiggle", expr),
    ).not.toThrow();
    assertValidJsx(getOp("anim.loop")!.toJsx({ comp: "Main", layers: "all", type }));
  });

  it("float targets Y only (axis 1) for separated position", () => {
    const job = motion.loopJob("float", { amplitude: 12 });
    expect(job.axis).toBe(1);
    expect(job.exprScalar).toContain("value + off");
    expect(job.controls[0]).toMatchObject({
      name: "Trôi · biên độ (px)",
      value: 12,
      explicit: true,
    });
    expect(job.exprArr).toContain('effect("Trôi · biên độ (px)")');
  });

  it("loop sliders keep hand-set values unless a value is passed", () => {
    const job = motion.loopJob("pulse");
    expect(job.controls.every((c) => !c.explicit)).toBe(true);
    expect(motion.loopJob("pulse", { amplitude: 0.1 }).controls[0].value).toBe(10);
    expect(motion.loopJob("spin").controls).toHaveLength(1);
  });

  it.each([...motion.EXPRESSION_PRESETS])(
    "expression preset %s parses and is render-stable",
    (preset) => {
      const { expr } = motion.expressionPreset(preset);
      expect(expr).not.toMatch(/new Date|Date\(/);
      expect(() => new Function(expr)).not.toThrow();
      assertValidJsx(
        getOp("expression.apply_preset")!.toJsx({
          comp: "Main",
          layers: 1,
          preset,
          property: "position",
        }),
      );
    },
  );

  it("bounce_back is the real name (no 'bounce' alias)", () => {
    expect(() => motion.expressionPreset("bounce")).toThrow(/unknown/);
  });

  it("speed_control adds its slider", () => {
    const r = motion.expressionPreset("speed_control", { controlName: "Tốc độ", speed: 50 });
    expect(r.controls).toEqual([{ name: "Tốc độ", value: 50, fallback: 100, explicit: true }]);
    expect(r.expr).toContain('effect("Tốc độ")');
  });

  it("rejects non-numeric params", () => {
    expect(() => motion.expressionPreset("wiggle", { frequency: "2; app.quit()" })).toThrow(
      /number/,
    );
  });
});

describe("anim.apply_plan", () => {
  const plan = [
    { layer: "BG", preset: "fade_in", start: 0, duration: 1 },
    { layer: "Title", preset: "rise_in", start: 0.4 },
    { layer: ["Sao 1", "Sao 2"], preset: "pop_in", start: 1 },
  ];

  it("validates every step with its index", () => {
    expect(() => motion.resolvePlan([{ layer: "A", preset: "nope" }])).toThrow(/plan\[0\]/);
    expect(() =>
      motion.resolvePlan([{ layer: "A", preset: "fade_in" }], [{ layer: "A", type: "zoom" }]),
    ).toThrow(/loops\[0\]/);
    expect(getOp("anim.apply_plan")!.toJsx({ comp: "C", plan: [{ preset: "fade_in" }] })).toContain(
      "needs layer",
    );
  });

  it("generates one valid body for the whole plan", () => {
    const jsx = getOp("anim.apply_plan")!.toJsx({
      comp: "Main",
      plan,
      loops: [{ layer: "Sao 1", type: "float" }],
    });
    assertValidJsx(jsx);
    expect(jsx).toContain("Sao 2");
  });
});

describe("templates", () => {
  it("brand colours and fonts flow into the template", async () => {
    await getOp("brand.save")!.run!(
      {
        name: "Acme Test",
        colors: { primary: "#B6006B", accent: "#FFFFFF", text: "#FFFFFF" },
        fonts: { heading: "SVN-Gilroy-Bold" },
      },
      {} as never,
    );
    const jsx = getOp("template.lower_third")!.toJsx({
      comp: "Main",
      title: "Siêu lễ hội",
      subtitle: "Tầng 3",
      brand: "Acme Test",
    });
    expect(jsx).toContain("SVN-Gilroy-Bold");
    expect(jsx).toContain("Siêu lễ hội");
    assertValidJsx(jsx);
    expect(
      getOp("template.lower_third")!.toJsx({ comp: "Main", title: "x", brand: "Không có" }),
    ).toContain("no brand kit");
  });

  it.each(["smooth", "pop", "energetic"])("title_card %s is valid", (style) => {
    assertValidJsx(
      getOp("template.title_card")!.toJsx({
        comp: "Main",
        title: "Khai trương",
        subtitle: "20.10",
        style,
        background: true,
      }),
    );
  });

  it.each(["pop", "blur", "particle"])("logo_reveal %s is valid", (style) => {
    const jsx = getOp("template.logo_reveal")!.toJsx({
      comp: "Main",
      logo: "/tmp/logo.png",
      style,
    });
    assertValidJsx(jsx);
    if (style === "particle") {
      // Grow Bounds must be added before Scatterize.
      expect(jsx.indexOf("ADBE GROW BOUNDS")).toBeLessThan(
        jsx.indexOf('addProperty("CC Scatterize")'),
      );
    }
  });

  it.each(["flash", "wipe", "circle", "slide_panels"])(
    "transition %s needs a cut time and is valid",
    (type) => {
      expect(getOp("template.transition")!.toJsx({ comp: "Main", type })).toContain("start");
      assertValidJsx(getOp("template.transition")!.toJsx({ comp: "Main", type, start: 2 }));
    },
  );
});

describe("editing existing animation", () => {
  it.each([
    [
      "anim.adjust",
      { comp: "Main", layers: ["A", "B"], duration: 0.8, stagger: 0.1, inInfluence: 80 },
    ],
    ["anim.adjust", { comp: "Main", window: [1, 2], shift: -0.2, ripple: true }],
    ["anim.review", { comp: "Main" }],
    ["anim.polish", { comp: "Main", influence: 70, shutterAngle: 180 }],
  ])("%s generates valid ES3", (op, args) => {
    assertValidJsx(getOp(op as string)!.toJsx(args as Record<string, unknown>));
  });

  it("review is read-only, adjust and polish are not", () => {
    expect(getOp("anim.review")!.readOnly).toBe(true);
    expect(getOp("anim.adjust")!.readOnly).toBeFalsy();
    expect(getOp("anim.polish")!.readOnly).toBeFalsy();
  });

  it("presets switch motion blur on unless told not to", () => {
    expect(motion.presetJob("slide_in").motionBlur).toBe(true);
    expect(motion.presetJob("slide_in", { motionBlur: false }).motionBlur).toBe(false);
  });
});

describe("error hints", async () => {
  const { hintForError } = await import("../src/error-hints.js");
  it("explains renderer-gated 3D properties", () => {
    expect(
      hintForError("Unable to set value: the property or a parent property is hidden"),
    ).toMatch(/renderer/);
  });
  it("flags redacted scripts", () => {
    expect(hintForError("ReferenceError: [redacted] is undefined")).toBeDefined();
  });
  it("stays quiet on unrelated errors", () => {
    expect(hintForError("comp 'X' not found")).toBeUndefined();
  });
});

describe("text animation and shine", async () => {
  const tm = await import("../src/operations/text-motion.js");
  it.each(tm.ALL_TEXT_PRESETS)("text.animate %s generates valid ES3", (preset) => {
    assertValidJsx(
      getOp("text.animate")!.toJsx({ comp: "Main", layers: ["T1", "T2"], preset, stagger: 0.1 }),
    );
  });
  it("loops read editable sliders", () => {
    const j = tm.textJob("scale_wave");
    expect(j.kind).toBe("loop");
    expect(j.controls.map((c) => c.name)).toEqual([
      "Chữ to nhỏ · tần số (lần/giây)",
      "Chữ to nhỏ · độ trễ mỗi chữ",
    ]);
    expect(j.expr).toContain('effect("Chữ to nhỏ · tần số (lần/giây)")');
  });
  it("exits mirror entrances", () => {
    expect(tm.textJob("char_pop_out").kind).toBe("out");
    expect(tm.textJob("tracking_out").kind).toBe("out");
    expect(() => tm.textJob("char_explode")).toThrow(/unknown/);
  });
  it("shine validates and generates valid ES3", () => {
    assertValidJsx(
      getOp("anim.shine")!.toJsx({
        comp: "Main",
        layers: "title",
        repeatEvery: 2,
        color: "#FFF4D0",
      }),
    );
    expect(
      getOp("anim.shine")!.toJsx({ comp: "Main", layers: 1, duration: 1, repeatEvery: 0.5 }),
    ).toContain("repeatEvery");
  });
  it("plans can mix keyframe, text and shine presets", () => {
    const r = motion.resolvePlan([
      { layer: "A", preset: "pop_in" },
      { layer: "B", preset: "char_rise", spread: 20 },
      { layer: "B", preset: "shine", repeatEvery: 2 },
    ]);
    expect(r.steps.map((s) => (s.job as { type?: string }).type ?? "anim")).toEqual([
      "anim",
      "text",
      "shine",
    ]);
  });
});

describe("speed ramp", () => {
  it("integrates speed into source time", () => {
    const k = motion.rampKeys([{ duration: 1, speed: 2 }, { duration: 2, speed: 0.25 }]);
    expect(k.map((x) => x.src)).toEqual([0, 2, 2.5]);
    expect(k[1]).toMatchObject({ speedIn: 2, speedOut: 0.25 });
  });
  it("presets scale to the requested length", () => {
    const s = motion.rampSegments("slowmo_hit", 4, undefined);
    expect(s.reduce((a, b) => a + b.duration, 0)).toBeCloseTo(4);
    expect(s[1].speed).toBe(0.25);
    expect(() => motion.rampSegments("warp", undefined, undefined)).toThrow(/unknown/);
    expect(() => motion.rampKeys([{ duration: 1, speed: 0 }])).toThrow(/speed/);
  });
  it.each(motion.RAMP_PRESET_NAMES)("%s generates valid ES3", (preset) => {
    assertValidJsx(getOp("anim.speed_ramp")!.toJsx({ comp: "Main", layer: 1, preset, frameBlend: "pixel_motion" }));
  });
});
