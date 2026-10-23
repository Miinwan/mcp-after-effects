// Premiere ↔ After Effects round trip, without Dynamic Link. The Premiere MCP
// (send_to_after_effects) writes a handoff JSON describing one timeline clip;
// bridge.from_premiere builds a matching comp from it, bridge.to_premiere
// renders that comp and records the file, and the Premiere MCP
// (return_from_after_effects) lays the render back on the timeline.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";

import { jsxFail, jsxVal, registerOp } from "../registry.js";

export const HANDOFF_DIR =
  process.env.MCP_ADOBE_BRIDGE_DIR ||
  path.join(homedir(), "Library", "Application Support", "MCP Adobe", "Cau noi PR AE");

export interface Handoff {
  version: 1;
  id: string;
  status: string;
  premiere: {
    sequenceName: string;
    clipName: string;
    timelineStart: number;
    timelineEnd: number;
    fps: number;
    width: number;
    height: number;
  };
  source: {
    mediaPath: string;
    inPoint: number;
    outPoint: number;
    handles: number;
    speed: number;
    motion: { position: number[] | null; scale: number | null; rotation: number | null };
  };
  ae?: {
    project?: string | null;
    compId?: number;
    compName?: string;
    renderPath?: string;
    renderedAt?: string;
    handleIn?: number;
  };
  note?: string;
}

function handoffFile(id: string): string {
  return id.endsWith(".json") ? id : path.join(HANDOFF_DIR, `${id}.json`);
}
export function readHandoff(id: string): Handoff | null {
  const f = handoffFile(id);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Handoff) : null;
}
function writeHandoff(h: Handoff): void {
  mkdirSync(HANDOFF_DIR, { recursive: true });
  writeFileSync(handoffFile(h.id), JSON.stringify(h, null, 2), "utf8");
}

/**
 * Comp geometry for a handoff. Premiere Motion position is normalised (0–1)
 * on recent versions and in pixels on older ones; the handles shrink when the
 * cut sits closer than that to the start of the media. Pure, for tests.
 */
export function compPlan(h: Handoff) {
  const cut = Math.max(0, h.premiere.timelineEnd - h.premiere.timelineStart);
  const speed = h.source.speed && h.source.speed > 0 ? h.source.speed : 1;
  // Whole frames only: Premiere snaps the in point of the render to frames,
  // so a handle of 1 s at 23.976 fps (23.976 frames) would slip one frame.
  const fd = 1 / h.premiere.fps;
  const handleIn = Math.floor(Math.min(h.source.handles, h.source.inPoint / speed) / fd + 1e-6) * fd;
  const handleOut = Math.floor(h.source.handles / fd + 1e-6) * fd;
  const pos = h.source.motion.position;
  let position: number[] | null = null;
  if (pos && pos.length >= 2) {
    const normalised = Math.abs(pos[0]) <= 2 && Math.abs(pos[1]) <= 2;
    position = normalised
      ? [pos[0] * h.premiere.width, pos[1] * h.premiere.height]
      : [pos[0], pos[1]];
  }
  const safe = h.premiere.clipName.replace(/[\\/:*?"<>|]/g, " ").trim();
  return {
    compName: `PR ${safe}`,
    width: Math.round(h.premiere.width),
    height: Math.round(h.premiere.height),
    fps: h.premiere.fps,
    duration: Math.round((handleIn + cut + handleOut) * 1000) / 1000,
    cut,
    handleIn: Math.round(handleIn * 1e6) / 1e6,
    // Comp time 0 shows source time inPoint − handleIn (in source seconds).
    layerStart: -(h.source.inPoint - handleIn * speed) / speed,
    stretch: 100 / speed,
    position,
    scale: h.source.motion.scale,
    rotation: h.source.motion.rotation,
    renderPath: path.join(HANDOFF_DIR, `${h.id} ${safe}.mov`),
  };
}

function nodeOnly(name: string): string {
  return jsxFail(`${name} runs on the MCP server side and cannot be used inside batch.run`);
}

registerOp({
  name: "bridge.from_premiere",
  category: "bridge",
  description:
    "Build an After Effects comp for a clip sent from Premiere (Premiere MCP send_to_after_effects → handoff id): same frame size and fps as the sequence, the source media placed so the cut matches frame for frame, Premiere's Motion position/scale/rotation carried over, extra handle seconds kept on both sides with markers 'Vào cắt' / 'Ra cắt' and the work area on the cut. The source's audio is switched off (Premiere keeps the original sound). " +
    "Do the effect work in this comp (anim.*, text.*, template.*…), then bridge.to_premiere.",
  params: [
    {
      name: "handoff",
      type: "string",
      description: "Handoff id from Premiere's send_to_after_effects",
      required: true,
    },
  ],
  toJsx: () => nodeOnly("bridge.from_premiere"),
  async run(args, transport) {
    const h = readHandoff(String(args.handoff));
    if (!h) return { ok: false, error: `no handoff ${String(args.handoff)} in ${HANDOFF_DIR}` };
    if (!existsSync(h.source.mediaPath))
      return { ok: false, error: `source media missing: ${h.source.mediaPath}` };
    const p = compPlan(h);
    const res = await transport.execute({
      label: "bridge.from_premiere",
      code: `
            var _p = ${jsxVal(p)};
            var _media = ${jsxVal(h.source.mediaPath)};
            var _item = null;
            for (var _i = 1; _i <= app.project.numItems; _i++) {
                var _it = app.project.item(_i);
                try { if (_it instanceof FootageItem && _it.file && _it.file.fsName === new File(_media).fsName) { _item = _it; break; } } catch (eF) { }
            }
            if (!_item) _item = app.project.importFile(new ImportOptions(new File(_media)));
            var _fold = AE.findFolder("Từ Premiere");
            if (!_fold) _fold = app.project.items.addFolder("Từ Premiere");
            _item.parentFolder = _fold;
            var _comp = app.project.items.addComp(_p.compName, _p.width, _p.height, 1, _p.duration, _p.fps);
            _comp.parentFolder = _fold;
            var _l = _comp.layers.add(_item);
            _l.startTime = _p.layerStart;
            if (Math.abs(_p.stretch - 100) > 0.01) _l.stretch = _p.stretch;
            _l.inPoint = 0;
            _l.outPoint = _p.duration;
            try { if (_l.hasAudio) _l.audioEnabled = false; } catch (eA) { }
            var _tg = _l.property("ADBE Transform Group");
            if (_p.position) _tg.property("ADBE Position").setValue(_p.position);
            if (_p.scale !== null) _tg.property("ADBE Scale").setValue([_p.scale, _p.scale]);
            if (_p.rotation !== null) _tg.property("ADBE Rotate Z").setValue(_p.rotation);
            _l.name = "Nguồn từ Premiere";
            var _mi = new MarkerValue("Vào cắt");
            _comp.markerProperty.setValueAtTime(_p.handleIn, _mi);
            var _mo = new MarkerValue("Ra cắt");
            _comp.markerProperty.setValueAtTime(_p.handleIn + _p.cut, _mo);
            _comp.workAreaStart = _p.handleIn;
            _comp.workAreaDuration = Math.max(_comp.frameDuration, _p.cut);
            _comp.openInViewer();
            _comp.time = _p.handleIn;
            return { ok: true, compId: _comp.id, compName: _comp.name, project: app.project.file ? app.project.file.fsName : null };
        `,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "AE call failed" };
    const r = res.result as {
      ok: boolean;
      error?: string;
      compId: number;
      compName: string;
      project: string | null;
    };
    if (!r.ok) return r;
    h.status = "in_ae";
    h.ae = {
      ...(h.ae ?? {}),
      project: r.project,
      compId: r.compId,
      compName: r.compName,
      handleIn: p.handleIn,
    };
    writeHandoff(h);
    return {
      ok: true,
      comp: r.compName,
      compId: r.compId,
      cut: { from: p.handleIn, to: p.handleIn + p.cut, seconds: p.cut },
      handles: { before: p.handleIn, after: h.source.handles },
      ...(h.note ? { brief: h.note } : {}),
      ...(Math.abs(p.stretch - 100) > 0.01
        ? {
            warning: `source plays at ${h.source.speed}× (layer stretch ${Math.round(p.stretch)} %)`,
          }
        : {}),
      next: `effect work in '${r.compName}', then bridge.to_premiere { handoff: "${h.id}" }`,
    };
  },
});

registerOp({
  name: "bridge.to_premiere",
  category: "bridge",
  description:
    "Render the comp made by bridge.from_premiere (the whole comp, handles included, so Premiere can still trim) to ProRes 4444 with alpha ('High Quality with Alpha', falling back to 'High Quality') next to the handoff, and record it for Premiere's return_from_after_effects. Rendering runs inside After Effects and blocks it until done (short clips: seconds). Re-run after more changes: the same file is overwritten and Premiere refreshes it.",
  params: [
    { name: "handoff", type: "string", description: "Handoff id", required: true },
    {
      name: "outputTemplate",
      type: "string",
      description: "Output module template (default 'High Quality with Alpha')",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("bridge.to_premiere"),
  async run(args, transport) {
    const h = readHandoff(String(args.handoff));
    if (!h) return { ok: false, error: `no handoff ${String(args.handoff)} in ${HANDOFF_DIR}` };
    if (!h.ae?.compId)
      return { ok: false, error: "this handoff has no comp yet — run bridge.from_premiere first" };
    const p = compPlan(h);
    mkdirSync(HANDOFF_DIR, { recursive: true });
    const res = await transport.execute({
      label: "bridge.to_premiere",
      timeoutMs: 30 * 60_000,
      undoGroup: false,
      code: `
            var _comp = AE.findItemById(${jsxVal(h.ae.compId)});
            if (!_comp || !(_comp instanceof CompItem)) return { ok: false, error: "comp " + ${jsxVal(h.ae.compName ?? "")} + " is gone from the open project" };
            var _out = new File(${jsxVal(p.renderPath)});
            try { if (_out.exists) _out.remove(); } catch (eRm) { }
            var _rq = app.project.renderQueue;
            var _ri = _rq.items.add(_comp);
            _ri.timeSpanStart = 0;
            _ri.timeSpanDuration = _comp.duration;
            var _om = _ri.outputModule(1);
            var _want = ${jsxVal(args.outputTemplate ?? "High Quality with Alpha")};
            var _used = null;
            var _tpls = _om.templates;
            var _cands = [_want, "High Quality with Alpha", "High Quality"];
            for (var _c = 0; _c < _cands.length && !_used; _c++) {
                for (var _t = 0; _t < _tpls.length; _t++) if (_tpls[_t] === _cands[_c]) { _om.applyTemplate(_cands[_c]); _used = _cands[_c]; break; }
            }
            _om.file = _out;
            // Only this item renders; anything else queued is left as it was.
            var _others = [];
            for (var _q = 1; _q <= _rq.numItems; _q++) {
                var _o = _rq.item(_q);
                if (_o !== _ri && _o.status === RQItemStatus.QUEUED) { _o.render = false; _others.push(_q); }
            }
            _rq.render();
            for (var _r = 0; _r < _others.length; _r++) { try { _rq.item(_others[_r]).render = true; } catch (eB) { } }
            var _written = _om.file ? _om.file.fsName : _out.fsName;
            try { _ri.remove(); } catch (eX) { }
            return { ok: true, file: _written, template: _used };
        `,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "render failed" };
    const r = res.result as { ok: boolean; error?: string; file: string; template: string | null };
    if (!r.ok) return r;
    if (!existsSync(r.file))
      return { ok: false, error: `After Effects reported done but ${r.file} does not exist` };
    h.status = "rendered";
    h.ae = {
      ...h.ae,
      renderPath: r.file,
      renderedAt: new Date().toISOString(),
      handleIn: p.handleIn,
    };
    writeHandoff(h);
    return {
      ok: true,
      file: r.file,
      template: r.template,
      next: `Premiere MCP: return_from_after_effects { handoff: "${h.id}" }`,
    };
  },
});
