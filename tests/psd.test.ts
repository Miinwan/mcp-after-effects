import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { lintJsxFile } from "./helpers/lint-jsx.js";

const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const psd = await import("../src/operations/psd.js");
const motion = await import("../src/operations/motion.js");

const W = 1080;
const H = 1920;
let id = 100;
function layer(
  name: string,
  bounds: number[],
  extra: Partial<import("../src/operations/psd.js").ScannedLayer> = {},
) {
  const [l, t, r, b] = bounds;
  return {
    index: 0,
    id: id++,
    name,
    isText: false,
    isComp: false,
    enabled: true,
    bounds,
    area: ((r - l) * (b - t)) / (W * H),
    fontSize: 0,
    hasKeys: false,
    ...extra,
  };
}
function comp(layers: ReturnType<typeof layer>[]) {
  layers.forEach((l, n) => (l.index = n + 1));
  return { name: "Intro", width: W, height: H, duration: 2.8, frameRate: 30, layers };
}

// Layer names taken from a sample event 'Reel.psd' (scene Intro / Cảnh 1).
const REEL = () =>
  comp([
    layer("star", [851, 1221, 965, 1341]),
    layer("KẸO", [40, 300, 160, 420]),
    layer("ribbon", [0, 900, 1080, 1300]),
    layer("logo ", [430, 30, 650, 110]),
    layer("cupcake", [0, 0, W, H]),
    layer("MÂY", [800, 200, 1080, 380]),
    layer("time", [200, 760, 880, 840], { isText: true, fontSize: 40 }),
    layer("title", [60, 160, 1020, 560]),
    layer("Layer 1", [100, 900, 700, 1500]),
    layer("Color Fill 4", [0, 0, W, H]),
    layer("kẹo nền", [0, 1400, W, H]),
    layer("BG copy", [0, 0, W, H]),
  ]);

describe("PSD roles", () => {
  it("reads Vietnamese and English names, accents or not", () => {
    expect(psd.roleFromName("Tiêu đề chính")).toBe("headline");
    expect(psd.roleFromName("tieu de")).toBe("headline");
    expect(psd.roleFromName("NỀN")).toBe("background");
    expect(psd.roleFromName("Ngày giờ")).toBe("info");
    expect(psd.roleFromName("Nút đăng ký")).toBe("cta");
    expect(psd.roleFromName("MÂY")).toBe("decor");
    expect(psd.roleFromName("logo ")).toBe("logo");
    expect(psd.roleFromName("Layer 1")).toBeNull();
    expect(psd.roleFromName("subway")).toBeNull();
  });

  it("falls back to geometry: biggest text headline, small decor, big hero", () => {
    const roles = psd.assignRoles(
      comp([
        layer("Layer 5", [100, 100, 900, 300], { isText: true, fontSize: 120 }),
        layer("Layer 6", [100, 400, 900, 450], { isText: true, fontSize: 36 }),
        layer("Layer 7", [10, 10, 60, 60]),
        layer("Layer 8", [100, 600, 900, 1500]),
        layer("Layer 9", [0, 0, W, H]),
      ]),
    );
    expect(roles.map((r) => r.role)).toEqual(["headline", "info", "decor", "hero", "background"]);
  });

  it("skips disabled layers", () => {
    expect(
      psd.assignRoles(comp([layer("title", [0, 0, 10, 10], { enabled: false })])),
    ).toHaveLength(0);
  });
});

describe("PSD plan", () => {
  it("only the bottom background drifts; canvas-sized artwork above it animates", () => {
    const p = psd.planFromScan(REEL(), { style: "energetic", keepStatic: ["logo"] });
    const kb = p.plan.filter((s) => s.preset === "ken_burns");
    expect(kb.map((s) => s.name)).toEqual(["BG copy"]);
    expect(p.plan.find((s) => s.name === "cupcake")?.role).toBe("hero");
    expect(p.plan.find((s) => s.name === "Color Fill 4")?.role).toBe("hero");
    expect(p.plan.some((s) => s.name === "kẹo nền")).toBe(false);
    expect(p.plan.some((s) => s.name === "logo ")).toBe(false);
  });

  it("orders entrances hero → headline → info → decor and staggers within a role", () => {
    const p = psd.planFromScan(REEL(), { style: "pop" });
    const start = (n: string) => p.plan.find((s) => s.name === n)!.start!;
    const firstHero = Math.min(
      ...p.plan.filter((s) => s.role === "hero" && s.start !== undefined).map((s) => s.start!),
    );
    expect(start("title")).toBeGreaterThan(firstHero);
    expect(start("time")).toBeGreaterThan(start("title"));
    expect(start("star")).toBeGreaterThan(start("time"));
    const decor = p.plan.filter((s) => s.role === "decor").map((s) => s.start!);
    expect(new Set(decor).size).toBe(decor.length);
  });

  it("decor loops alternate so neighbours do not move alike", () => {
    const p = psd.planFromScan(REEL(), { style: "pop" });
    const types = p.loops
      .filter((l) => ["star", "KẸO", "MÂY", "ribbon"].includes(l.name))
      .map((l) => l.type);
    expect(new Set(types).size).toBeGreaterThan(1);
  });

  it("exits arrive before the end, in reverse order", () => {
    const p = psd.planFromScan(REEL(), { style: "energetic", exit: true });
    const outs = p.plan.filter((s) => s.preset.endsWith("_out"));
    expect(outs.length).toBeGreaterThan(0);
    for (const o of outs) expect((o.start ?? 0) + (o.duration ?? 0)).toBeLessThanOrEqual(2.8);
  });

  it("picks the style from the brief and says so", () => {
    expect(psd.styleFromBrief("Video sang trọng, nhẹ nhàng cho resort")).toBe("smooth");
    expect(psd.styleFromBrief("reel sôi động cho TikTok")).toBe("energetic");
    const p = psd.planFromScan(REEL(), { brief: "phong cách vui, dễ thương" });
    expect(p.style).toBe("pop");
    expect(p.notes.join(" ")).toMatch(/brief/);
  });

  it("every generated plan resolves for anim.apply_plan", () => {
    for (const style of ["smooth", "pop", "energetic"] as const) {
      const p = psd.planFromScan(REEL(), { style, exit: true });
      expect(() => motion.resolvePlan(p.plan, p.loops)).not.toThrow();
    }
  });
});

describe("PSD ops", () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "psd-"));
  it.each([
    [
      "psd.import",
      { path: "/tmp/Reel.psd", fps: 30, duration: 12, folder: "Acme", editableText: true },
    ],
    ["psd.sequence_scenes", { comp: "Reel", sceneDuration: 2.8 }],
  ])("%s generates valid ES3", (op, args) => {
    const jsx = getOp(op as string)!.toJsx(args as Record<string, unknown>);
    expect(() => new Function(jsx)).not.toThrow();
    const f = path.join(tmp, `${op}.jsx`);
    writeFileSync(f, jsx);
    expect(lintJsxFile(f).filter((x) => x.severity === "error")).toEqual([]);
  });

  it("plan and auto_animate are server-side", () => {
    expect(getOp("psd.plan")!.readOnly).toBe(true);
    expect(getOp("psd.plan")!.run).toBeDefined();
    expect(getOp("psd.auto_animate")!.run).toBeDefined();
  });
});

describe("composed looks (no single house style)", () => {
  it("same seed rebuilds the same look, other seeds differ", () => {
    expect(psd.composeVariant(42).label).toBe(psd.composeVariant(42).label);
    const labels = new Set(
      Array.from({ length: 12 }, (_, i) => psd.composeVariant(1000 + i).label),
    );
    expect(labels.size).toBeGreaterThan(8);
  });

  it("a scene never repeats the previous scene's hero, headline or exit", () => {
    let prev = psd.composeVariant(1);
    for (let i = 2; i < 40; i++) {
      const v = psd.composeVariant(i, prev);
      expect(v.role.hero?.preset).not.toBe(prev.role.hero?.preset);
      expect(v.role.headline?.preset).not.toBe(prev.role.headline?.preset);
      expect(v.exit.preset).not.toBe(prev.exit.preset);
      prev = v;
    }
  });

  it("every composed plan resolves (all pool presets exist), text layers included", () => {
    const withText = () =>
      comp([
        layer("title", [60, 160, 1020, 560], { isText: true, fontSize: 120 }),
        layer("Ngày giờ", [200, 760, 880, 840], { isText: true, fontSize: 40 }),
        layer("cupcake", [0, 0, W, H]),
        layer("star", [10, 10, 60, 60]),
        layer("Nút đăng ký", [300, 1500, 780, 1600]),
        layer("BG", [0, 0, W, H]),
      ]);
    for (let seed = 0; seed < 200; seed++) {
      const p = psd.planFromScan(withText(), { style: "energetic", seed, exit: true });
      expect(() => motion.resolvePlan(p.plan, p.loops), `seed ${seed}`).not.toThrow();
    }
  });
});

describe("canvas-sized artwork", () => {
  it("never rotates or scales round the canvas centre", () => {
    for (let seed = 0; seed < 100; seed++) {
      const p = psd.planFromScan(REEL(), { style: "energetic", seed, exit: true });
      for (const st of p.plan.filter((s) => s.name === "cupcake" || s.name === "Color Fill 4")) {
        expect(st.preset, `seed ${seed}`).not.toMatch(/^(rotate|scale|pop|stretch)_/);
      }
    }
  });
});

describe("backings", () => {
  it("colour fills follow the artwork above instead of animating alone", () => {
    expect(psd.isBacking("Color Fill 4")).toBe(true);
    expect(psd.isBacking("cupcake")).toBe(false);
    const p = psd.planFromScan(REEL(), { style: "energetic", seed: 3, exit: true });
    const steps = p.plan.filter((s) => s.name === "Color Fill 4");
    expect(steps.map((s) => s.preset)).toEqual(["follow"]);
    expect(() => motion.resolvePlan(p.plan, p.loops)).not.toThrow();
  });
});
