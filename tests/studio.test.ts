import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

process.env.AE_MCP_BRAND_DIR = mkdtempSync(path.join(os.tmpdir(), "brand-"));

const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const { encodePngSrgb8 } = await import("../src/color/png16.js");

const fakeTransport = {} as never;

describe("studio operations", () => {
  it("registers every studio op", () => {
    for (const name of [
      "project.checkpoint",
      "project.list_checkpoints",
      "expression.validate",
      "text.qa",
      "color.report",
      "color.setup",
      "brand.save",
      "brand.list",
      "brand.get",
      "brand.apply",
      "data.to_comps",
      "render.frame_diff",
      "render.background",
      "render.background_status",
      "knowledge.refresh_effects",
    ]) {
      expect(getOp(name), name).toBeDefined();
    }
  });

  it("checkpoint runs outside the automatic undo group", () => {
    const op = getOp("project.checkpoint")!;
    expect(op.undoGroup!({})).toBe(false);
  });

  it("brand kit round-trips hex colours to 0-1 rgb", async () => {
    const save = await getOp("brand.save")!.run!(
      {
        name: "KOI Resort",
        colors: { primary: "#FF0000", accent: [0, 128, 255] },
        fonts: { heading: "Montserrat-Bold" },
      },
      fakeTransport,
    );
    expect((save as { ok: boolean }).ok).toBe(true);
    const got = (await getOp("brand.get")!.run!({ name: "KOI Resort" }, fakeTransport)) as {
      kit: { colors: Record<string, number[]> };
    };
    expect(got.kit.colors.primary).toEqual([1, 0, 0]);
    expect(got.kit.colors.accent[2]).toBe(1);
    const list = (await getOp("brand.list")!.run!({}, fakeTransport)) as { brands: string[] };
    expect(list.brands).toContain("KOI Resort");
  });

  it("brand.apply embeds the kit colours and refuses unknown roles", () => {
    const op = getOp("brand.apply")!;
    const jsx = op.toJsx({
      brand: "KOI Resort",
      comp: "Main",
      colorMap: [{ from: "#FFFFFF", to: "primary" }],
    });
    expect(jsx).toContain("[1,0,0]");
    const bad = op.toJsx({ brand: "KOI Resort", comp: "Main", fontRoles: { Title: "body" } });
    expect(bad).toContain("no font for role");
  });

  it("data.to_comps validates rows and output paths", () => {
    const op = getOp("data.to_comps")!;
    expect(op.toJsx({ template: "T", rows: [] })).toContain("non-empty");
    expect(op.toJsx({ template: "T", rows: [{ name: "A" }], queueRender: true })).toContain(
      "needs outputPath",
    );
    expect(
      op.toJsx({ template: "T", rows: [{ name: "A", texts: { Title: "Phòng Deluxe" } }] }),
    ).toContain("Phòng Deluxe");
  });

  it("frame_diff measures a changed region", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "diff-"));
    const w = 8;
    const h = 4;
    const a = new Float64Array(w * h * 3);
    const b = new Float64Array(w * h * 3);
    b[(1 * w + 2) * 3] = 1; // one red pixel at x=2,y=1
    writeFileSync(path.join(dir, "a.png"), encodePngSrgb8(w, h, a));
    writeFileSync(path.join(dir, "b.png"), encodePngSrgb8(w, h, b));
    const res = (await getOp("render.frame_diff")!.run!(
      { a: path.join(dir, "a.png"), b: path.join(dir, "b.png") },
      fakeTransport,
    )) as { changedBbox: number[]; identical: boolean };
    expect(res.identical).toBe(false);
    expect(res.changedBbox).toEqual([2, 1, 2, 1]);
  });

  it("color.setup maps the premiere preset", () => {
    const jsx = getOp("color.setup")!.toJsx({ preset: "premiere_rec709" });
    expect(jsx).toContain('"709"');
    expect(jsx).toContain("2.4");
    expect(getOp("color.setup")!.toJsx({ preset: "x" })).toContain("preset must be");
  });
});
