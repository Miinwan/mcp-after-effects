import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const { dominantColors } = await import("../src/operations/logo.js");
const { encodePngSrgb8 } = await import("../src/color/png16.js");

const fakeTransport = {} as never;
const hasSips = process.platform === "darwin" && spawnSync("sips", ["--help"]).status === 0;

/** 10x10: 60 % brand red #E30613, 30 % white, 10 % navy #1B2A4A. */
function artwork(): Float64Array {
  const rgb = new Float64Array(100 * 3);
  for (let p = 0; p < 100; p++) {
    const c = p < 60 ? [0xe3, 0x06, 0x13] : p < 90 ? [255, 255, 255] : [0x1b, 0x2a, 0x4a];
    for (let ch = 0; ch < 3; ch++) rgb[p * 3 + ch] = c[ch] / 255;
  }
  return rgb;
}

describe("brand.colors_from_file", () => {
  it("is registered, read-only and runs on the server", () => {
    const op = getOp("brand.colors_from_file")!;
    expect(op).toBeDefined();
    expect(op.readOnly).toBe(true);
    expect(typeof op.run).toBe("function");
  });

  it("orders colours by area and flags neutrals", () => {
    const colors = dominantColors(artwork(), undefined, 5);
    expect(colors.map((c) => c.hex)).toEqual(["#E30613", "#FFFFFF", "#1B2A4A"]);
    expect(colors.map((c) => c.share)).toEqual([0.6, 0.3, 0.1]);
    expect(colors.map((c) => c.neutral)).toEqual([false, true, false]);
  });

  it("ignores transparent pixels and merges near shades", () => {
    const rgb = artwork();
    // Anti-aliased edge: a slightly darker red joins the red cluster.
    rgb[0] = 0xd8 / 255;
    const alpha = new Float64Array(100).fill(1);
    for (let p = 60; p < 90; p++) alpha[p] = 0; // the white is the transparent background
    const colors = dominantColors(rgb, alpha, 5);
    expect(colors).toHaveLength(2);
    expect(colors[0].rgb[0]).toBeGreaterThan(0xd8);
    expect(colors[0].rgb[0]).toBeLessThanOrEqual(0xe3);
    expect(colors[0].share).toBeCloseTo(60 / 70, 3);
  });

  it("reports a missing file", async () => {
    const res = (await getOp("brand.colors_from_file")!.run!(
      { file: "/nope/khong-co.psd" },
      fakeTransport,
    )) as {
      ok: boolean;
      error: string;
    };
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/);
  });

  it.skipIf(!hasSips)("reads a PNG and a PSD made from it", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brand-colors-"));
    const png = path.join(dir, "an pham.png");
    writeFileSync(png, encodePngSrgb8(10, 10, artwork()));
    const psd = path.join(dir, "an pham.psd");
    expect(spawnSync("sips", ["-s", "format", "psd", png, "--out", psd]).status).toBe(0);
    for (const file of [png, psd]) {
      const res = (await getOp("brand.colors_from_file")!.run!(
        { file, count: 2 },
        fakeTransport,
      )) as {
        ok: boolean;
        colors: Array<{ rgb: number[] }>;
      };
      expect(res.ok, file).toBe(true);
      expect(res.colors).toHaveLength(2);
      // Colour management in sips may move a channel by a step or two.
      res.colors[0].rgb.forEach((v, i) =>
        expect(Math.abs(v - [0xe3, 0x06, 0x13][i]), file).toBeLessThanOrEqual(3),
      );
    }
  });
});
