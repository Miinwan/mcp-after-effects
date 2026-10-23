// Dọn project sau bàn giao: phần thuần (không gọi After Effects) của
// project.review_unused và project.clean_unused. Từ sơ đồ item của project
// (comp nào chứa item nào), tính footage nào không còn được comp bàn giao dùng
// tới (đệ quy qua precomp), quét thư mục chứa footage để tìm file media thừa,
// rồi ghi báo cáo JSON chung định dạng với bản Premiere.
//
// Nguyên tắc an toàn: chỉ đề xuất file nằm ngay trong thư mục nguồn (không đệ
// quy, cộng thư mục con Proxies), không bao giờ đề xuất file đang dùng, file
// project, file trong thư mục thành phẩm (Xuất file, Export, Final…) hay trong
// thư mục chung của máy (Desktop, Downloads…). Xoá thật là việc của Finder:
// file vào Trash, anh tự kiểm tra rồi xoá.

import { existsSync, readdirSync, statSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface GraphItem {
  id: number;
  name: string;
  kind: "comp" | "footage" | "folder";
  /** comp: id các item làm nguồn cho layer của comp (có thể lặp). */
  sources?: number[];
  /** footage: file, solid hoặc placeholder. */
  source?: "file" | "solid" | "placeholder" | "other";
  path?: string | null;
  proxy?: string | null;
  /** false = image sequence. */
  still?: boolean;
  missing?: boolean;
}

export interface ProjectGraph {
  project: string | null;
  items: GraphItem[];
}

const VIDEO = ["mov", "mp4", "m4v", "mxf", "avi", "mkv", "mts", "m2ts", "webm", "wmv", "mpg", "mpeg", "3gp", "r3d", "braw", "crm", "insv", "lrv"];
const AUDIO = ["wav", "mp3", "aif", "aiff", "aac", "m4a", "flac", "ogg", "wma", "caf"];
const IMAGE = ["jpg", "jpeg", "png", "tif", "tiff", "gif", "bmp", "heic", "heif", "webp", "exr", "dpx", "tga", "dng", "arw", "cr2", "cr3", "nef", "raf", "psd", "psb", "ai", "eps", "svg"];
const MEDIA = new Set([...VIDEO, ...AUDIO, ...IMAGE]);
const SEQUENCE_IMAGE = new Set(["jpg", "jpeg", "png", "tif", "tiff", "exr", "dpx", "tga", "dng", "bmp"]);
/** File dữ liệu cho expression (footage("x.json")): usedIn luôn rỗng nên không bao giờ đụng tới. */
const DATA = new Set(["json", "csv", "tsv", "mgjson", "txt"]);
const PROJECT = new Set(["aep", "aepx", "aet", "prproj", "prel", "plproj"]);

function ext(p: string): string {
  return path.extname(p).slice(1).toLowerCase();
}

export function isMediaFile(p: string): boolean {
  return MEDIA.has(ext(p));
}

export function isProjectFile(p: string): boolean {
  return PROJECT.has(ext(p));
}

export function isDataFile(p: string): boolean {
  return DATA.has(ext(p));
}

/** Bỏ dấu, chữ thường: "Xuất File" -> "xuat file". */
export function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

const PROTECTED_SEGMENT =
  /^(edited|edit|exports?|exported|xuat( file)?|renders?|rendered|outputs?|deliver(y|ies|ables?)?|final|thanh pham|ban giao)(\b|$)/;

/** Thư mục có một cấp tên kiểu thành phẩm (Xuất file, Export, Render, Final, Bàn giao…). */
export function isProtectedDir(dir: string): boolean {
  return path
    .resolve(dir)
    .split(path.sep)
    .some((seg) => seg !== "" && PROTECTED_SEGMENT.test(fold(seg)));
}

/**
 * Thư mục chung của máy: không quét file chưa import ở đây (footage import
 * thẳng từ Desktop không có nghĩa mọi ảnh trên Desktop là của job).
 */
export function isSharedDir(dir: string, home = os.homedir()): boolean {
  const d = path.resolve(dir);
  if (d === path.parse(d).root) return true;
  if (/^\/Volumes\/[^/]+$/.test(d)) return true;
  const shared = ["", "Desktop", "Downloads", "Documents", "Movies", "Pictures", "Music", "Library"].map((s) =>
    path.join(home, s),
  );
  shared.push(path.join(home, "Library/Mobile Documents/com~apple~CloudDocs"));
  return shared.some((s) => path.resolve(s) === d) || d === path.dirname(home) || d === "/Users";
}

/** Khoá so sánh đường dẫn: NFC (macOS trả NFD) và chữ thường (APFS mặc định không phân biệt hoa thường). */
export function pathKey(p: string): string {
  return path.resolve(p).normalize("NFC").toLowerCase();
}

/** "Comp 1" hoặc id -> id comp; tên không có thì trả lỗi. */
export function resolveKeepComps(
  graph: ProjectGraph,
  keep?: Array<string | number> | null,
): { ids: number[]; names: string[] } | { error: string } {
  const comps = graph.items.filter((i) => i.kind === "comp");
  if (!keep || keep.length === 0) {
    const nested = new Set<number>();
    for (const c of comps) for (const s of c.sources ?? []) nested.add(s);
    const roots = comps.filter((c) => !nested.has(c.id));
    return { ids: roots.map((c) => c.id), names: roots.map((c) => c.name) };
  }
  const ids: number[] = [];
  const missing: string[] = [];
  for (const k of keep) {
    const hit =
      typeof k === "number"
        ? comps.find((c) => c.id === k)
        : (comps.find((c) => c.name === k) ?? comps.find((c) => fold(c.name) === fold(k)));
    if (hit) {
      if (!ids.includes(hit.id)) ids.push(hit.id);
    } else missing.push(String(k));
  }
  if (missing.length) return { error: `không có comp: ${missing.join(", ")}` };
  return { ids, names: ids.map((id) => comps.find((c) => c.id === id)!.name) };
}

export interface Usage {
  reachableComps: Set<number>;
  usedFootage: Set<number>;
}

/** Comp đi tới được từ comp bàn giao (đệ quy qua precomp) và footage chúng dùng. */
export function computeUsage(graph: ProjectGraph, keepIds: number[]): Usage {
  const byId = new Map(graph.items.map((i) => [i.id, i]));
  const reachableComps = new Set<number>();
  const usedFootage = new Set<number>();
  const stack = [...keepIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (reachableComps.has(id)) continue;
    const comp = byId.get(id);
    if (!comp || comp.kind !== "comp") continue;
    reachableComps.add(id);
    for (const s of comp.sources ?? []) {
      const it = byId.get(s);
      if (!it) continue;
      if (it.kind === "comp") stack.push(s);
      else if (it.kind === "footage") usedFootage.add(s);
    }
  }
  return { reachableComps, usedFootage };
}

/** "cảnh_00012.png" -> "cảnh_" (phần trước dãy số cuối) để nhận các frame cùng sequence. */
export function sequencePrefix(file: string): string {
  const base = path.basename(file, path.extname(file));
  return base.replace(/\d+$/, "").normalize("NFC").toLowerCase();
}

export interface UsedSet {
  /** pathKey của file đang dùng. */
  paths: Set<string>;
  /** Image sequence đang dùng: thư mục + tiền tố + đuôi. */
  sequences: Array<{ dir: string; prefix: string; ext: string }>;
  /** Proxy theo tên của footage đang dùng: "<thư mục nguồn>/proxies|<tên gốc>". */
  proxyNames: Set<string>;
}

/** "A001_Proxy.mov" -> "a001" (mẫu Premiere <tên>_Proxy). */
export function proxyStem(file: string): string {
  return path
    .basename(file, path.extname(file))
    .replace(/[_ -]proxy$/i, "")
    .normalize("NFC")
    .toLowerCase();
}

/** Khoá nhận proxy trong <thư mục nguồn>/Proxies của một file gốc. */
function proxyKey(sourceDir: string, stem: string): string {
  return `${pathKey(sourceDir)}/proxies|${stem}`;
}

/** File nằm trong thư mục Proxies cạnh nguồn -> khoá để so với file gốc; null nếu không phải. */
export function proxyKeyOf(file: string): string | null {
  const d = path.dirname(path.resolve(file));
  if (path.basename(d).toLowerCase() !== "proxies") return null;
  return proxyKey(path.dirname(d), proxyStem(file));
}

/**
 * Thư mục job: thư mục chứa project, hoặc thư mục cha nếu project nằm trong thư
 * mục con kiểu Project/Premiere/PR/AE/After Effects/Dự án. Chỉ file trong đây
 * mới được đưa vào Trash (khớp jobFolderFor của bản Premiere).
 */
export function jobFolderFor(projectPath: string): string {
  const dir = path.dirname(path.resolve(projectPath));
  return /^(project|projects|prproj|premiere|pr|ae|after effects|du an)$/.test(fold(path.basename(dir))) ? path.dirname(dir) : dir;
}

export function insideFolder(p: string, folder: string): boolean {
  const f = pathKey(folder).replace(/\/+$/, "") + "/";
  return pathKey(p).startsWith(f);
}

export function usedFiles(graph: ProjectGraph, usage: Usage): UsedSet {
  const paths = new Set<string>();
  const sequences: UsedSet["sequences"] = [];
  const proxyNames = new Set<string>();
  for (const it of graph.items) {
    if (it.kind !== "footage" || !usage.usedFootage.has(it.id)) continue;
    if (it.path) proxyNames.add(proxyKey(path.dirname(path.resolve(it.path)), proxyStem(it.path)));
    for (const p of [it.path, it.proxy]) {
      if (!p) continue;
      paths.add(pathKey(p));
      if (SEQUENCE_IMAGE.has(ext(p)) && (p === it.proxy || it.still === false))
        sequences.push({ dir: pathKey(path.dirname(p)), prefix: sequencePrefix(p), ext: ext(p) });
    }
  }
  return { paths, sequences, proxyNames };
}

export function isUsedPath(p: string, used: UsedSet): boolean {
  if (used.paths.has(pathKey(p))) return true;
  const pk = proxyKeyOf(p);
  if (pk && used.proxyNames.has(pk)) return true;
  const dir = pathKey(path.dirname(p));
  const e = ext(p);
  const pre = sequencePrefix(p);
  return used.sequences.some((s) => s.dir === dir && s.ext === e && s.prefix === pre);
}

/** Thư mục chứa footage đã import (dùng hay không) cộng thư mục con Proxies nếu có. */
export function sourceDirs(graph: ProjectGraph): string[] {
  const out = new Map<string, string>();
  for (const it of graph.items) {
    if (it.kind !== "footage") continue;
    for (const p of [it.path, it.proxy]) {
      if (!p) continue;
      const d = path.dirname(path.resolve(p));
      out.set(pathKey(d), d);
      const prox = path.join(d, "Proxies");
      out.set(pathKey(prox), prox);
    }
  }
  return [...out.values()];
}

/** File được phép đưa vào Trash: media, không phải project, không trong thư mục thành phẩm, không ẩn. */
export function isTrashable(p: string): boolean {
  const base = path.basename(p);
  return isMediaFile(p) && !isProjectFile(p) && !base.startsWith(".") && !isProtectedDir(path.dirname(p));
}

export interface ReportItem {
  id: number;
  name: string;
  path: string | null;
  ly_do: string;
}

export interface ReportFile {
  path: string;
  size: number;
  ly_do: string;
}

export interface CleanupReport {
  phien_ban: 1;
  app: "ae" | "pr";
  project: string | null;
  tao_luc: string;
  thu_muc_job: string | null;
  giu: string[];
  dang_dung: Array<{ path: string; size: number }>;
  xoa_khoi_project: ReportItem[];
  dua_vao_trash: ReportFile[];
  tong_dung_luong: number;
  canh_bao: string[];
}

function sizeOf(p: string): number | null {
  try {
    const s = statSync(p);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

function listDir(d: string): string[] {
  try {
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => path.join(d, e.name));
  } catch {
    return [];
  }
}

export interface ReviewOptions {
  keepComps?: Array<string | number> | null;
  now?: Date;
  home?: string;
  /** Ghi đè thư mục job (mặc định jobFolderFor(project)). */
  jobFolder?: string | null;
}

/** Toàn bộ phần review: item thừa trong project, file thừa trên ổ, cảnh báo. */
export function buildReport(graph: ProjectGraph, opts: ReviewOptions = {}): CleanupReport | { error: string } {
  const keep = resolveKeepComps(graph, opts.keepComps);
  if ("error" in keep) return keep;
  const usage = computeUsage(graph, keep.ids);
  const used = usedFiles(graph, usage);
  const warnings: string[] = [];
  const job = opts.jobFolder ? path.resolve(opts.jobFolder) : graph.project ? jobFolderFor(graph.project) : null;
  const inJob = (p: string) => !job || insideFolder(p, job);
  // Proxy theo tên của footage không dùng (để ghi lý do).
  const unusedProxyNames = new Set<string>();
  for (const it of graph.items)
    if (it.kind === "footage" && it.path && !usage.usedFootage.has(it.id))
      unusedProxyNames.add(proxyKey(path.dirname(path.resolve(it.path)), proxyStem(it.path)));

  // Item nào được comp nào chứa (để ghi lý do).
  const parents = new Map<number, string[]>();
  for (const c of graph.items) {
    if (c.kind !== "comp") continue;
    for (const s of new Set(c.sources ?? [])) {
      const arr = parents.get(s) ?? [];
      arr.push(c.name);
      parents.set(s, arr);
    }
  }

  const removeItems: ReportItem[] = [];
  const trash = new Map<string, ReportFile>();
  const dataKept: string[] = [];
  for (const it of graph.items) {
    if (it.kind !== "footage" || usage.usedFootage.has(it.id)) continue;
    if (it.path && isDataFile(it.path)) {
      dataKept.push(it.name);
      continue;
    }
    const inComps = parents.get(it.id);
    removeItems.push({
      id: it.id,
      name: it.name,
      path: it.path ?? null,
      ly_do:
        it.path && !inJob(it.path)
          ? "không dùng; file nằm ngoài thư mục job nên chỉ xoá khỏi project, giữ trên Mac"
          : inComps?.length
            ? `chỉ nằm trong comp không bàn giao: ${inComps.join(", ")}`
            : "không comp nào dùng",
    });
    for (const p of [it.path, it.proxy]) {
      if (!p || !inJob(p) || isUsedPath(p, used) || !isTrashable(p)) continue;
      const size = sizeOf(p);
      if (size === null) continue;
      const lyDo = p === it.proxy ? `proxy của file không dùng "${it.name}"` : `file của item không dùng "${it.name}"`;
      trash.set(pathKey(p), { path: path.resolve(p), size, ly_do: lyDo });
      if (it.still === false && SEQUENCE_IMAGE.has(ext(p))) {
        const pre = sequencePrefix(p);
        for (const f of listDir(path.dirname(p))) {
          if (ext(f) !== ext(p) || sequencePrefix(f) !== pre || trash.has(pathKey(f)) || isUsedPath(f, used)) continue;
          trash.set(pathKey(f), { path: f, size: sizeOf(f) ?? 0, ly_do: `frame của sequence không dùng "${it.name}"` });
        }
      }
    }
  }
  if (dataKept.length)
    warnings.push(`Giữ file dữ liệu dù không comp nào dùng trực tiếp (expression có thể đọc qua footage()): ${dataKept.join(", ")}`);

  const unreachable = graph.items.filter((i) => i.kind === "comp" && !usage.reachableComps.has(i.id));
  if (unreachable.length && removeItems.some((r) => r.ly_do.startsWith("chỉ nằm")))
    warnings.push(
      `Các comp không thuộc comp bàn giao (${unreachable.map((c) => c.name).join(", ")}) sẽ mất layer dùng footage bị xoá. Comp vẫn giữ lại.`,
    );

  // Quét ổ: file media chưa import, nằm ngay trong thư mục nguồn hoặc Proxies.
  const skippedShared: string[] = [];
  const otherProjects = new Set<string>();
  const ownProject = graph.project ? pathKey(graph.project) : null;
  for (const d of sourceDirs(graph)) {
    if (!existsSync(d) || isProtectedDir(d) || !inJob(d)) continue;
    if (isSharedDir(d, opts.home)) {
      skippedShared.push(d);
      continue;
    }
    for (const f of listDir(d)) {
      const k = pathKey(f);
      if (isProjectFile(f)) {
        if (k !== ownProject && !/ trước dọn\.aep$/i.test(f.normalize("NFC"))) otherProjects.add(f);
        continue;
      }
      if (trash.has(k) || !isTrashable(f) || isUsedPath(f, used)) continue;
      if (graph.items.some((i) => i.kind === "footage" && ((i.path && pathKey(i.path) === k) || (i.proxy && pathKey(i.proxy) === k)))) continue;
      const size = sizeOf(f);
      if (size === null) continue;
      const pk = proxyKeyOf(f);
      const lyDo = pk ? (unusedProxyNames.has(pk) ? "proxy của file không dùng" : "proxy không dùng trong thư mục nguồn") : "chưa import vào project";
      trash.set(k, { path: f, size, ly_do: lyDo });
    }
    // Project khác nằm ở thư mục cha cũng có thể dùng chung footage.
    for (const f of listDir(path.dirname(d))) {
      if (isProjectFile(f) && pathKey(f) !== ownProject && !/ trước dọn\.aep$/i.test(f.normalize("NFC"))) otherProjects.add(f);
    }
  }
  if (skippedShared.length)
    warnings.push(`Không quét file chưa import trong thư mục chung của máy: ${skippedShared.join(", ")}`);
  if (otherProjects.size)
    warnings.push(
      `Có project khác cạnh footage, file có thể đang dùng ở đó — kiểm tra trước khi xoá hẳn khỏi Trash: ${[...otherProjects].join(", ")}`,
    );

  const dang_dung: CleanupReport["dang_dung"] = [];
  const seen = new Set<string>();
  for (const it of graph.items) {
    if (it.kind !== "footage" || !usage.usedFootage.has(it.id)) continue;
    for (const p of [it.path, it.proxy]) {
      if (!p || seen.has(pathKey(p))) continue;
      seen.add(pathKey(p));
      dang_dung.push({ path: p, size: sizeOf(p) ?? 0 });
    }
  }

  const files = [...trash.values()].sort((a, b) => b.size - a.size);
  return {
    phien_ban: 1,
    app: "ae",
    project: graph.project,
    tao_luc: (opts.now ?? new Date()).toISOString(),
    thu_muc_job: job,
    giu: keep.names,
    dang_dung,
    xoa_khoi_project: removeItems,
    dua_vao_trash: files,
    tong_dung_luong: files.reduce((s, f) => s + f.size, 0),
    canh_bao: warnings,
  };
}

/** Thư mục báo cáo; MCP_ADOBE_DON_DEP_DIR đổi chỗ (dùng cho test). */
export function reportDir(): string {
  return process.env.MCP_ADOBE_DON_DEP_DIR || path.join(os.homedir(), "Library/Application Support/MCP Adobe/Don dep");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** "<tên project> yyyy-mm-dd HHMMSS.json" (giờ máy). */
export function reportFileName(project: string | null, now: Date): string {
  const base = project ? path.basename(project).replace(/\.(aep|aepx|prproj)$/i, "") : "Chưa lưu";
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${base.replace(/[\\/:*?"<>|]/g, " ")} ${stamp}.json`;
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

export function summarize(report: CleanupReport, reportPath?: string) {
  return {
    ...(reportPath ? { bao_cao: reportPath } : {}),
    project: report.project,
    thu_muc_job: report.thu_muc_job,
    giu: report.giu,
    so_item_xoa_khoi_project: report.xoa_khoi_project.length,
    so_file_dua_vao_trash: report.dua_vao_trash.length,
    giai_phong: formatBytes(report.tong_dung_luong),
    tong_dung_luong: report.tong_dung_luong,
    file_lon_nhat: report.dua_vao_trash.slice(0, 20).map((f) => ({ path: f.path, size: formatBytes(f.size), ly_do: f.ly_do })),
    item_xoa: report.xoa_khoi_project.slice(0, 50).map((i) => `${i.name} (${i.ly_do})`),
    canh_bao: report.canh_bao,
  };
}

/** Chia mảng thành lô cho osascript. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** AppleScript đưa danh sách file (argv) vào Trash bằng Finder. Đường dẫn đi qua argv nên không cần escape. */
export const FINDER_TRASH_SCRIPT = [
  "on run argv",
  "set L to {}",
  "repeat with p in argv",
  "set end of L to ((POSIX file (p as text)) as alias)",
  "end repeat",
  'tell application "Finder" to delete L',
  "return (count of L) as text",
  "end run",
];

/** Lỗi osascript -> câu dễ hiểu (đặc biệt khi macOS chặn quyền điều khiển Finder). */
export function explainOsascriptError(msg: string): string {
  if (/-1743|not authori[sz]ed|không được phép/i.test(msg))
    return "macOS chặn quyền điều khiển Finder (Automation). Mở System Settings > Privacy & Security > Automation, cho app đang chạy MCP (Claude) điều khiển Finder, rồi chạy lại. Không file nào bị xoá.";
  if (/-1728|can.t get|không thể lấy/i.test(msg)) return `Finder không tìm thấy file trong lô này: ${msg.trim()}`;
  return `Finder báo lỗi: ${msg.trim()}`;
}
