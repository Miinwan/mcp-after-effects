// Post-delivery project clean-up: project.review_unused (read-only, writes a
// report) and project.clean_unused (removes items from the project, moves
// surplus files to the Trash through Finder). The logic lives in
// src/cleanup.ts; this file reads the item graph from After Effects and acts.

import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

import {
  buildReport,
  chunk,
  computeUsage,
  type CleanupReport,
  explainOsascriptError,
  FINDER_TRASH_SCRIPT,
  formatBytes,
  insideFolder,
  isTrashable,
  jobFolderFor,
  isUsedPath,
  pathKey,
  type ProjectGraph,
  reportDir,
  reportFileName,
  resolveKeepComps,
  sourceDirs,
  summarize,
  usedFiles,
} from "../cleanup.js";
import { jsxFail, registerOp } from "../registry.js";
import type { AeTransport } from "../transport/AeTransport.js";

/** Sơ đồ item: comp nào chứa item nào, footage nào trỏ tới file nào. */
export const GRAPH_JSX = `
            var _items = [];
            for (var _i = 1; _i <= app.project.numItems; _i++) {
                var _it = app.project.item(_i);
                var _o = { id: _it.id, name: _it.name };
                if (_it instanceof CompItem) {
                    _o.kind = "comp";
                    _o.sources = [];
                    for (var _l = 1; _l <= _it.numLayers; _l++) {
                        try { var _s = _it.layer(_l).source; if (_s && _s.id) _o.sources.push(_s.id); } catch (eL) { }
                    }
                } else if (_it instanceof FootageItem) {
                    _o.kind = "footage";
                    var _ms = _it.mainSource;
                    _o.path = null;
                    if (_ms instanceof FileSource) {
                        _o.source = "file";
                        _o.missing = _it.footageMissing;
                        try { if (_it.file) _o.path = _it.file.fsName; } catch (eF) { }
                        if (!_o.path) { try { if (_ms.missingFootagePath) _o.path = _ms.missingFootagePath; } catch (eM) { } }
                        try { _o.still = _ms.isStill; } catch (eS) { }
                    } else if (_ms instanceof SolidSource) {
                        _o.source = "solid";
                    } else if (_ms instanceof PlaceholderSource) {
                        _o.source = "placeholder";
                    } else {
                        _o.source = "other";
                    }
                    _o.proxy = null;
                    try { if (_it.proxySource && _it.proxySource.file) _o.proxy = _it.proxySource.file.fsName; } catch (eP) { }
                } else {
                    _o.kind = "folder";
                }
                _items.push(_o);
            }
            return { ok: true, project: app.project.file ? app.project.file.fsName : null, items: _items };
        `;

async function readGraph(transport: AeTransport): Promise<ProjectGraph | { error: string }> {
  const res = await transport.execute({ label: "project.graph", code: GRAPH_JSX, undoGroup: false, timeoutMs: 120_000 });
  if (!res.ok) return { error: res.error ?? "không đọc được project" };
  const r = res.result as ProjectGraph & { ok: boolean; error?: string };
  if (!r.ok) return { error: r.error ?? "không đọc được project" };
  return { project: r.project, items: r.items };
}

function keepArg(v: unknown): Array<string | number> | null {
  if (v === undefined || v === null) return null;
  return Array.isArray(v) ? (v as Array<string | number>) : [v as string | number];
}

registerOp({
  name: "project.review_unused",
  category: "project",
  readOnly: true,
  description:
    "After a job is delivered: find footage (video, audio, stills, PSD, solids) that the delivered comps no longer use — computed recursively, so footage that only sits in precomps outside the delivered comps also counts as unused — and media files on disk that are surplus: scans the folders holding imported footage (not recursive) plus their Proxies sub-folder, picking files never imported or belonging to unused items. " +
    "Only files inside the job folder (the project's folder, or its parent when that folder is Project/Premiere/PR/AE/Dự án; override with jobFolder) go to the Trash; unused footage outside the job (SFX libraries, music libraries) is only removed from the project. Proxies follow their source: the proxy (proxySource or Proxies/<name>_Proxy) of unused footage goes to the Trash, the proxy of used footage stays. " + "Never proposes files in use, project files (.aep/.prproj), deliverable folders (Xuất file, Export, Render, Output, Final, Bàn giao…) or files outside the source folders; never scans un-imported files in Desktop/Downloads/home. Changes nothing. " +
    "Writes a JSON report to '~/Library/Application Support/MCP Adobe/Don dep/<project> <date time>.json' and returns a summary (item count, space freed, 20 largest files, warnings). Show it to the user before calling project.clean_unused { report, confirm: true }.",
  params: [
    {
      name: "keepComps",
      type: "any",
      description: "Delivered comps to keep (name, id or array). Default: every comp not nested in another comp",
      required: false,
    },
    {
      name: "jobFolder",
      type: "string",
      description:
        "Job folder (only files inside it go to the Trash). Default: the project's folder, or its parent when that folder is Project/Premiere/PR/AE/After Effects/Dự án",
      required: false,
    },
  ],
  toJsx: () => jsxFail("project.review_unused runs on the MCP server side"),
  async run(args, transport) {
    const graph = await readGraph(transport);
    if ("error" in graph) return { ok: false, error: graph.error };
    if (!graph.project) return { ok: false, error: "project chưa lưu — lưu project trước khi dọn" };
    const now = new Date();
    const report = buildReport(graph, { keepComps: keepArg(args.keepComps), now, jobFolder: (args.jobFolder as string | undefined) ?? null });
    if ("error" in report) return { ok: false, error: report.error };
    mkdirSync(reportDir(), { recursive: true });
    const file = path.join(reportDir(), reportFileName(graph.project, now));
    writeFileSync(file, JSON.stringify(report, null, 2));
    return {
      ok: true,
      ...summarize(report, file),
      next: "Cho anh xem tóm tắt. Anh đồng ý thì project.clean_unused { report, confirm: true }",
    };
  },
});

function loadReport(p: string): CleanupReport | { error: string } {
  if (!existsSync(p)) return { error: `không có báo cáo ${p}` };
  try {
    const r = JSON.parse(readFileSync(p, "utf8")) as CleanupReport;
    if (r.phien_ban !== 1 || r.app !== "ae" || !Array.isArray(r.xoa_khoi_project) || !Array.isArray(r.dua_vao_trash))
      return { error: "báo cáo không phải của project.review_unused (After Effects)" };
    return r;
  } catch (e) {
    return { error: `không đọc được báo cáo: ${(e as Error).message}` };
  }
}

/** Đưa file vào Trash bằng Finder, theo lô. Không dùng rm, không xoá vĩnh viễn. */
async function finderTrash(files: string[]): Promise<{ trashed: string[]; failed: Array<{ path: string; ly_do: string }>; blocked?: string }> {
  const trashed: string[] = [];
  const failed: Array<{ path: string; ly_do: string }> = [];
  for (const batch of chunk(files, 40)) {
    const err = await new Promise<string | null>((resolve) => {
      execFile(
        "osascript",
        [...FINDER_TRASH_SCRIPT.flatMap((l) => ["-e", l]), ...batch],
        { timeout: 120_000 },
        (e, _out, stderr) => resolve(e ? stderr || e.message : null),
      );
    });
    for (const f of batch) {
      if (!existsSync(f)) trashed.push(f);
      else failed.push({ path: f, ly_do: err ? explainOsascriptError(err) : "Finder không đưa được vào Trash" });
    }
    if (err && /-1743|not authori[sz]ed/i.test(err)) {
      return { trashed, failed, blocked: explainOsascriptError(err) };
    }
  }
  return { trashed, failed };
}

registerOp({
  name: "project.clean_unused",
  category: "project",
  description:
    "Carry out a project.review_unused report. Requires confirm: true (the user has seen the report and agreed); without it the report is only repeated. " +
    "Saves a checkpoint '<project> <date time> trước dọn.aep' next to the project, re-checks usage at run time (skipping items/files that are now used or gone), removes items from the project in one undo group and saves, then moves files to the Trash through Finder (the user empties the Trash; nothing is deleted permanently). " +
    "Returns what was removed, what went to the Trash, and what was skipped and why.",
  params: [
    { name: "report", type: "string", description: "Path of the JSON report from project.review_unused", required: true },
    { name: "removeFromProject", type: "boolean", description: "Remove items from the project (default true)", required: false },
    { name: "trashFiles", type: "boolean", description: "Move files to the Trash (default true)", required: false },
    { name: "confirm", type: "boolean", description: "Must be true: the user has seen the report and agreed to the clean-up", required: false },
  ],
  undoGroup: () => false,
  toJsx: () => jsxFail("project.clean_unused runs on the MCP server side"),
  async run(args, transport) {
    const reportPath = String(args.report);
    const report = loadReport(reportPath);
    if ("error" in report) return { ok: false, error: report.error };
    if (args.confirm !== true)
      return {
        ok: false,
        error: "Chưa dọn gì. Cho anh xem báo cáo; anh đồng ý thì gọi lại với confirm: true.",
        ...summarize(report, reportPath),
      };
    const removeItems = args.removeFromProject !== false;
    const trashFiles = args.trashFiles !== false;

    const graph = await readGraph(transport);
    if ("error" in graph) return { ok: false, error: graph.error };
    if (!graph.project || !report.project || pathKey(graph.project) !== pathKey(report.project))
      return { ok: false, error: `project đang mở (${graph.project ?? "chưa lưu"}) không phải project của báo cáo (${report.project})` };

    // Mức dùng ngay lúc này, theo đúng comp bàn giao trong báo cáo.
    const keep = resolveKeepComps(graph, report.giu);
    if ("error" in keep) return { ok: false, error: `${keep.error} — chạy lại project.review_unused` };
    const usage = computeUsage(graph, keep.ids);
    const used = usedFiles(graph, usage);
    const present = new Map(graph.items.map((i) => [i.id, i]));
    const dirs = new Set(sourceDirs(graph).map(pathKey));
    const job = report.thu_muc_job ?? jobFolderFor(graph.project);

    const skipped: Array<{ loai: "item" | "file"; id?: number; path?: string; name?: string; ly_do: string }> = [];
    const toRemove: Array<{ id: number; name: string }> = [];
    if (removeItems) {
      for (const it of report.xoa_khoi_project) {
        const now = present.get(it.id);
        if (!now || now.kind !== "footage") skipped.push({ loai: "item", id: it.id, name: it.name, ly_do: "không còn trong project" });
        else if (usage.usedFootage.has(it.id)) skipped.push({ loai: "item", id: it.id, name: it.name, ly_do: "giờ đang được dùng" });
        else toRemove.push({ id: it.id, name: now.name });
      }
    }
    const toTrash: Array<{ path: string; size: number }> = [];
    if (trashFiles) {
      for (const f of report.dua_vao_trash) {
        if (!existsSync(f.path)) skipped.push({ loai: "file", path: f.path, ly_do: "không còn tồn tại" });
        else if (isUsedPath(f.path, used)) skipped.push({ loai: "file", path: f.path, ly_do: "giờ đang được dùng" });
        else if (!insideFolder(f.path, job))
          skipped.push({ loai: "file", path: f.path, ly_do: "nằm ngoài thư mục job, giữ trên Mac" });
        else if (!isTrashable(f.path) || !dirs.has(pathKey(path.dirname(f.path))))
          skipped.push({ loai: "file", path: f.path, ly_do: "không nằm trong thư mục nguồn của project hoặc thuộc thư mục được giữ" });
        else toTrash.push({ path: f.path, size: f.size });
      }
    }
    if (!toRemove.length && !toTrash.length) return { ok: true, nothing: "Không còn gì để dọn", bo_qua: skipped };

    // Checkpoint cạnh project trước mọi thay đổi.
    const cp = await transport.execute({
      label: "project.clean_unused checkpoint",
      undoGroup: false,
      code: `
            if (!app.project.file) return { ok: false, error: "project chưa lưu" };
            try { app.project.save(); } catch (eSave) { return { ok: false, error: "lưu project lỗi: " + AE.errText(eSave) }; }
            var _src = app.project.file;
            var _d = new Date();
            function _p(n) { return (n < 10 ? "0" : "") + n; }
            var _stamp = _d.getFullYear() + "-" + _p(_d.getMonth() + 1) + "-" + _p(_d.getDate()) + " " + _p(_d.getHours()) + _p(_d.getMinutes()) + _p(_d.getSeconds());
            var _dest = new File(_src.parent.fsName + "/" + _src.name.replace(/\\.aep$/i, "") + " " + _stamp + " trước dọn.aep");
            if (!_src.copy(_dest.fsName)) return { ok: false, error: "chép checkpoint lỗi: " + _src.error };
            return { ok: true, checkpoint: _dest.fsName };
        `,
    });
    const cpr = (cp.ok ? cp.result : { ok: false, error: cp.error }) as { ok: boolean; error?: string; checkpoint?: string };
    if (!cpr.ok) return { ok: false, error: `không lưu được checkpoint, chưa dọn gì: ${cpr.error}` };

    let removed: Array<{ id: number; name: string }> = [];
    let saved = false;
    if (toRemove.length) {
      const res = await transport.execute({
        label: "Dọn item không dùng",
        payload: { ids: toRemove.map((r) => r.id) },
        code: `
            var _ids = payload.ids, _done = [], _fail = [];
            for (var _i = 0; _i < _ids.length; _i++) {
                var _it = app.project.itemByID(_ids[_i]);
                if (!_it) { _fail.push({ id: _ids[_i], error: "không còn" }); continue; }
                try { _it.remove(); _done.push(_ids[_i]); } catch (eR) { _fail.push({ id: _ids[_i], error: AE.errText(eR) }); }
            }
            return { ok: true, removed: _done, failed: _fail };
        `,
      });
      if (!res.ok) return { ok: false, error: `xoá item lỗi: ${res.error}`, checkpoint: cpr.checkpoint };
      const r = res.result as { removed: number[]; failed: Array<{ id: number; error: string }> };
      const done = new Set(r.removed);
      removed = toRemove.filter((t) => done.has(t.id));
      for (const f of r.failed) skipped.push({ loai: "item", id: f.id, name: toRemove.find((t) => t.id === f.id)?.name, ly_do: f.error });
      const sv = await transport.execute({
        label: "project.clean_unused save",
        undoGroup: false,
        code: `try { app.project.save(); } catch (eSave) { return { ok: false, error: AE.errText(eSave) }; } return { ok: true };`,
      });
      saved = sv.ok && (sv.result as { ok: boolean }).ok;
    }

    let trashed: Array<{ path: string; size: number }> = [];
    let blocked: string | undefined;
    if (toTrash.length) {
      const t = await finderTrash(toTrash.map((f) => f.path));
      const ok = new Set(t.trashed);
      trashed = toTrash.filter((f) => ok.has(f.path));
      for (const f of t.failed) skipped.push({ loai: "file", path: f.path, ly_do: f.ly_do });
      blocked = t.blocked;
    }
    const freed = trashed.reduce((s, f) => s + f.size, 0);
    return {
      ok: !blocked,
      ...(blocked ? { error: blocked } : {}),
      checkpoint: cpr.checkpoint,
      da_luu_project: saved,
      da_xoa_khoi_project: removed,
      da_dua_vao_trash: trashed.map((f) => ({ path: f.path, size: formatBytes(f.size) })),
      giai_phong: formatBytes(freed),
      bo_qua: skipped,
      note: "File nằm trong Trash; anh kiểm tra rồi tự xoá. Cmd+Z trong After Effects hoàn tác bước xoá item (hoặc mở checkpoint).",
    };
  },
});
