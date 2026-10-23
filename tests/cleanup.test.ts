import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildReport,
  computeUsage,
  type GraphItem,
  insideFolder,
  isProtectedDir,
  jobFolderFor,
  proxyStem,
  isSharedDir,
  isTrashable,
  type ProjectGraph,
  reportFileName,
  resolveKeepComps,
  sequencePrefix,
} from "../src/cleanup.js";
import type { EvalRequest, EvalResult } from "../src/transport/AeTransport.js";
import { lintJsxFile } from "./helpers/lint-jsx.js";

process.env.MCP_ADOBE_DON_DEP_DIR = mkdtempSync(path.join(os.tmpdir(), "don-bao-cao-"));
const { getOp } = await import("../src/registry.js");
await import("../src/operations/index.js");
const { GRAPH_JSX } = await import("../src/operations/cleanup.js");

function job() {
  const root = mkdtempSync(path.join(os.tmpdir(), "don-"));
  const src = path.join(root, "Source");
  mkdirSync(path.join(src, "Proxies"), { recursive: true });
  mkdirSync(path.join(root, "Xuất file"), { recursive: true });
  const f = (rel: string, bytes = 10) => {
    const p = path.join(root, rel);
    writeFileSync(p, Buffer.alloc(bytes));
    return p;
  };
  const files = {
    used: f("Source/A001.mov", 100),
    usedProxy: f("Source/Proxies/A001_Proxy.mov", 20),
    nestedOnly: f("Source/B002.mov", 300),
    unusedItem: f("Source/C003.wav", 50),
    notImported: f("Source/D004.mp4", 400),
    orphanProxy: f("Source/Proxies/D004_Proxy.mov", 30),
    note: f("Source/ghi chú.txt", 5),
    data: f("Source/data.json", 5),
    hidden: f("Source/.DS_Store", 5),
    otherProject: f("Source/Bản cũ.prproj", 5),
    seq1: f("Source/seq_0001.png", 7),
    seq2: f("Source/seq_0002.png", 7),
    render: f("Xuất file/Final.mp4", 999),
    logo: f("Source/logo.png", 3),
    logoProxy: f("Source/Proxies/logo_Proxy.mov", 8),
    b002Proxy: f("Source/Proxies/B002_Proxy.mov", 60),
  };
  const sfxDir = mkdtempSync(path.join(os.tmpdir(), "soundly-"));
  const sfx = path.join(sfxDir, "Whoosh.wav");
  writeFileSync(sfx, Buffer.alloc(70));
  writeFileSync(path.join(sfxDir, "Other.wav"), Buffer.alloc(70));
  const items: GraphItem[] = [
    { id: 1, name: "Main", kind: "comp", sources: [2, 10, 20, 21] },
    { id: 2, name: "Pre used", kind: "comp", sources: [11] },
    { id: 3, name: "Old version", kind: "comp", sources: [12, 4] },
    { id: 4, name: "Pre of old", kind: "comp", sources: [13] },
    { id: 10, name: "A001.mov", kind: "footage", source: "file", path: files.used, proxy: files.usedProxy, still: true },
    { id: 11, name: "Solid", kind: "footage", source: "solid", path: null },
    { id: 12, name: "B002.mov", kind: "footage", source: "file", path: files.nestedOnly, still: true },
    { id: 13, name: "Solid old", kind: "footage", source: "solid", path: null },
    { id: 14, name: "C003.wav", kind: "footage", source: "file", path: files.unusedItem, still: true },
    { id: 15, name: "data.json", kind: "footage", source: "file", path: files.data, still: true },
    { id: 16, name: "Render cũ", kind: "footage", source: "file", path: files.render, still: true },
    { id: 20, name: "seq_[0001-0002].png", kind: "footage", source: "file", path: files.seq1, still: false },
    { id: 21, name: "logo.png", kind: "footage", source: "file", path: files.logo, still: true },
    { id: 22, name: "Whoosh.wav", kind: "footage", source: "file", path: sfx, still: true },
    { id: 30, name: "Folder", kind: "folder" },
  ];
  const graph: ProjectGraph = { project: path.join(root, "Job.aep"), items };
  return { root, files, graph, sfx };
}

describe("cleanup: usage", () => {
  it("default keep = comps not nested anywhere", () => {
    const { graph } = job();
    const k = resolveKeepComps(graph);
    expect(k).toEqual({ ids: [1, 3], names: ["Main", "Old version"] });
  });

  it("recursive: footage only reached through a non-delivered comp is unused", () => {
    const { graph } = job();
    const k = resolveKeepComps(graph, ["Main"]);
    expect(k).toEqual({ ids: [1], names: ["Main"] });
    const u = computeUsage(graph, [1]);
    expect([...u.reachableComps].sort()).toEqual([1, 2]);
    expect([...u.usedFootage].sort((a, b) => a - b)).toEqual([10, 11, 20, 21]);
    expect(resolveKeepComps(graph, ["Không có"])).toEqual({ error: "không có comp: Không có" });
    expect(resolveKeepComps(graph, [3, "main"])).toEqual({ ids: [3, 1], names: ["Old version", "Main"] });
  });
});

describe("cleanup: safety rules", () => {
  it("protected and shared folders", () => {
    expect(isProtectedDir("/a/Job/Xuất file")).toBe(true);
    expect(isProtectedDir("/a/Job/XUAT FILE/v2")).toBe(true);
    expect(isProtectedDir("/a/Job/Export")).toBe(true);
    expect(isProtectedDir("/a/Job/Render")).toBe(true);
    expect(isProtectedDir("/a/Job/Bàn giao")).toBe(true);
    expect(isProtectedDir("/a/Job/Edited")).toBe(true);
    expect(isProtectedDir("/a/Job/Deliverables")).toBe(true);
    expect(isProtectedDir("/a/Job/Final")).toBe(true);
    expect(isProtectedDir("/a/Job/Source")).toBe(false);
    expect(isProtectedDir("/a/Job/Rendering notes")).toBe(false);
    expect(isSharedDir("/Users/x/Desktop", "/Users/x")).toBe(true);
    expect(isSharedDir("/Users/x/Downloads", "/Users/x")).toBe(true);
    expect(isSharedDir("/Users/x", "/Users/x")).toBe(true);
    expect(isSharedDir("/Volumes/W.stu", "/Users/x")).toBe(true);
    expect(isSharedDir("/Users/x/Desktop/02. Work/Job/Source", "/Users/x")).toBe(false);
  });

  it("only media files outside protected folders are trashable", () => {
    expect(isTrashable("/j/Source/a.MOV")).toBe(true);
    expect(isTrashable("/j/Source/a.psd")).toBe(true);
    expect(isTrashable("/j/Source/a.ai")).toBe(true);
    expect(isTrashable("/j/Source/a.aep")).toBe(false);
    expect(isTrashable("/j/Source/a.prproj")).toBe(false);
    expect(isTrashable("/j/Source/a.txt")).toBe(false);
    expect(isTrashable("/j/Source/.hidden.mov")).toBe(false);
    expect(isTrashable("/j/Export/a.mov")).toBe(false);
    expect(sequencePrefix("/x/cảnh_00012.png")).toBe("cảnh_");
  });

  it("job folder = project folder, or its parent for Project/PR/AE subfolders", () => {
    expect(jobFolderFor("/w/Job/Job.aep")).toBe("/w/Job");
    expect(jobFolderFor("/w/Job/Project/Job.aep")).toBe("/w/Job");
    expect(jobFolderFor("/w/Job/After Effects/Job.aep")).toBe("/w/Job");
    expect(jobFolderFor("/w/Job/Dự án/Job.aep")).toBe("/w/Job");
    expect(jobFolderFor("/w/Job/PR/Job.prproj")).toBe("/w/Job");
    expect(insideFolder("/w/Job/Source/a.mov", "/w/Job")).toBe(true);
    expect(insideFolder("/w/Jobs/a.mov", "/w/Job")).toBe(false);
    expect(proxyStem("/x/Proxies/A001_Proxy.mov")).toBe("a001");
  });

  it("report file name", () => {
    const d = new Date(2026, 9, 23, 9, 5, 7);
    expect(reportFileName("/a/Job Acme.aep", d)).toBe("Job Acme 2026-10-23 090507.json");
  });
});

describe("cleanup: report", () => {
  it("lists unused items and surplus files, never used/protected/project files", () => {
    const { graph, files, root, sfx } = job();
    const r = buildReport(graph, { keepComps: ["Main"], now: new Date(0), home: "/nohome" });
    if ("error" in r) throw new Error(r.error);
    expect(r.phien_ban).toBe(1);
    expect(r.app).toBe("ae");
    expect(r.giu).toEqual(["Main"]);
    expect(r.thu_muc_job).toBe(root);
    expect(r.xoa_khoi_project.map((i) => i.id).sort((a, b) => a - b)).toEqual([12, 13, 14, 16, 22]);
    expect(r.xoa_khoi_project.find((i) => i.id === 22)!.ly_do).toBe(
      "không dùng; file nằm ngoài thư mục job nên chỉ xoá khỏi project, giữ trên Mac",
    );
    expect(r.xoa_khoi_project.find((i) => i.id === 12)!.ly_do).toContain("Old version");
    expect(r.xoa_khoi_project.find((i) => i.id === 14)!.ly_do).toBe("không comp nào dùng");

    const trash = r.dua_vao_trash.map((f) => f.path);
    expect(trash).toContain(files.nestedOnly);
    expect(trash).toContain(files.unusedItem);
    expect(trash).toContain(files.notImported);
    expect(trash).toContain(files.orphanProxy);
    expect(trash).toContain(files.b002Proxy);
    expect(r.dua_vao_trash.find((f) => f.path === files.b002Proxy)!.ly_do).toBe("proxy của file không dùng");
    expect(trash.some((p) => p.includes("soundly-"))).toBe(false);
    expect(trash).not.toContain(sfx);
    for (const keep of [files.logo, files.logoProxy, files.used, files.usedProxy, files.note, files.data, files.hidden, files.otherProject, files.seq1, files.seq2, files.render])
      expect(trash).not.toContain(keep);
    // Largest first, total = sum.
    expect(r.dua_vao_trash[0]!.path).toBe(files.notImported);
    expect(r.tong_dung_luong).toBe(300 + 50 + 400 + 30 + 60);
    expect(r.dang_dung.map((d) => d.path)).toEqual([files.used, files.usedProxy, files.seq1, files.logo]);
    expect(r.canh_bao.join("\n")).toContain("Bản cũ.prproj");
    expect(r.canh_bao.join("\n")).toContain("data.json");
    expect(r.canh_bao.join("\n")).toContain("Old version");
    expect(trash.every((p) => p.startsWith(path.join(root, "Source")))).toBe(true);
  });

  it("does not scan un-imported files in shared folders like Desktop", () => {
    const { graph, root } = job();
    const r2 = buildReport(graph, { keepComps: ["Main"], home: path.join(root, "Source") });
    if ("error" in r2) throw new Error(r2.error);
    expect(r2.dua_vao_trash.some((f) => f.ly_do === "chưa import vào project")).toBe(false);
    expect(r2.canh_bao.join("\n")).toContain("thư mục chung");
  });
});

function fakeTransport(graph: ProjectGraph) {
  const calls: EvalRequest[] = [];
  return {
    calls,
    async execute(req: EvalRequest): Promise<EvalResult> {
      calls.push(req);
      const result =
        req.label === "project.graph"
          ? { ok: true, ...graph }
          : req.label === "Dọn item không dùng"
            ? { ok: true, removed: [], failed: [] }
            : { ok: true };
      return { ok: true, result, error: null, errorCode: null, stack: null, logs: [], durationMs: 0 };
    },
  };
}

describe("cleanup ops", () => {
  it("graph JSX is valid ES3", () => {
    expect(() => new Function(GRAPH_JSX)).not.toThrow();
    const f = path.join(mkdtempSync(path.join(os.tmpdir(), "don-jsx-")), "graph.jsx");
    writeFileSync(f, GRAPH_JSX);
    expect(lintJsxFile(f).filter((x) => x.severity === "error")).toEqual([]);
  });

  it("review is read-only, server-side and writes the report", async () => {
    const op = getOp("project.review_unused")!;
    expect(op.readOnly).toBe(true);
    const { graph } = job();
    const t = fakeTransport(graph);
    const res = (await op.run!({ keepComps: "Main" }, t)) as { ok: boolean; bao_cao: string; so_item_xoa_khoi_project: number };
    expect(res.ok).toBe(true);
    expect(res.so_item_xoa_khoi_project).toBe(5);
    const saved = JSON.parse(readFileSync(res.bao_cao, "utf8"));
    expect(saved.project).toBe(graph.project);
    expect(t.calls.every((c) => c.undoGroup === false)).toBe(true);
  });

  it("clean refuses without confirm and touches nothing", async () => {
    const { graph } = job();
    const t = fakeTransport(graph);
    const rep = (await getOp("project.review_unused")!.run!({ keepComps: "Main" }, t)) as { bao_cao: string };
    t.calls.length = 0;
    const res = (await getOp("project.clean_unused")!.run!({ report: rep.bao_cao }, t)) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("confirm: true");
    expect(t.calls.length).toBe(0);
  });

  it("clean refuses a report of another project", async () => {
    const { graph } = job();
    const t = fakeTransport(graph);
    const rep = (await getOp("project.review_unused")!.run!({ keepComps: "Main" }, t)) as { bao_cao: string };
    const other = fakeTransport({ ...graph, project: "/khác/Khác.aep" });
    const res = (await getOp("project.clean_unused")!.run!({ report: rep.bao_cao, confirm: true }, other)) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("không phải project của báo cáo");
    expect(other.calls.length).toBe(1);
  });

  it("clean never trashes a file outside the job folder, even if the report lists it", async () => {
    const { graph, sfx } = job();
    const t = fakeTransport(graph);
    const rep = (await getOp("project.review_unused")!.run!({ keepComps: "Main" }, t)) as { bao_cao: string };
    const r = JSON.parse(readFileSync(rep.bao_cao, "utf8"));
    r.dua_vao_trash = [{ path: sfx, size: 70, ly_do: "sửa tay" }];
    writeFileSync(rep.bao_cao, JSON.stringify(r));
    const res = (await getOp("project.clean_unused")!.run!(
      { report: rep.bao_cao, confirm: true, removeFromProject: false },
      fakeTransport(graph),
    )) as { bo_qua: Array<{ path?: string; ly_do: string }> };
    expect(res.bo_qua).toEqual([{ loai: "file", path: sfx, ly_do: "nằm ngoài thư mục job, giữ trên Mac" }]);
  });

  it("clean re-checks usage: items now used are skipped, removal is one undo group", async () => {
    const { graph } = job();
    const t = fakeTransport(graph);
    const rep = (await getOp("project.review_unused")!.run!({ keepComps: "Main" }, t)) as { bao_cao: string };
    // Since the review, Main started using C003.wav.
    const now: ProjectGraph = {
      ...graph,
      items: graph.items.map((i) => (i.id === 1 ? { ...i, sources: [...i.sources!, 14] } : i)),
    };
    const t2 = fakeTransport(now);
    const res = (await getOp("project.clean_unused")!.run!({ report: rep.bao_cao, confirm: true, trashFiles: false }, t2)) as {
      da_xoa_khoi_project: Array<{ id: number }>;
      bo_qua: Array<{ id?: number; ly_do: string }>;
    };
    expect(res.da_xoa_khoi_project).toEqual([]); // fake transport removes nothing
    expect(res.bo_qua.find((s) => s.id === 14)!.ly_do).toBe("giờ đang được dùng");
    const removal = t2.calls.find((c) => c.label === "Dọn item không dùng")!;
    expect(removal.undoGroup).not.toBe(false);
    expect((removal.payload as { ids: number[] }).ids.sort((a, b) => a - b)).toEqual([12, 13, 16, 22]);
    expect(t2.calls[1]!.label).toBe("project.clean_unused checkpoint");
  });
});
