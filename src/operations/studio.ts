// Studio operations for a day-to-day motion-design workflow: checkpoints, expression and text QA, colour
// management setup, brand kits, data-driven comps, frame diffing and
// background rendering. Every op follows the registry contract: arguments
// reach ExtendScript only through jsxVal, failures return { ok: false }.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, promises as fs, readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

import { decodePng, encodePngSrgb8 } from "../color/png16.js";
import { PACKAGE_ROOT, rejectedOutputPath, resolveAfterFxPath } from "../config.js";
import { jsxCompPreamble, jsxFail, jsxVal, registerOp } from "../registry.js";

function nodeOnly(name: string): string {
  return jsxFail(`${name} runs on the MCP server side and cannot be used inside batch.run`);
}

// ---------------------------------------------------------------------------
// Checkpoints: save, then copy the .aep next to it. A real rollback point that
// survives beyond Cmd+Z (Premiere-style safety for large batches).
// ---------------------------------------------------------------------------

registerOp({
  name: "project.checkpoint",
  category: "project",
  description:
    "Save the project, then copy the saved .aep into a '<project> checkpoints' folder beside it with a timestamp and optional label. Take one before any large batch edit; restore by opening the copy (project.open). The open project path does not change.",
  params: [
    {
      name: "label",
      type: "string",
      description: "Short label added to the checkpoint file name, e.g. 'before brand apply'",
      required: false,
    },
  ],
  undoGroup: () => false,
  toJsx(args) {
    return `
            if (!app.project.file) return { ok: false, error: "project has never been saved — save it once (ae_save_project with a path) before taking checkpoints" };
            try { app.project.save(); } catch (eSave) { return { ok: false, error: "save failed: " + AE.errText(eSave) }; }
            var _src = app.project.file;
            var _base = _src.name.replace(/\\.aep$/i, "");
            var _dir = new Folder(_src.parent.fsName + "/" + _base + " checkpoints");
            if (!_dir.exists) _dir.create();
            var _d = new Date();
            function _p(n) { return (n < 10 ? "0" : "") + n; }
            var _stamp = _d.getFullYear() + "-" + _p(_d.getMonth() + 1) + "-" + _p(_d.getDate()) + " " + _p(_d.getHours()) + _p(_d.getMinutes()) + _p(_d.getSeconds());
            var _label = ${jsxVal(args.label ?? "")};
            _label = String(_label).replace(/[\\\\\\/:*?"<>|]/g, " ").replace(/^\\s+|\\s+$/g, "");
            var _name = _base + " " + _stamp + (_label ? " " + _label : "") + ".aep";
            var _dest = new File(_dir.fsName + "/" + _name);
            if (!_src.copy(_dest.fsName)) return { ok: false, error: "copy failed: " + _src.error };
            return { ok: true, checkpoint: _dest.fsName.replace(/\\\\/g, "/"), project: _src.fsName.replace(/\\\\/g, "/") };
        `;
  },
});

registerOp({
  name: "project.list_checkpoints",
  category: "project",
  readOnly: true,
  description:
    "List the checkpoints made by project.checkpoint for the open project, newest first.",
  params: [],
  toJsx() {
    return `
            if (!app.project.file) return { ok: true, checkpoints: [], note: "project not saved yet" };
            var _src = app.project.file;
            var _base = _src.name.replace(/\\.aep$/i, "");
            var _dir = new Folder(_src.parent.fsName + "/" + _base + " checkpoints");
            if (!_dir.exists) return { ok: true, checkpoints: [] };
            var _files = _dir.getFiles("*.aep");
            var _out = [];
            for (var _i = 0; _i < _files.length; _i++) {
                _out.push({ path: _files[_i].fsName.replace(/\\\\/g, "/"), name: _files[_i].name, modified: _files[_i].modified ? _files[_i].modified.getTime() : null });
            }
            _out.sort(function (a, b) { return (b.modified || 0) - (a.modified || 0); });
            return { ok: true, checkpoints: _out };
        `;
  },
});

// ---------------------------------------------------------------------------
// Expression sweep
// ---------------------------------------------------------------------------

registerOp({
  name: "expression.validate",
  category: "expression",
  readOnly: true,
  description:
    "Sweep a comp (or every comp) for expression errors: forces each enabled expression to evaluate at the sample times and reports properties whose expressionError is set, with layer, property path and error text.",
  params: [
    {
      name: "comp",
      type: "any",
      description: "Comp name or id; omit to check every comp in the project",
      required: false,
    },
    {
      name: "sampleTimes",
      type: "array",
      description: "Times in seconds to evaluate at (default: comp start, middle, end)",
      required: false,
    },
    {
      name: "maxResults",
      type: "number",
      description: "Stop after this many errors (default 200)",
      required: false,
      default: 200,
    },
  ],
  toJsx(args) {
    return `
            var _compArg = ${jsxVal(args.comp ?? null)};
            var _times = ${jsxVal(args.sampleTimes ?? null)};
            var _max = ${jsxVal(args.maxResults ?? 200)};
            var _comps = [];
            if (_compArg !== null) {
                var _c = AE.findCompByNameOrId(_compArg);
                if (!_c) return { ok: false, error: "no comp matching " + String(_compArg) };
                _comps.push(_c);
            } else {
                for (var _ii = 1; _ii <= app.project.numItems; _ii++) {
                    if (app.project.item(_ii) instanceof CompItem) _comps.push(app.project.item(_ii));
                }
            }
            var _errors = [];
            var _checked = 0;
            function _walk(comp, layer, group, pathArr) {
                for (var _pi = 1; _pi <= group.numProperties; _pi++) {
                    if (_errors.length >= _max) return;
                    var _p = group.property(_pi);
                    var _path = pathArr.concat([_p.name]);
                    if (_p.propertyType === PropertyType.PROPERTY) {
                        var _has = false;
                        try { _has = _p.canSetExpression && _p.expressionEnabled && _p.expression !== ""; } catch (eH) { _has = false; }
                        if (!_has) continue;
                        _checked++;
                        var _ts = _times;
                        if (_ts === null) _ts = [0, comp.duration / 2, Math.max(0, comp.duration - comp.frameDuration)];
                        for (var _ti = 0; _ti < _ts.length; _ti++) {
                            try { _p.valueAtTime(_ts[_ti], false); } catch (eV) { }
                        }
                        var _err = "";
                        try { _err = _p.expressionError; } catch (eE) { _err = ""; }
                        if (_err) _errors.push({ comp: comp.name, layer: layer.name, layerIndex: layer.index, property: _path, error: _err });
                    } else {
                        _walk(comp, layer, _p, _path);
                    }
                }
            }
            for (var _ci = 0; _ci < _comps.length; _ci++) {
                var _comp = _comps[_ci];
                for (var _li = 1; _li <= _comp.numLayers; _li++) {
                    if (_errors.length >= _max) break;
                    _walk(_comp, _comp.layer(_li), _comp.layer(_li), []);
                }
            }
            return { ok: true, compsChecked: _comps.length, expressionsChecked: _checked, errorCount: _errors.length, errors: _errors, truncated: _errors.length >= _max };
        `;
  },
});

// ---------------------------------------------------------------------------
// Text QA — Vietnamese diacritics, overflow, empty text
// ---------------------------------------------------------------------------

registerOp({
  name: "text.qa",
  category: "text",
  readOnly: true,
  description:
    "Check every text layer in a comp before delivery: font has glyphs for every character actually used (catches missing Vietnamese diacritics; AE 25.1+), text extending past the comp frame or outside the title-safe margin, empty text, and substituted (missing) fonts. Returns one entry per problem.",
  params: [
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "time",
      type: "number",
      description: "Time in seconds at which to measure bounds (default: comp middle)",
      required: false,
    },
    {
      name: "safeMargin",
      type: "number",
      description: "Title-safe margin as a fraction of width/height (default 0.05 = 5%)",
      required: false,
      default: 0.05,
    },
  ],
  toJsx(args) {
    return `
            ${jsxCompPreamble(args)}
            var _t = ${jsxVal(args.time ?? null)};
            if (_t === null) _t = _comp.duration / 2;
            var _m = ${jsxVal(args.safeMargin ?? 0.05)};
            var _issues = [];
            var _checked = 0;
            // sourcePointToComp reads the layer at the comp's current time,
            // not at _t: park the time indicator at _t while measuring.
            var _savedTime = _comp.time;
            try { _comp.time = _t; } catch (eTime) { }
            for (var _i = 1; _i <= _comp.numLayers; _i++) {
                var _l = _comp.layer(_i);
                if (!(_l instanceof TextLayer)) continue;
                _checked++;
                var _doc = null;
                try { _doc = _l.property("Source Text").valueAtTime(_t, false); } catch (eD) { _doc = null; }
                if (!_doc) continue;
                var _txt = String(_doc.text);
                if (_txt.replace(/\\s/g, "") === "") _issues.push({ layer: _l.name, index: _i, kind: "empty", detail: "text is empty" });
                var _fontObj = null;
                try { _fontObj = _doc.fontObject; } catch (eF) { _fontObj = null; }
                if (_fontObj) {
                    var _sub = false;
                    try { _sub = _fontObj.isSubstitute; } catch (eS) { _sub = false; }
                    if (_sub) _issues.push({ layer: _l.name, index: _i, kind: "missing_font", detail: "font " + _doc.font + " is substituted (not installed)" });
                    if (typeof _fontObj.hasGlyphsFor === "function" && _txt !== "") {
                        var _missing = [];
                        var _seen = {};
                        for (var _ci = 0; _ci < _txt.length; _ci++) {
                            var _ch = _txt.charAt(_ci);
                            if (_seen[_ch] || /\\s/.test(_ch)) continue;
                            _seen[_ch] = true;
                            var _ok = true;
                            try { _ok = _fontObj.hasGlyphsFor(_ch); } catch (eG) { _ok = true; }
                            if (!_ok) _missing.push(_ch);
                        }
                        if (_missing.length) _issues.push({ layer: _l.name, index: _i, kind: "missing_glyphs", detail: "font " + _doc.font + " lacks: " + _missing.join(" ") });
                    }
                }
                var _r = null;
                try { _r = _l.sourceRectAtTime(_t, false); } catch (eR) { _r = null; }
                if (_r && _r.width > 0) {
                    var _pts = [[_r.left, _r.top], [_r.left + _r.width, _r.top], [_r.left, _r.top + _r.height], [_r.left + _r.width, _r.top + _r.height]];
                    var _minX = 1e9, _minY = 1e9, _maxX = -1e9, _maxY = -1e9;
                    for (var _pi = 0; _pi < 4; _pi++) {
                        var _c = null;
                        try { _c = _l.sourcePointToComp ? _l.sourcePointToComp(_pts[_pi]) : null; } catch (eP) { _c = null; }
                        if (!_c) {
                            var _pos = _l.property("Transform").property("Position").valueAtTime(_t, false);
                            var _anc = _l.property("Transform").property("Anchor Point").valueAtTime(_t, false);
                            var _sc = _l.property("Transform").property("Scale").valueAtTime(_t, false);
                            _c = [_pos[0] + (_pts[_pi][0] - _anc[0]) * _sc[0] / 100, _pos[1] + (_pts[_pi][1] - _anc[1]) * _sc[1] / 100];
                        }
                        if (_c[0] < _minX) _minX = _c[0];
                        if (_c[1] < _minY) _minY = _c[1];
                        if (_c[0] > _maxX) _maxX = _c[0];
                        if (_c[1] > _maxY) _maxY = _c[1];
                    }
                    var _bounds = [Math.round(_minX), Math.round(_minY), Math.round(_maxX), Math.round(_maxY)];
                    if (_minX < 0 || _minY < 0 || _maxX > _comp.width || _maxY > _comp.height) {
                        _issues.push({ layer: _l.name, index: _i, kind: "off_frame", detail: "text runs outside the comp frame", bounds: _bounds });
                    } else if (_minX < _comp.width * _m || _minY < _comp.height * _m || _maxX > _comp.width * (1 - _m) || _maxY > _comp.height * (1 - _m)) {
                        _issues.push({ layer: _l.name, index: _i, kind: "outside_title_safe", detail: "text is inside the frame but outside the title-safe margin", bounds: _bounds });
                    }
                }
            }
            try { _comp.time = _savedTime; } catch (eRestore) { }
            return { ok: true, comp: _comp.name, time: _t, textLayersChecked: _checked, issueCount: _issues.length, issues: _issues };
        `;
  },
});

// ---------------------------------------------------------------------------
// Colour management — report and set up a project to match Premiere
// ---------------------------------------------------------------------------

registerOp({
  name: "color.report",
  category: "color",
  readOnly: true,
  description:
    "Report the project's colour settings (working space, bit depth, linear blending, colour engine) and the working-space profiles available, to diagnose colour shifts between After Effects renders and Premiere.",
  params: [],
  toJsx() {
    return `
            var _p = app.project;
            var _profiles = [];
            try { _profiles = _p.listColorProfiles(); } catch (eL) { _profiles = []; }
            return {
                ok: true,
                workingSpace: AE.safeGet(function () { return _p.workingSpace; }, null),
                bitsPerChannel: AE.safeGet(function () { return _p.bitsPerChannel; }, null),
                linearBlending: AE.safeGet(function () { return _p.linearBlending; }, null),
                linearizeWorkingSpace: AE.safeGet(function () { return _p.linearizeWorkingSpace; }, null),
                colorManagementSystem: AE.safeGet(function () { return _p.colorManagementSystem; }, null),
                workingGamma: AE.safeGet(function () { return _p.workingGamma; }, null),
                availableProfiles: _profiles
            };
        `;
  },
});

registerOp({
  name: "color.setup",
  category: "color",
  description:
    "Set the project's colour settings. preset 'premiere_rec709' = Rec.709 working space, 2.4 gamma, linear blending off (what Premiere expects for SDR delivery); 'none' = colour management off. Individual fields override the preset. Reports before and after.",
  params: [
    {
      name: "preset",
      type: "string",
      description: "premiere_rec709 | none (optional)",
      required: false,
    },
    {
      name: "workingSpace",
      type: "string",
      description:
        "Working space profile name or a distinctive part of it (matched against listColorProfiles), or 'None'",
      required: false,
    },
    { name: "bitsPerChannel", type: "number", description: "8 | 16 | 32", required: false },
    {
      name: "linearBlending",
      type: "boolean",
      description: "Blend colours using 1.0 gamma",
      required: false,
    },
    { name: "workingGamma", type: "number", description: "2.2 or 2.4 (AE 23+)", required: false },
  ],
  toJsx(args) {
    let ws = args.workingSpace as string | undefined;
    let lin = args.linearBlending as boolean | undefined;
    let gamma = args.workingGamma as number | undefined;
    if (args.preset === "premiere_rec709") {
      ws = ws ?? "709";
      lin = lin ?? false;
      gamma = gamma ?? 2.4;
    } else if (args.preset === "none") {
      ws = ws ?? "None";
    } else if (args.preset !== undefined) {
      return jsxFail("preset must be premiere_rec709 or none");
    }
    return `
            var _p = app.project;
            function _snap() {
                return {
                    workingSpace: AE.safeGet(function () { return _p.workingSpace; }, null),
                    bitsPerChannel: AE.safeGet(function () { return _p.bitsPerChannel; }, null),
                    linearBlending: AE.safeGet(function () { return _p.linearBlending; }, null),
                    workingGamma: AE.safeGet(function () { return _p.workingGamma; }, null)
                };
            }
            var _before = _snap();
            var _w = [];
            var _ws = ${jsxVal(ws ?? null)};
            if (_ws !== null) {
                var _target = null;
                if (_ws === "None" || _ws === "") { _target = "None"; }
                else {
                    var _list = [];
                    try { _list = _p.listColorProfiles(); } catch (eL) { _list = []; }
                    for (var _i = 0; _i < _list.length; _i++) { if (_list[_i] === _ws) { _target = _list[_i]; break; } }
                    if (_target === null) {
                        for (var _j = 0; _j < _list.length; _j++) { if (String(_list[_j]).toLowerCase().indexOf(String(_ws).toLowerCase()) >= 0) { _target = _list[_j]; break; } }
                    }
                }
                if (_target === null) _w.push("no working-space profile matches " + _ws);
                else { try { _p.workingSpace = _target; } catch (eW) { _w.push("workingSpace: " + AE.errText(eW)); } }
            }
            var _bpc = ${jsxVal(args.bitsPerChannel ?? null)};
            if (_bpc !== null) { try { _p.bitsPerChannel = _bpc; } catch (eB) { _w.push("bitsPerChannel: " + AE.errText(eB)); } }
            var _lin = ${jsxVal(lin ?? null)};
            if (_lin !== null) { try { _p.linearBlending = _lin; } catch (eLb) { _w.push("linearBlending: " + AE.errText(eLb)); } }
            var _g = ${jsxVal(gamma ?? null)};
            if (_g !== null) { try { _p.workingGamma = _g; } catch (eG) { _w.push("workingGamma: " + AE.errText(eG)); } }
            return { ok: true, before: _before, after: _snap(), warnings: _w };
        `;
  },
});

// ---------------------------------------------------------------------------
// Brand kits — stored as JSON files in "<package>/Brand kit/<name>.json"
// ---------------------------------------------------------------------------

export const KNOWLEDGE_ROOT =
  process.env.AE_MCP_KNOWLEDGE_DIR ?? path.join(PACKAGE_ROOT, "Kiến thức");

export const BRAND_DIR = process.env.AE_MCP_BRAND_DIR ?? path.join(PACKAGE_ROOT, "Brand kit");

export interface BrandKit {
  name: string;
  colors: Record<string, number[]>;
  fonts: Record<string, string>;
  logo?: string;
  notes?: string;
}

export function hexToRgb(v: unknown): number[] | null {
  if (Array.isArray(v) && v.length >= 3 && v.every((n) => typeof n === "number")) {
    const arr = v as number[];
    const scale = arr.some((n) => n > 1) ? 255 : 1;
    return arr.slice(0, 3).map((n) => Math.round((n / scale) * 10000) / 10000);
  }
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(
    (c) => Math.round((c / 255) * 10000) / 10000,
  );
}

function brandFile(name: string): string {
  const safe = name.replace(/[\\/:*?"<>|]/g, " ").trim();
  return path.join(BRAND_DIR, `${safe}.json`);
}

export function loadBrand(name: string): BrandKit | null {
  const f = brandFile(name);
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")) as BrandKit;
}

registerOp({
  name: "brand.save",
  category: "brand",
  readOnly: true,
  description:
    "Save (create or overwrite) a client brand kit: named colours (hex '#RRGGBB' or [r,g,b]), fonts by role (PostScript names, e.g. { heading: 'Montserrat-Bold', body: 'Montserrat-Regular' }), optional logo file path and notes. Stored on disk, not in the project.",
  params: [
    {
      name: "name",
      type: "string",
      description: "Brand / client name, e.g. 'KOI Resort'",
      required: true,
    },
    {
      name: "colors",
      type: "object",
      description: "{ primary: '#0E3B43', accent: '#C8A96A', ... }",
      required: true,
    },
    {
      name: "fonts",
      type: "object",
      description: "{ heading: 'PostScriptName', body: 'PostScriptName' }",
      required: false,
    },
    {
      name: "logo",
      type: "string",
      description: "Absolute path to the logo file",
      required: false,
    },
    {
      name: "notes",
      type: "string",
      description: "Usage notes (safe zones, do/don't)",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("brand.save"),
  async run(args) {
    const colors: Record<string, number[]> = {};
    for (const [k, v] of Object.entries((args.colors ?? {}) as Record<string, unknown>)) {
      const rgb = hexToRgb(v);
      if (!rgb) return { ok: false, error: `colour '${k}' must be '#RRGGBB' or [r,g,b]` };
      colors[k] = rgb;
    }
    const kit: BrandKit = {
      name: String(args.name),
      colors,
      fonts: (args.fonts ?? {}) as Record<string, string>,
      ...(args.logo ? { logo: String(args.logo) } : {}),
      ...(args.notes ? { notes: String(args.notes) } : {}),
    };
    mkdirSync(BRAND_DIR, { recursive: true });
    await fs.writeFile(brandFile(kit.name), JSON.stringify(kit, null, 2), "utf8");
    return { ok: true, saved: brandFile(kit.name), kit };
  },
});

registerOp({
  name: "brand.list",
  category: "brand",
  readOnly: true,
  description: "List saved brand kits.",
  params: [],
  toJsx: () => nodeOnly("brand.list"),
  async run() {
    if (!existsSync(BRAND_DIR)) return { ok: true, brands: [], folder: BRAND_DIR };
    const brands = readdirSync(BRAND_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    return { ok: true, brands, folder: BRAND_DIR };
  },
});

registerOp({
  name: "brand.get",
  category: "brand",
  readOnly: true,
  description: "Read one saved brand kit (colours as [r,g,b] 0-1, fonts by role, logo, notes).",
  params: [{ name: "name", type: "string", description: "Brand name", required: true }],
  toJsx: () => nodeOnly("brand.get"),
  async run(args) {
    const kit = loadBrand(String(args.name));
    if (!kit)
      return { ok: false, error: `no brand kit named '${String(args.name)}' in ${BRAND_DIR}` };
    return { ok: true, kit };
  },
});

registerOp({
  name: "brand.apply",
  category: "brand",
  description:
    "Apply a saved brand kit to a comp. colorMap maps colours currently in the comp to brand colour names ([{ from: '#FFFFFF' or [r,g,b], to: 'primary' }]) and recolours shape fills/strokes, text fill/stroke and solid sources that match. fontRoles maps text layer names to font roles ({ 'Title': 'heading' }); text layers not listed get the 'body' font when defaultFontRole is set. importLogo adds the kit's logo to a 'Brand' folder in the project.",
  params: [
    { name: "brand", type: "string", description: "Brand kit name", required: true },
    { name: "comp", type: "any", description: "Comp name or id", required: true },
    {
      name: "colorMap",
      type: "array",
      description: "[{ from, to: brandColourName }]",
      required: false,
    },
    { name: "fontRoles", type: "object", description: "{ layerName: fontRole }", required: false },
    {
      name: "defaultFontRole",
      type: "string",
      description: "Font role for text layers not named in fontRoles (omit to leave them)",
      required: false,
    },
    {
      name: "tolerance",
      type: "number",
      description: "Per-channel colour match tolerance 0-1 (default 0.02)",
      required: false,
      default: 0.02,
    },
    {
      name: "importLogo",
      type: "boolean",
      description: "Import the kit's logo file",
      required: false,
    },
  ],
  toJsx(args) {
    const kit = loadBrand(String(args.brand));
    if (!kit) return jsxFail(`no brand kit named '${String(args.brand)}' in ${BRAND_DIR}`);
    const map: Array<{ from: number[]; to: number[] }> = [];
    for (const [i, raw] of ((args.colorMap ?? []) as unknown[]).entries()) {
      const e = raw as { from?: unknown; to?: unknown };
      const from = hexToRgb(e?.from);
      const to = typeof e?.to === "string" ? (kit.colors[e.to] ?? hexToRgb(e.to)) : hexToRgb(e?.to);
      if (!from || !to)
        return jsxFail(
          `colorMap[${i}] needs from (hex or [r,g,b]) and to (brand colour name or hex)`,
        );
      map.push({ from, to });
    }
    const fontRoles = (args.fontRoles ?? {}) as Record<string, string>;
    const layerFonts: Record<string, string> = {};
    for (const [layerName, role] of Object.entries(fontRoles)) {
      const font = kit.fonts[role];
      if (!font) return jsxFail(`brand '${kit.name}' has no font for role '${role}'`);
      layerFonts[layerName] = font;
    }
    const defaultFont =
      typeof args.defaultFontRole === "string" ? (kit.fonts[args.defaultFontRole] ?? null) : null;
    if (typeof args.defaultFontRole === "string" && !defaultFont) {
      return jsxFail(`brand '${kit.name}' has no font for role '${args.defaultFontRole}'`);
    }
    const logo = args.importLogo === true ? (kit.logo ?? null) : null;
    if (args.importLogo === true && !logo)
      return jsxFail(`brand '${kit.name}' has no logo path saved`);
    return `
            ${jsxCompPreamble(args)}
            var _map = ${jsxVal(map)};
            var _tol = ${jsxVal(args.tolerance ?? 0.02)};
            var _layerFonts = ${jsxVal(layerFonts)};
            var _defaultFont = ${jsxVal(defaultFont)};
            var _logo = ${jsxVal(logo)};
            var _stats = { shapeColors: 0, textColors: 0, solids: 0, fonts: 0, logo: null };
            var _w = [];
            function _match(c) {
                for (var _mi = 0; _mi < _map.length; _mi++) {
                    var _f = _map[_mi].from;
                    if (Math.abs(c[0] - _f[0]) <= _tol && Math.abs(c[1] - _f[1]) <= _tol && Math.abs(c[2] - _f[2]) <= _tol) return _map[_mi].to;
                }
                return null;
            }
            function _recolorGroup(g) {
                for (var _gi = 1; _gi <= g.numProperties; _gi++) {
                    var _p = g.property(_gi);
                    if (_p.matchName === "ADBE Vector Graphic - Fill" || _p.matchName === "ADBE Vector Graphic - Stroke") {
                        var _col = _p.property("Color");
                        if (_col && _col.numKeys === 0 && !_col.expressionEnabled) {
                            var _to = _match(_col.value);
                            if (_to) { _col.setValue([_to[0], _to[1], _to[2], 1].slice(0, _col.value.length)); _stats.shapeColors++; }
                        }
                    } else if (_p.propertyType !== PropertyType.PROPERTY) {
                        _recolorGroup(_p);
                    }
                }
            }
            var _solidsSeen = {};
            for (var _i = 1; _i <= _comp.numLayers; _i++) {
                var _l = _comp.layer(_i);
                if (_map.length) {
                    if (_l instanceof ShapeLayer) {
                        try { _recolorGroup(_l.property("ADBE Root Vectors Group")); } catch (eS) { _w.push(_l.name + ": " + AE.errText(eS)); }
                    } else if (_l instanceof TextLayer) {
                        try {
                            var _st = _l.property("Source Text");
                            if (_st.numKeys === 0 && !_st.expressionEnabled) {
                                var _doc = _st.value;
                                var _changed = false;
                                if (_doc.applyFill) { var _tf = _match(_doc.fillColor); if (_tf) { _doc.fillColor = _tf; _changed = true; } }
                                if (_doc.applyStroke) { var _ts = _match(_doc.strokeColor); if (_ts) { _doc.strokeColor = _ts; _changed = true; } }
                                if (_changed) { _st.setValue(_doc); _stats.textColors++; }
                            }
                        } catch (eT) { _w.push(_l.name + ": " + AE.errText(eT)); }
                    } else if (_l.source && _l.source.mainSource && _l.source.mainSource instanceof SolidSource) {
                        if (!_solidsSeen[_l.source.id]) {
                            _solidsSeen[_l.source.id] = true;
                            var _sc = _match(_l.source.mainSource.color);
                            if (_sc) { _l.source.mainSource.color = _sc; _stats.solids++; }
                        }
                    }
                }
                if (_l instanceof TextLayer) {
                    var _font = _layerFonts.hasOwnProperty(_l.name) ? _layerFonts[_l.name] : _defaultFont;
                    if (_font) {
                        try {
                            var _sf = _l.property("Source Text");
                            if (_sf.numKeys === 0) { var _fd = _sf.value; _fd.font = _font; _sf.setValue(_fd); _stats.fonts++; }
                            else _w.push(_l.name + ": Source Text is keyframed, font left as is");
                        } catch (eF) { _w.push(_l.name + " font: " + AE.errText(eF)); }
                    }
                }
            }
            if (_logo) {
                try {
                    var _folder = AE.findFolder("Brand");
                    if (!_folder) _folder = app.project.items.addFolder("Brand");
                    var _io = new ImportOptions(new File(_logo));
                    var _item = app.project.importFile(_io);
                    _item.parentFolder = _folder;
                    _stats.logo = { id: _item.id, name: _item.name };
                } catch (eLg) { _w.push("logo import: " + AE.errText(eLg)); }
            }
            return { ok: true, comp: _comp.name, applied: _stats, warnings: _w };
        `;
  },
});

// ---------------------------------------------------------------------------
// Data-driven comps — one duplicate of a template comp per data row
// ---------------------------------------------------------------------------

registerOp({
  name: "data.to_comps",
  category: "data",
  description:
    "Build one comp per data row from a template comp: duplicates the template, renames it, sets the Source Text of named text layers and optionally swaps the footage of named layers. Rows: [{ name: 'Deluxe Room', texts: { 'Title': 'Deluxe Room', 'Price': '2.500.000đ' }, footage: { 'Photo': '/abs/path.jpg' } }]. Optionally queues each new comp for render with outputPath ({name} replaced). Use for menus, room lists, speaker names, price cards.",
  params: [
    { name: "template", type: "any", description: "Template comp name or id", required: true },
    { name: "rows", type: "array", description: "Data rows (see description)", required: true },
    {
      name: "folder",
      type: "string",
      description: "Project folder for the new comps (created if missing)",
      required: false,
    },
    {
      name: "queueRender",
      type: "boolean",
      description: "Add each new comp to the render queue",
      required: false,
    },
    {
      name: "outputPath",
      type: "string",
      description: "Absolute output path template for queued renders; {name} is replaced",
      required: false,
    },
    {
      name: "outputTemplate",
      type: "string",
      description: "Output module template name",
      required: false,
    },
  ],
  toJsx(args) {
    const rows = Array.isArray(args.rows) ? (args.rows as unknown[]) : [];
    if (rows.length === 0) return jsxFail("rows must be a non-empty array");
    for (const [i, r] of rows.entries()) {
      const row = r as { name?: unknown };
      if (!row || typeof row !== "object" || typeof row.name !== "string" || row.name === "") {
        return jsxFail(`rows[${i}] needs a non-empty string name`);
      }
    }
    if (args.queueRender === true && typeof args.outputPath !== "string") {
      return jsxFail("queueRender needs outputPath (absolute, with {name})");
    }
    if (typeof args.outputPath === "string") {
      if (!path.isAbsolute(args.outputPath)) return jsxFail("outputPath must be absolute");
      const rej = rejectedOutputPath(args.outputPath);
      if (rej !== null) return jsxFail(rej);
    }
    return `
            var _tpl = AE.findCompByNameOrId(${jsxVal(args.template)});
            if (!_tpl) return { ok: false, error: "no template comp matching " + String(${jsxVal(args.template)}) };
            var _rows = ${jsxVal(rows)};
            var _folderName = ${jsxVal(args.folder ?? null)};
            var _queue = ${jsxVal(args.queueRender === true)};
            var _outTpl = ${jsxVal(args.outputPath ?? null)};
            var _omTpl = ${jsxVal(args.outputTemplate ?? null)};
            var _folder = null;
            if (_folderName !== null) {
                _folder = AE.findFolder(_folderName);
                if (!_folder) _folder = app.project.items.addFolder(_folderName);
            }
            var _made = [];
            var _w = [];
            for (var _ri = 0; _ri < _rows.length; _ri++) {
                var _row = _rows[_ri];
                var _c = _tpl.duplicate();
                _c.name = _row.name;
                if (_folder) _c.parentFolder = _folder;
                var _texts = _row.texts || {};
                for (var _ln in _texts) {
                    if (!_texts.hasOwnProperty(_ln)) continue;
                    var _tl = null;
                    try { _tl = _c.layer(_ln); } catch (eL) { _tl = null; }
                    if (!_tl || !(_tl instanceof TextLayer)) { _w.push(_row.name + ": no text layer '" + _ln + "'"); continue; }
                    var _st = _tl.property("Source Text");
                    if (_st.numKeys > 0) { _w.push(_row.name + ": '" + _ln + "' Source Text is keyframed, skipped"); continue; }
                    var _doc = _st.value;
                    _doc.text = String(_texts[_ln]);
                    _st.setValue(_doc);
                }
                var _foot = _row.footage || {};
                for (var _fn in _foot) {
                    if (!_foot.hasOwnProperty(_fn)) continue;
                    var _fl = null;
                    try { _fl = _c.layer(_fn); } catch (eF) { _fl = null; }
                    if (!_fl || !_fl.source) { _w.push(_row.name + ": no footage layer '" + _fn + "'"); continue; }
                    try {
                        var _imp = app.project.importFile(new ImportOptions(new File(_foot[_fn])));
                        if (_folder) _imp.parentFolder = _folder;
                        _fl.replaceSource(_imp, false);
                    } catch (eI) { _w.push(_row.name + ": footage '" + _fn + "': " + AE.errText(eI)); }
                }
                var _entry = { name: _c.name, id: _c.id };
                if (_queue) {
                    var _rq = app.project.renderQueue.items.add(_c);
                    var _om = _rq.outputModule(1);
                    if (_omTpl !== null) { try { _om.applyTemplate(_omTpl); } catch (eT) { _w.push("output template: " + AE.errText(eT)); } }
                    var _safe = String(_row.name).replace(/[\\\\\\/:*?"<>|]/g, " ");
                    _om.file = new File(_outTpl.split("{name}").join(_safe));
                    _entry.output = _om.file.fsName.replace(/\\\\/g, "/");
                }
                _made.push(_entry);
            }
            return { ok: true, created: _made, warnings: _w };
        `;
  },
});

// ---------------------------------------------------------------------------
// Frame diff — compare two PNGs (before/after an edit), Node side
// ---------------------------------------------------------------------------

registerOp({
  name: "render.frame_diff",
  category: "render",
  readOnly: true,
  description:
    "Compare two PNG frames (e.g. ae_render_frame before and after an edit): changed-pixel ratio, mean and max absolute difference, bounding box of the changed region, and an optional heatmap PNG. Answers 'did my edit change anything, and where'.",
  params: [
    { name: "a", type: "string", description: "Absolute path of the first PNG", required: true },
    {
      name: "b",
      type: "string",
      description: "Absolute path of the second PNG (same size)",
      required: true,
    },
    {
      name: "threshold",
      type: "number",
      description: "Per-pixel difference (0-1, max over RGB) counted as changed (default 0.02)",
      required: false,
      default: 0.02,
    },
    {
      name: "heatmapPath",
      type: "string",
      description: "Absolute path to write a heatmap PNG",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("render.frame_diff"),
  async run(args) {
    const a = decodePng(await fs.readFile(String(args.a)));
    const b = decodePng(await fs.readFile(String(args.b)));
    if (a.width !== b.width || a.height !== b.height) {
      return { ok: false, error: `size differs: ${a.width}x${a.height} vs ${b.width}x${b.height}` };
    }
    const thr = typeof args.threshold === "number" ? args.threshold : 0.02;
    const n = a.width * a.height;
    let changed = 0;
    let sum = 0;
    let max = 0;
    let x0 = a.width;
    let y0 = a.height;
    let x1 = -1;
    let y1 = -1;
    const heat = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      const d = Math.max(
        Math.abs(a.rgb[i * 3] - b.rgb[i * 3]),
        Math.abs(a.rgb[i * 3 + 1] - b.rgb[i * 3 + 1]),
        Math.abs(a.rgb[i * 3 + 2] - b.rgb[i * 3 + 2]),
      );
      sum += d;
      if (d > max) max = d;
      const lum = (b.rgb[i * 3] + b.rgb[i * 3 + 1] + b.rgb[i * 3 + 2]) / 3;
      heat[i * 3] = heat[i * 3 + 1] = heat[i * 3 + 2] = lum * 0.35;
      if (d > thr) {
        changed++;
        const x = i % a.width;
        const y = Math.floor(i / a.width);
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
        heat[i * 3] = Math.min(1, 0.4 + d * 3);
        heat[i * 3 + 1] = 0.1;
        heat[i * 3 + 2] = 0.1;
      }
    }
    let heatmap: string | null = null;
    if (typeof args.heatmapPath === "string") {
      const rej = rejectedOutputPath(args.heatmapPath);
      if (rej !== null) return { ok: false, error: rej };
      await fs.mkdir(path.dirname(args.heatmapPath), { recursive: true });
      await fs.writeFile(args.heatmapPath, encodePngSrgb8(a.width, a.height, heat));
      heatmap = args.heatmapPath;
    }
    return {
      ok: true,
      size: [a.width, a.height],
      changedRatio: Math.round((changed / n) * 1e6) / 1e6,
      meanAbsDiff: Math.round((sum / n) * 1e6) / 1e6,
      maxAbsDiff: Math.round(max * 1e4) / 1e4,
      changedBbox: x1 >= 0 ? [x0, y0, x1, y1] : null,
      identical: changed === 0,
      heatmap,
    };
  },
});

// ---------------------------------------------------------------------------
// Background rendering with aerender — keeps After Effects free while it runs
// ---------------------------------------------------------------------------

interface BgJob {
  id: string;
  comp: string;
  output: string;
  started: number;
  ended: number | null;
  exitCode: number | null;
  progress: string | null;
  log: string[];
}

const jobs = new Map<string, BgJob>();

function aerenderPath(): string {
  if (process.env.AE_MCP_AERENDER) return process.env.AE_MCP_AERENDER;
  const afx = resolveAfterFxPath();
  // macOS: /Applications/Adobe After Effects 2026/Adobe After Effects 2026.app → sibling 'aerender'
  if (process.platform === "darwin") {
    const appDir = afx.includes(".app")
      ? path.dirname(afx.slice(0, afx.indexOf(".app") + 4))
      : path.dirname(afx);
    return path.join(appDir, "aerender");
  }
  return path.join(path.dirname(afx), "aerender.exe");
}

registerOp({
  name: "render.background",
  category: "render",
  readOnly: true,
  description:
    "Render a comp in the background with aerender (a separate process), so After Effects stays usable. Renders the project AS SAVED on disk — save first (ae_save_project). Returns a jobId; poll render.background_status. outputPath is absolute; renderTemplate / outputTemplate are AE template names (e.g. 'Best Settings', 'H.264 - Match Render Settings - 15 Mbps').",
  params: [
    {
      name: "projectPath",
      type: "string",
      description: "Absolute path of the saved .aep",
      required: true,
    },
    { name: "comp", type: "string", description: "Comp name", required: true },
    {
      name: "outputPath",
      type: "string",
      description: "Absolute output file path",
      required: true,
    },
    {
      name: "renderTemplate",
      type: "string",
      description: "Render settings template",
      required: false,
    },
    {
      name: "outputTemplate",
      type: "string",
      description: "Output module template",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("render.background"),
  async run(args) {
    const project = String(args.projectPath);
    const output = String(args.outputPath);
    if (!path.isAbsolute(project) || !existsSync(project))
      return { ok: false, error: `project not found: ${project}` };
    if (!path.isAbsolute(output)) return { ok: false, error: "outputPath must be absolute" };
    const rej = rejectedOutputPath(output);
    if (rej !== null) return { ok: false, error: rej };
    const bin = aerenderPath();
    if (!existsSync(bin)) {
      return {
        ok: false,
        error: `aerender not found at ${bin}`,
        hint: "Set AE_MCP_AERENDER to the aerender path",
      };
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    const argv = ["-project", project, "-comp", String(args.comp), "-output", output];
    if (typeof args.renderTemplate === "string") argv.push("-RStemplate", args.renderTemplate);
    if (typeof args.outputTemplate === "string") argv.push("-OMtemplate", args.outputTemplate);
    const job: BgJob = {
      id: randomUUID().slice(0, 8),
      comp: String(args.comp),
      output,
      started: Date.now(),
      ended: null,
      exitCode: null,
      progress: null,
      log: [],
    };
    const child = spawn(bin, argv, { stdio: ["ignore", "pipe", "pipe"] });
    const onData = (buf: Buffer) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (!line.trim()) continue;
        if (/PROGRESS:/i.test(line)) job.progress = line.replace(/^.*PROGRESS:\s*/i, "").trim();
        job.log.push(line);
        if (job.log.length > 200) job.log.shift();
      }
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("exit", (code) => {
      job.ended = Date.now();
      job.exitCode = code;
    });
    child.on("error", (err) => {
      job.ended = Date.now();
      job.exitCode = -1;
      job.log.push(`spawn error: ${err.message}`);
    });
    jobs.set(job.id, job);
    return { ok: true, jobId: job.id, aerender: bin, argv };
  },
});

registerOp({
  name: "render.background_status",
  category: "render",
  readOnly: true,
  description:
    "Status of background aerender jobs: running/done/failed, last progress line, elapsed seconds, last log lines. Omit jobId to list all jobs of this session.",
  params: [
    {
      name: "jobId",
      type: "string",
      description: "Job id from render.background",
      required: false,
    },
  ],
  toJsx: () => nodeOnly("render.background_status"),
  async run(args) {
    // aerender keeps the output module's own container: asking for x.mov
    // with an H.264 template writes x.mp4. Report the file that exists.
    const actual = (out: string): string | null => {
      if (existsSync(out)) return out;
      const dir = path.dirname(out);
      const stem = path.basename(out, path.extname(out));
      if (!existsSync(dir)) return null;
      const hit = readdirSync(dir).find((f) => path.basename(f, path.extname(f)) === stem);
      return hit ? path.join(dir, hit) : null;
    };
    const pick = (j: BgJob) => ({
      jobId: j.id,
      comp: j.comp,
      output: j.output,
      ...(j.ended !== null ? { writtenTo: actual(j.output) } : {}),
      state: j.ended === null ? "running" : j.exitCode === 0 ? "done" : "failed",
      exitCode: j.exitCode,
      progress: j.progress,
      elapsedSec: Math.round(((j.ended ?? Date.now()) - j.started) / 1000),
      lastLog: j.log.slice(-8),
    });
    if (typeof args.jobId === "string") {
      const j = jobs.get(args.jobId);
      if (!j) return { ok: false, error: `no job ${args.jobId} in this session` };
      return { ok: true, ...pick(j) };
    }
    return { ok: true, jobs: Array.from(jobs.values()).map(pick) };
  },
});

// ---------------------------------------------------------------------------
// Knowledge refresh — write the installed effect list into the knowledge base
// ---------------------------------------------------------------------------

registerOp({
  name: "knowledge.refresh_effects",
  category: "knowledge",
  readOnly: true,
  description:
    "Read every effect installed in After Effects (app.effects: display name, matchName, category — third-party plug-ins included) and write it to the knowledge base as 'Plugin đã cài/Hiệu ứng After Effects', grouped by category. Run after installing plug-ins; read it back with ae_guide.",
  params: [],
  toJsx: () => nodeOnly("knowledge.refresh_effects"),
  async run(_args, transport) {
    const res = await transport.execute({
      code: `
            var _out = [];
            for (var _i = 0; _i < app.effects.length; _i++) {
                var _e = app.effects[_i];
                _out.push({ name: _e.displayName, matchName: _e.matchName, category: _e.category });
            }
            return { ok: true, version: app.version, effects: _out };
        `,
      label: "knowledge.refresh_effects",
      undoGroup: false,
    });
    if (!res.ok) return { ok: false, error: res.error ?? "could not read app.effects" };
    const data = res.result as {
      version: string;
      effects: Array<{ name: string; matchName: string; category: string }>;
    };
    const byCat = new Map<string, string[]>();
    for (const e of data.effects) {
      const cat = e.category || "(no category)";
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat)!.push(`- ${e.name} — \`${e.matchName}\``);
    }
    const cats = Array.from(byCat.keys()).sort((a, b) => a.localeCompare(b));
    let md = `# After Effects effects — ${data.effects.length} installed effects (AE ${data.version})\n\nUse the matchName with effect.add. Updated ${new Date().toISOString()}.\n`;
    for (const c of cats) md += `\n## ${c}\n\n${byCat.get(c)!.sort().join("\n")}\n`;
    const dir = path.join(KNOWLEDGE_ROOT, "Plugin đã cài");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "Hiệu ứng After Effects.md");
    await fs.writeFile(file, md, "utf8");
    return { ok: true, written: file, effects: data.effects.length, categories: cats.length };
  },
});
