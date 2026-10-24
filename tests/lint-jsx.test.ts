// Static analysis of everything that ends up inside After Effects. Two passes,
// neither of which touches AE:
//   1. ES3 compatibility of the sources under jsx/
//   2. injection safety of the JSX we generate from TypeScript — no tool
//      argument may reach the generated script without going through jsxVal

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { lintCodegenDir, lintCodegenFile } from "./helpers/lint-codegen.js";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  findTernaryChains,
  findTrailingCommas,
  lintJsxDir,
  lintJsxFile,
} from "./helpers/lint-jsx.js";

const JSX_DIR = fileURLToPath(new URL("../jsx/", import.meta.url));
// Whole of src/, not just operations + tools: the `jsx*` encoder helpers the
// lint trusts by name live in registry.ts, and trusting them is only sound
// while their own bodies are scanned too.
const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));

describe("jsx/ ES3 lint", () => {
  it("has zero error-severity findings", () => {
    const findings = lintJsxDir(JSX_DIR);
    const errors = findings.filter((f) => f.severity === "error");
    const report = errors
      .map((f) => `${f.file}:${f.line} [${f.rule}] ${f.description}\n    > ${f.text}`)
      .join("\n");
    expect(errors.length, report).toBe(0);
  });
});

describe("generated-JSX injection lint", () => {
  it("nothing under src/ interpolates a tool argument raw", () => {
    const findings = lintCodegenDir(SRC_DIR);
    const report = findings.map((f) => `${f.file}:${f.line}\n    > ${f.text}`).join("\n");
    expect(findings.length, report).toBe(0);
  });

  it("nothing under src/ renders a caught exception by coercion", () => {
    // Covered by the same pass; asserted separately because it is a different
    // failure mode — not injection, but a handler that throws while handling.
    const findings = lintCodegenDir(SRC_DIR).filter((f) => f.message.includes("coercion"));
    const report = findings.map((f) => `${f.file}:${f.line}\n    > ${f.text}`).join("\n");
    expect(findings.length, report).toBe(0);
  });

  it("catches the injection pattern it exists to catch", () => {
    // Guard against the lint silently degrading into a no-op: a fixture with a
    // known-bad interpolation must still be reported.
    const fixture = fileURLToPath(new URL("./fixtures/bad-codegen.fixture.ts", import.meta.url));
    const findings = lintCodegenFile(fixture);
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some((f) => f.text.includes("layers.addSolid"))).toBe(true);
    // The ternary-test exemption must not extend to the emitted branch.
    expect(findings.some((f) => f.text.includes("_layer.name ="))).toBe(true);
    // …and it must still exempt the test itself, or every conditional
    // fragment in src/operations would be a false positive.
    expect(findings.every((f) => !f.text.includes("jsxVal(args."))).toBe(true);
  });

  it("catches both shapes of rendering an exception by coercion", () => {
    const fixture = fileURLToPath(new URL("./fixtures/bad-codegen.fixture.ts", import.meta.url));
    const findings = lintCodegenFile(fixture).filter((f) => f.message.includes("coercion"));
    expect(findings.some((f) => f.text.includes('"name: " + e'))).toBe(true);
    expect(findings.some((f) => f.text.includes("String(eRm)"))).toBe(true);
    // `_w.push`, `_layer`, `AE.errText` and the like must not be swept up: the
    // rule keys off catch-parameter names, not "starts with e".
    expect(findings.length).toBe(2);
  });

  it("catches a chained ternary in generated JSX, and only the unparenthesized form", () => {
    // ExtendScript parses ?: left-associatively — the chain that labelled
    // every ae_context item "Folder". The parenthesized twin is correct and
    // must stay clean.
    const fixture = fileURLToPath(new URL("./fixtures/bad-codegen.fixture.ts", import.meta.url));
    const findings = lintCodegenFile(fixture).filter((f) =>
      f.message.includes("LEFT-associatively"),
    );
    expect(findings.length).toBe(1);
    expect(findings[0].text).toContain('? "Comp" :');
    expect(findings[0].text).not.toContain("((it instanceof FolderItem)");
  });
});

describe("findTernaryChains", () => {
  const chains = (code: string) => findTernaryChains(code).length;

  it("flags the left-associativity trap", () => {
    expect(chains("var t = a ? 1 : b ? 2 : 3;")).toBeGreaterThan(0);
    expect(chains("x = a ? 1 : b ? 2 : c ? 3 : 4;")).toBeGreaterThan(0);
    // Chain inside an object literal value (the shipped ae_context shape).
    expect(chains("var o = { type: a ? 1 : b ? 2 : 3 };")).toBeGreaterThan(0);
    // Chain as a call argument.
    expect(chains("f(a ? 1 : b ? 2 : 3);")).toBeGreaterThan(0);
    // Unparenthesized conditional in the THEN branch is just as ambiguous.
    expect(chains("var t = a ? b ? 1 : 2 : 3;")).toBeGreaterThan(0);
    // Multi-line chains must not escape.
    expect(chains("var t = a ? 1 :\n    b ? 2 : 3;")).toBeGreaterThan(0);
  });

  it("stays quiet on correct forms", () => {
    expect(chains("var t = a ? 1 : 2;")).toBe(0);
    // Parenthesized nesting is the sanctioned fix.
    expect(chains("var t = a ? 1 : (b ? 2 : 3);")).toBe(0);
    expect(chains("var t = a ? (b ? 1 : 2) : 3;")).toBe(0);
    // Independent ternaries: statement-, argument-, and property-separated.
    expect(chains("var t = a ? 1 : 2; var u = b ? 3 : 4;")).toBe(0);
    expect(chains("f(a ? 1 : 2, b ? 3 : 4);")).toBe(0);
    expect(chains("var o = { x: a ? 1 : 2, y: b ? 3 : 4 };")).toBe(0);
    expect(chains("var o = {\n  x: a ? 1 : 2,\n  y: b ? 3 : 4\n};")).toBe(0);
    // Ternary inside a function call inside a branch.
    expect(chains("var t = a ? f(b ? 1 : 2) : 3;")).toBe(0);
  });
});

describe("ES3 reserved words and trailing commas", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lint-es3-"));
  const lint = (code: string) => {
    const f = path.join(dir, `t${Math.random().toString(36).slice(2)}.jsx`);
    writeFileSync(f, code);
    return lintJsxFile(f)
      .filter((x) => x.severity === "error")
      .map((x) => x.rule);
  };

  it("flags what After Effects 26.5 rejects", () => {
    expect(lint("var COL = { char: 1 };")).toContain("es3-reserved-key");
    expect(lint("var o = { a: 1, default: 2 };")).toContain("es3-reserved-key");
    expect(lint("var class = 1;")).toContain("es3-reserved-key");
    expect(lint("var a = [1, 2, ];")).toContain("es3-trailing-comma");
    expect(lint("var o = {\n  a: 1,\n};")).toContain("es3-trailing-comma");
  });

  it("stays quiet on what it accepts", () => {
    // measured: quoted reserved keys and dot access run fine
    expect(lint('var o = { "class": 1 }; o.default = 2; var chars = 3;')).toEqual([]);
    expect(lint('var t = a ? 1 : 2; var s = "a, ]";')).toEqual([]);
    expect(findTrailingCommas("f(a, b)")).toEqual([]);
  });
});

describe("hard-coded matchNames are verified", () => {
  // A matchName After Effects does not have can CRASH it on addProperty
  // (ADBE Vector Filter - Wiggle Transform, AE 26.5): every literal one in the
  // code must be in the table dumped from a live AE.
  const verified = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../Kiến thức/Kỹ thuật/MatchName đã kiểm chứng.json", import.meta.url)),
      "utf8",
    ),
  );
  const known = new Set<string>([
    ...Object.keys(verified.effects),
    ...Object.keys(verified.groups),
    ...verified.effectsVerifiedOnly,
  ]);
  const walk = (n: { matchName: string; addable?: string[]; children?: unknown[] }) => {
    known.add(n.matchName);
    for (const a of n.addable ?? []) known.add(a);
    for (const c of (n.children ?? []) as (typeof n)[]) walk(c);
  };
  for (const k of ["layer", "textLayer", "shapeLayer"]) for (const n of verified[k]) walk(n);
  for (const g of Object.values(verified.groups)) walk(g as never);
  for (const e of Object.values(verified.effects) as { params: never[] }[])
    for (const p of e.params) walk(p);

  it('every addProperty("…") literal under src/ and jsx/ is a verified matchName', async () => {
    const { globSync } = await import("node:fs");
    const files = [
      ...globSync("src/**/*.ts", { cwd: fileURLToPath(new URL("..", import.meta.url)) }),
      ...globSync("jsx/*.jsx", { cwd: fileURLToPath(new URL("..", import.meta.url)) }),
    ];
    const bad: string[] = [];
    for (const f of files) {
      const text = readFileSync(fileURLToPath(new URL(`../${f}`, import.meta.url)), "utf8");
      for (const m of text.matchAll(/addProperty\(\s*\\?"([^"\\]+)\\?"/g)) {
        if (!known.has(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(files.length).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("AE.SHAPE_ITEMS in toolkit.jsx is exactly the verified shape Contents list", () => {
    const toolkit = readFileSync(
      fileURLToPath(new URL("../jsx/toolkit.jsx", import.meta.url)),
      "utf8",
    );
    const block = /AE\.SHAPE_ITEMS = \[([\s\S]*?)\];/.exec(toolkit)![1];
    const listed = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const root = verified.shapeLayer.find(
      (n: { matchName: string }) => n.matchName === "ADBE Root Vectors Group",
    );
    expect(listed).toEqual(root.addable);
  });

  it("names known not to exist are never used", () => {
    for (const name of Object.keys(verified.notReal)) expect(known.has(name), name).toBe(false);
  });
});
