// Client logo library: one folder per client. Location: MCP_LOGO_DIR, else
// "logoDir" in config.local.json at the repo root (git-ignored, per machine),
// else ~/Client Logos.
// File names are often meaningless (Viber exports), so each PNG is looked at:
// transparency, how much of the canvas the mark covers, and its tone (white,
// black or colour). brand.scan_logos writes an index into the knowledge base;
// brand.find_logo picks the right file for a client and a background.

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

import { decodePng } from "../color/png16.js";
import { PACKAGE_ROOT } from "../config.js";
import { jsxFail, registerOp } from "../registry.js";

function localLogoDir(): string | undefined {
  const file = path.join(PACKAGE_ROOT, "config.local.json");
  if (!existsSync(file)) return undefined;
  try {
    const dir = (JSON.parse(readFileSync(file, "utf8")) as { logoDir?: unknown }).logoDir;
    return typeof dir === "string" && dir ? dir : undefined;
  } catch {
    return undefined;
  }
}

export const LOGO_DIR = process.env.MCP_LOGO_DIR || localLogoDir() || path.join(homedir(), "Client Logos");
const INDEX_DIR = path.join(PACKAGE_ROOT, "Kiến thức", "Khách hàng");
const INDEX_JSON = path.join(INDEX_DIR, "Kho logo khách.json");
const INDEX_MD = path.join(INDEX_DIR, "Kho logo khách.md");

const IMAGE = /\.(png|jpe?g|tiff?|svg|ai|eps|pdf|psd)$/i;
const MOTION = /\.(mov|mp4|aep|gif|webm)$/i;

export type Tone = "trắng" | "đen" | "màu" | null;

export interface LogoFile {
  file: string;
  rel: string;
  kind: "image" | "motion";
  ext: string;
  width: number | null;
  height: number | null;
  transparent: boolean | null;
  coverage: number | null;
  tone: Tone;
  hints: string[];
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Variant words in a file or folder name. */
export function nameHints(rel: string): string[] {
  const n = ` ${normalize(rel)} `;
  const out: string[] = [];
  const has = (...w: string[]) => w.some((x) => n.includes(` ${x} `) || n.includes(x));
  if (has("white", "trang", "reverse", "negative", "am ban")) out.push("trắng");
  if (has("black", "den ", " den", "dark")) out.push("đen");
  if (has("khong nen", "no background", "transparent", "trong suot")) out.push("không nền");
  if (has("ngang", "horizontal")) out.push("ngang");
  if (has("doc ", "vertical", "stacked")) out.push("dọc");
  if (has("icon", "symbol", "monogram", "favicon")) out.push("biểu tượng");
  if (has("endcard", "end card", "animlogo", "anim logo", "logo reveal")) out.push("logo động");
  if (has("viber", "zalo", "screenshot", "anh chup")) out.push("tên không rõ");
  return out;
}

/** Width/height of a JPEG from its SOF marker, or nulls. */
function jpegSize(buf: Buffer): { w: number; h: number } | null {
  let i = 2;
  while (i < buf.length - 9) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

/** Transparency, coverage and tone of a PNG. Large files are sized only. */
export function analysePng(buf: Buffer): Pick<LogoFile, "width" | "height" | "transparent" | "coverage" | "tone"> {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf.readUInt8(25);
  const hasAlpha = colorType === 4 || colorType === 6;
  if (buf.length > 30 * 1024 * 1024 || width * height > 40_000_000) {
    return { width, height, transparent: hasAlpha, coverage: null, tone: null };
  }
  let d;
  try {
    d = decodePng(buf);
  } catch {
    return { width, height, transparent: hasAlpha, coverage: null, tone: null };
  }
  const n = d.width * d.height;
  const step = Math.max(1, Math.floor(n / 200_000));
  let seen = 0;
  let solid = 0;
  let lum = 0;
  let sat = 0;
  for (let p = 0; p < n; p += step) {
    seen++;
    const a = d.alpha ? d.alpha[p] : 1;
    if (a < 0.5) continue;
    const r = d.rgb[p * 3], g = d.rgb[p * 3 + 1], b = d.rgb[p * 3 + 2];
    solid++;
    lum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sat += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const coverage = seen ? solid / seen : 0;
  const transparent = !!d.alpha && coverage < 0.97;
  let tone: Tone = null;
  if (transparent && solid > 0) {
    const L = lum / solid;
    const S = sat / solid;
    tone = S > 0.15 ? "màu" : L > 0.8 ? "trắng" : L < 0.25 ? "đen" : "màu";
  }
  return { width: d.width, height: d.height, transparent, coverage: Math.round(coverage * 1000) / 1000, tone };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = path.join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      // An .aep "folder" pack or MGALLERY_ANIMLOGO_5S: keep walking.
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

export function scanClient(clientDir: string): LogoFile[] {
  const files: LogoFile[] = [];
  for (const file of walk(clientDir)) {
    const ext = path.extname(file).slice(1).toLowerCase();
    const rel = path.relative(clientDir, file);
    if (MOTION.test(file)) {
      files.push({ file, rel, kind: "motion", ext, width: null, height: null, transparent: null, coverage: null, tone: null, hints: nameHints(rel) });
      continue;
    }
    if (!IMAGE.test(file)) continue;
    let info: Pick<LogoFile, "width" | "height" | "transparent" | "coverage" | "tone"> = { width: null, height: null, transparent: null, coverage: null, tone: null };
    try {
      if (ext === "png") info = analysePng(readFileSync(file));
      else if (ext === "jpg" || ext === "jpeg") {
        const s = jpegSize(readFileSync(file));
        info = { width: s?.w ?? null, height: s?.h ?? null, transparent: false, coverage: null, tone: null };
      } else if (ext === "svg" || ext === "ai" || ext === "eps" || ext === "pdf") info.transparent = true;
    } catch {
      /* unreadable: listed without details */
    }
    files.push({ file, rel, kind: "image", ext, ...info, hints: nameHints(rel) });
  }
  return files;
}

export type Want = "auto" | "trắng" | "đen" | "màu" | "động";

/** Score a file for a request; higher is better. Pure, for tests. */
export function scoreLogo(f: LogoFile, want: Want): number {
  if (want === "động") return f.kind === "motion" ? 10 + (f.hints.includes("logo động") ? 3 : 0) + (f.ext === "mov" ? 1 : 0) : -100;
  if (f.kind !== "image") return -100;
  let s = 0;
  if (f.transparent) s += 6;
  if (["svg", "ai", "eps", "pdf"].includes(f.ext)) s += 2;
  if (f.ext === "psd") s -= 2;
  if (f.hints.includes("tên không rõ")) s -= 1;
  // Assets inside an endcard/template pack belong to other brands too.
  if (/\.aep[\\/]|[\\/](\d\. )?assets[\\/]/i.test(f.rel)) s -= 6;
  if (/logo/i.test(f.rel)) s += 1;
  const px = (f.width ?? 0) * (f.height ?? 0);
  s += Math.min(2, px / 2_000_000);
  if (f.coverage !== null && f.coverage < 0.02) s -= 3; // nearly empty canvas
  const tone = f.tone ?? (f.hints.includes("trắng") ? "trắng" : f.hints.includes("đen") ? "đen" : null);
  if (want !== "auto") {
    if (tone === want) s += 5;
    else if (tone) s -= 4;
  } else if (tone === "màu") s += 1;
  return Math.round(s * 100) / 100;
}

export function listClients(): string[] {
  if (!existsSync(LOGO_DIR)) return [];
  return readdirSync(LOGO_DIR).filter((n) => !n.startsWith(".") && statSync(path.join(LOGO_DIR, n)).isDirectory());
}

/** Best client folder for a name ("JW Marriott Phu Quoc" → "JWPQ" only via aliases). */
export function matchClient(name: string, clients: string[] = listClients()): string | null {
  const want = normalize(name);
  const exact = clients.find((c) => normalize(c) === want);
  if (exact) return exact;
  const part = clients.find((c) => normalize(c).includes(want) || want.includes(normalize(c)));
  return part ?? null;
}

interface IndexClient {
  client: string;
  folder: string;
  images: number;
  transparent: number;
  motion: number;
  best: Partial<Record<Want, string>>;
}

registerOp({
  name: "brand.scan_logos",
  category: "brand",
  readOnly: true,
  description:
    "Scan the client logo library (one folder per client; MCP_LOGO_DIR or logoDir in config.local.json) and write the index into the knowledge base ('Khách hàng/Kho logo khách.md' + .json): per client the best transparent logo, white and black versions and animated logos, judged from the pixels (Viber-named files included). Read-only on the library. Re-run after adding logos.",
  params: [],
  toJsx: () => jsxFail("brand.scan_logos runs on the MCP server side"),
  async run() {
    if (!existsSync(LOGO_DIR)) return { ok: false, error: `logo library not found: ${LOGO_DIR} (set MCP_LOGO_DIR)` };
    const out: IndexClient[] = [];
    for (const client of listClients()) {
      const files = scanClient(path.join(LOGO_DIR, client));
      const best: IndexClient["best"] = {};
      for (const want of ["auto", "trắng", "đen", "động"] as Want[]) {
        const top = files.map((f) => ({ f, s: scoreLogo(f, want) })).sort((a, b) => b.s - a.s)[0];
        if (top && top.s > (want === "auto" ? -50 : 4)) best[want] = top.f.rel;
      }
      out.push({
        client,
        folder: path.join(LOGO_DIR, client),
        images: files.filter((f) => f.kind === "image").length,
        transparent: files.filter((f) => f.transparent).length,
        motion: files.filter((f) => f.kind === "motion").length,
        best,
      });
    }
    mkdirSync(INDEX_DIR, { recursive: true });
    writeFileSync(INDEX_JSON, JSON.stringify({ updated: new Date().toISOString(), library: LOGO_DIR, clients: out }, null, 2), "utf8");
    const rows = out.map(
      (c) =>
        `| ${c.client} | ${c.images} (${c.transparent} không nền) | ${c.best.auto ?? "—"} | ${c.best["trắng"] ?? "—"} | ${c.best["đen"] ?? "—"} | ${c.best["động"] ?? "—"} |`,
    );
    const md = [
      "# Kho logo khách — logo nào của khách nào, bản không nền, trắng, đen và logo động",
      "",
      `Cập nhật ${new Date().toLocaleDateString("vi-VN")} bằng \`ae_do brand.scan_logos\`. Kho gốc: \`${LOGO_DIR}\` (mỗi khách một thư mục; chỉ đọc, không sửa).`,
      "",
      "Dùng: `ae_do brand.find_logo { client, tone }` lấy đường dẫn file tốt nhất (tone: auto | trắng | đen | màu | động), rồi `template.logo_reveal { logo: <đường dẫn> }` hoặc `brand.save { logo }`. Trên nền tối dùng bản trắng, nền sáng dùng bản đen hoặc màu. Tên file Viber không nói lên gì: điểm chọn dựa trên độ trong suốt, độ phủ và tông màu đo từ ảnh.",
      "",
      "| Khách | Ảnh | Mặc định | Trắng | Đen | Logo động |",
      "|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n");
    writeFileSync(INDEX_MD, md, "utf8");
    return { ok: true, clients: out.length, written: [INDEX_MD, INDEX_JSON] };
  },
});

registerOp({
  name: "brand.find_logo",
  category: "brand",
  readOnly: true,
  description:
    "Find a client's logo file in the logo library by client name (one folder per client; accents and case ignored). tone: auto (best transparent logo), trắng (for dark backgrounds), đen (for light backgrounds), màu, or động (animated logo / endcard). Returns the best file plus alternatives with size, transparency and tone, ready for template.logo_reveal or brand.save.",
  params: [
    { name: "client", type: "string", description: "Client name or folder name", required: true },
    { name: "tone", type: "string", description: "auto (default) | trắng | đen | màu | động", required: false },
    { name: "limit", type: "number", description: "How many candidates to return (default 5)", required: false },
  ],
  toJsx: () => jsxFail("brand.find_logo runs on the MCP server side"),
  async run(args) {
    const want = (args.tone ?? "auto") as Want;
    if (!["auto", "trắng", "đen", "màu", "động"].includes(want)) return { ok: false, error: "tone must be auto, trắng, đen, màu or động" };
    const clients = listClients();
    if (!clients.length) return { ok: false, error: `logo library not found or empty: ${LOGO_DIR}` };
    const client = matchClient(String(args.client), clients);
    if (!client) return { ok: false, error: `no client folder matches '${String(args.client)}'`, clients };
    const files = scanClient(path.join(LOGO_DIR, client));
    const ranked = files
      .map((f) => ({ ...f, score: scoreLogo(f, want) }))
      .filter((f) => f.score > -50)
      .sort((a, b) => b.score - a.score)
      .slice(0, Number(args.limit ?? 5));
    if (!ranked.length) return { ok: false, error: `no ${want === "động" ? "animated logo" : "logo image"} in ${client}`, folder: path.join(LOGO_DIR, client) };
    return {
      ok: true,
      client,
      tone: want,
      best: ranked[0].file,
      candidates: ranked.map((f) => ({ file: f.file, size: f.width ? `${f.width}x${f.height}` : null, transparent: f.transparent, tone: f.tone, hints: f.hints, score: f.score })),
    };
  },
});

// Brand colours from an artwork anh already delivered (PSD, AI, PDF, JPG, PNG…):
// macOS sips (or ffmpeg) flattens it to a small PNG, then the opaque pixels are
// binned and merged into the few colours that cover the most area.

export interface DominantColor {
  hex: string;
  rgb: [number, number, number];
  share: number;
  neutral: boolean;
}

const hex2 = (v: number) => Math.round(v).toString(16).padStart(2, "0").toUpperCase();

/** Dominant colours of normalized RGB pixels (alpha < 0.5 ignored). Pure, for tests. */
export function dominantColors(rgb: Float64Array, alpha: Float64Array | undefined, count = 5): DominantColor[] {
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let p = 0; p * 3 < rgb.length; p++) {
    if (alpha && alpha[p] < 0.5) continue;
    const r = rgb[p * 3] * 255, g = rgb[p * 3 + 1] * 255, b = rgb[p * 3 + 2] * 255;
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bin.n++;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
    total++;
  }
  // Biggest bins first; a bin close to a kept colour (anti-aliasing, gradients) joins it.
  const clusters: Array<{ n: number; r: number; g: number; b: number }> = [];
  for (const bin of [...bins.values()].sort((a, b) => b.n - a.n)) {
    const c = { r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n };
    const near = clusters.find((k) => Math.hypot(k.r / k.n - c.r, k.g / k.n - c.g, k.b / k.n - c.b) < 48);
    if (near) {
      near.n += bin.n;
      near.r += bin.r;
      near.g += bin.g;
      near.b += bin.b;
    } else clusters.push({ ...bin });
  }
  return clusters
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map((k) => {
      const v: [number, number, number] = [k.r / k.n, k.g / k.n, k.b / k.n];
      const sat = Math.max(...v) - Math.min(...v);
      return {
        hex: `#${v.map(hex2).join("")}`,
        rgb: v.map((x) => Math.round(x)) as [number, number, number],
        share: Math.round((k.n / total) * 1000) / 1000,
        neutral: sat < 24,
      };
    });
}

function flattenToPng(file: string, out: string): string | null {
  // Shrink big artworks to 400 px (enough for colour areas); never enlarge small ones.
  const size = spawnSync("sips", ["-g", "pixelWidth", "-g", "pixelHeight", file], { encoding: "utf8" });
  const dims = [...(size.stdout ?? "").matchAll(/pixel(?:Width|Height): (\d+)/g)].map((m) => Number(m[1]));
  const shrink = dims.length === 2 && Math.max(...dims) > 400 ? ["-Z", "400"] : [];
  const sips = spawnSync("sips", ["-s", "format", "png", ...shrink, file, "--out", out], { encoding: "utf8" });
  if (sips.status === 0 && existsSync(out)) return null;
  const ff = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-vf", "scale=400:400:force_original_aspect_ratio=decrease", "-frames:v", "1", out], {
    encoding: "utf8",
  });
  if (ff.status === 0 && existsSync(out)) return null;
  return (sips.stderr || ff.stderr || "sips and ffmpeg could not read the file").trim().slice(0, 300);
}

registerOp({
  name: "brand.colors_from_file",
  category: "brand",
  readOnly: true,
  description:
    "Read the main colours of an artwork already made for a client (PSD, AI/PDF, PNG, JPG, TIFF — the visual team's deliverables in the job folder anh points to): the file is flattened with macOS sips (ffmpeg as fallback), transparent pixels ignored, and the colours covering the most area are returned as hex with their share; neutral marks white/grey/black. Use the result to fill brand.save colours and 'Khách hàng/<khách>.md'. Brand guides belong to the visual team: this only reads what was delivered.",
  params: [
    { name: "file", type: "string", description: "Absolute path of the PSD / AI / PDF / image", required: true },
    { name: "count", type: "number", description: "How many colours (default 5, max 12)", required: false },
  ],
  toJsx: () => jsxFail("brand.colors_from_file runs on the MCP server side"),
  async run(args) {
    const file = String(args.file);
    if (!existsSync(file)) return { ok: false, error: `file not found: ${file}` };
    const count = Math.min(12, Math.max(1, Number(args.count ?? 5)));
    const tmp = mkdtempSync(path.join(tmpdir(), "brand-colors-"));
    try {
      const out = path.join(tmp, "flat.png");
      const err = flattenToPng(file, out);
      if (err) return { ok: false, error: `could not read ${path.basename(file)}: ${err}` };
      const d = decodePng(readFileSync(out));
      return { ok: true, file, size: `${d.width}x${d.height}`, colors: dominantColors(d.rgb, d.alpha, count) };
    } catch (e) {
      return { ok: false, error: `could not analyse ${path.basename(file)}: ${(e as Error).message}` };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
});
