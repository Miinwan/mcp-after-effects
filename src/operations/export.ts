// render.export: one master render of a comp inside After Effects, then the
// platform deliverables from it with ffmpeg (src/deliverables.ts): YouTube,
// Reels/TikTok, feed 4:5, square, LED, review with watermark, ProRes master,
// PNG alpha. Files are named "<Khách> <Tên video> <Tỉ lệ> V<n>" and logged.

import { existsSync, mkdirSync } from "node:fs";
import * as path from "node:path";

import { exportJob, exportJobView, PRESETS, startExportJob, waitJob } from "../deliverables.js";
import { jsxFail, jsxVal, registerOp } from "../registry.js";

registerOp({
  name: "render.export",
  category: "render",
  description:
    `Export a comp for delivery: renders one master inside After Effects (ProRes 422 HQ, or ProRes 4444 with alpha when png_alpha is asked), then makes every requested deliverable from it with ffmpeg — ${Object.values(PRESETS)
      .map((p) => `${p.id} (${p.label})`)
      .join(", ")}. ` +
    "Sizes, bitrates and loudness follow 'Kiến thức/Xuất file.md'; files are named '<Client> <Title> <Aspect> V<n>' (next free version) in outputDir and each export is logged in 'Kết quả xuất.md' there with the measured LUFS. A comp of another aspect than the preset is letterboxed — make the 9:16 / 1:1 comp first. Blocks After Effects while the master renders.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    { name: "presets", type: "array", description: `Deliverables: ${Object.keys(PRESETS).join(", ")}`, required: true },
    { name: "client", type: "string", description: "Client name for the file name, e.g. 'Acme'", required: true },
    { name: "title", type: "string", description: "Video name for the file name, e.g. 'Launch teaser'", required: true },
    { name: "outputDir", type: "string", description: "Folder (default '<project folder>/Xuất file')", required: false },
    { name: "version", type: "number", description: "Force version number (default next free)", required: false },
    { name: "width", type: "number", description: "led: screen width in px", required: false },
    { name: "height", type: "number", description: "led: screen height in px", required: false },
    { name: "watermark", type: "string", description: "review: watermark text (default 'BẢN REVIEW')", required: false },
    { name: "waitSeconds", type: "number", description: "How long to wait for the encodes in this call (default 40); longer exports keep running — check with render.export_status", required: false },
  ],
  toJsx: () => jsxFail("render.export runs on the MCP server side"),
  async run(args, transport) {
    const ids = (args.presets as string[]) ?? [];
    const bad = ids.filter((i) => !PRESETS[i]);
    if (!ids.length || bad.length) return { ok: false, error: `presets must be some of ${Object.keys(PRESETS).join(", ")}${bad.length ? ` (unknown: ${bad.join(", ")})` : ""}` };
    const alpha = ids.includes("png_alpha");
    const res = await transport.execute({
      label: "render.export master",
      undoGroup: false,
      timeoutMs: 60 * 60_000,
      code: `
            var _comp = AE.findCompByNameOrId(${jsxVal(args.comp)});
            if (!_comp) return { ok: false, error: "no comp matching " + ${jsxVal(String(args.comp))} };
            var _dir = ${jsxVal(args.outputDir ?? null)};
            if (!_dir) {
                if (!app.project.file) return { ok: false, error: "save the project first or pass outputDir" };
                _dir = app.project.file.parent.fsName + "/Xuất file";
            }
            var _out = new File(_dir + "/.master/" + _comp.name.replace(/[\\\\\\/:*?"<>|]/g, " ") + ".mov");
            AE.ensureParentDir(_out.fsName);
            try { if (_out.exists) _out.remove(); } catch (eRm) { }
            var _rq = app.project.renderQueue;
            var _ri = _rq.items.add(_comp);
            var _om = _ri.outputModule(1);
            var _want = ${jsxVal(alpha ? "High Quality with Alpha" : "High Quality")};
            var _t = _om.templates, _used = null;
            for (var _i = 0; _i < _t.length; _i++) if (_t[_i] === _want) { _om.applyTemplate(_want); _used = _want; }
            _om.file = _out;
            var _off = [];
            for (var _q = 1; _q <= _rq.numItems; _q++) { var _o = _rq.item(_q); if (_o !== _ri && _o.status === RQItemStatus.QUEUED) { _o.render = false; _off.push(_q); } }
            _rq.render();
            for (var _r = 0; _r < _off.length; _r++) { try { _rq.item(_off[_r]).render = true; } catch (eB) { } }
            var _file = _om.file ? _om.file.fsName : _out.fsName;
            try { _ri.remove(); } catch (eX) { }
            return { ok: true, master: _file, dir: _dir, template: _used, size: [_comp.width, _comp.height], duration: _comp.duration };
        `,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "master render failed" };
    const m = res.result as { ok: boolean; error?: string; master: string; dir: string; template: string | null };
    if (!m.ok) return m;
    if (!existsSync(m.master)) return { ok: false, error: `master was not written: ${m.master}` };
    mkdirSync(m.dir, { recursive: true });
    const job = startExportJob(m.master, m.dir, ids, { client: String(args.client), title: String(args.title), version: args.version as number | undefined }, {
      width: args.width as number | undefined,
      height: args.height as number | undefined,
      watermark: args.watermark as string | undefined,
    });
    const view = await waitJob(job, ((args.waitSeconds as number | undefined) ?? 40) * 1000);
    return { ok: view.state !== "failed", master: m.master, masterTemplate: m.template, ...view, ...(view.state === "encoding" ? { next: `render.export_status { jobId: "${job.id}" }` } : {}) };
  },
});

registerOp({
  name: "render.export_status",
  category: "render",
  readOnly: true,
  description: "Progress of a render.export job: state (encoding / done / failed), the deliverable being encoded, finished files with measured LUFS. waitSeconds waits for it first.",
  params: [
    { name: "jobId", type: "string", description: "From render.export", required: true },
    { name: "waitSeconds", type: "number", description: "Wait up to this long for it to finish (default 0)", required: false },
  ],
  toJsx: () => jsxFail("render.export_status runs on the MCP server side"),
  async run(args) {
    const j = exportJob(String(args.jobId));
    if (!j) return { ok: false, error: `no export job ${String(args.jobId)} in this session` };
    return { ok: true, ...(await waitJob(j, ((args.waitSeconds as number | undefined) ?? 0) * 1000)) };
  },
});
