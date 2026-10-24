// Measured easing — keyframe.fit_curve writes bezier keys fitted to a source
// curve (spring, back, expo, bounce, cubic-bezier, or sampled values), and
// keyframe.verify_curve samples what AE actually plays and measures the
// error against that source. The maths lives in ../ease-fit.ts (Node side);
// the JSX only scales the normalised keys to the property and writes them.

import {
  compareCurves,
  fitMove,
  fitSamples,
  frameWindow,
  interpSamples,
  resolveCurve,
  type CurveFn,
  type FitResult,
} from "../ease-fit.js";
import {
  jsxCompLayerPreamble,
  jsxCompPreamble,
  jsxFail,
  jsxVal,
  registerOp,
  type OperationParam,
} from "../registry.js";
import type { AeTransport } from "../transport/AeTransport.js";

const CURVE_DOC =
  "Source curve: a name (springElegant, springSnappy, outBack, outBackSoft, outCubic, inOutCubic, outExpo, inOutExpo, outQuad, gravity, inOutSine, outBounce, linear, ease-in-out …), 'cubic-bezier(x1,y1,x2,y2)', or { type: 'spring', damping, frequency } (1 − e^(−damping·u)·cos(frequency·u)), { type: 'back', overshoot }, { type: 'cubicBezier', x1, y1, x2, y2 }";

const SHARED: OperationParam[] = [
  { name: "comp", type: "any", description: "Comp name or id", required: true },
  {
    name: "property",
    type: "array",
    description:
      'Property path, e.g. ["Transform","Scale"] or ["Effects","Slider Control","Slider"]',
    required: true,
  },
  {
    name: "curve",
    type: "any",
    description: `${CURVE_DOC}. Give this or samples.`,
    required: false,
  },
  {
    name: "samples",
    type: "object",
    description:
      "{ times: [s…], values: [n…] } — ONE move of a 1-D channel sampled densely (≥ 4 per frame) from the generating code or a track. Give this or curve.",
    required: false,
  },
  {
    name: "t0",
    type: "number",
    description: "Move start in comp time (s), with curve",
    required: false,
  },
  {
    name: "dur",
    type: "number",
    description:
      "Move length (s), with curve. For a spring this is the SETTLING window of the source (the spring reaches the target at about 20 % of it), not the travel time.",
    required: false,
  },
  {
    name: "from",
    type: "any",
    description:
      "Value at the start (number or array). Default: the property's value at the first frame.",
    required: false,
  },
  {
    name: "fps",
    type: "number",
    description: "Frame rate the keys snap to (default: the comp's)",
    required: false,
  },
];

interface Source {
  mode: "curve" | "samples";
  f?: CurveFn;
  t0: number;
  dur: number;
  times?: number[];
  values?: number[];
}

/** Validate curve / samples / t0 / dur into one source, or an error string. */
function readSource(args: Record<string, unknown>): Source | string {
  const hasCurve = args.curve !== undefined && args.curve !== null;
  const hasSamples = args.samples !== undefined && args.samples !== null;
  if (hasCurve === hasSamples) return "give exactly one of curve or samples";
  if (hasSamples) {
    const s = args.samples as { times?: unknown; values?: unknown };
    const times = s.times;
    const values = s.values;
    if (!Array.isArray(times) || !Array.isArray(values) || times.length !== values.length)
      return "samples must be { times: number[], values: number[] } of the same length";
    if (times.length < 4) return "samples need at least 4 points";
    if (!times.every((x) => typeof x === "number") || !values.every((x) => typeof x === "number"))
      return "samples.times and samples.values must be numbers";
    for (let i = 1; i < times.length; i++)
      if (!((times[i] as number) > (times[i - 1] as number)))
        return "samples.times must be strictly increasing";
    const t0 = times[0] as number;
    return {
      mode: "samples",
      t0,
      dur: (times[times.length - 1] as number) - t0,
      times: times as number[],
      values: values as number[],
    };
  }
  const f = resolveCurve(args.curve);
  if (typeof f === "string") return f;
  if (typeof args.t0 !== "number" || typeof args.dur !== "number")
    return "curve needs t0 and dur (seconds)";
  if (!(args.dur > 0)) return "dur must be > 0";
  return { mode: "curve", f, t0: args.t0, dur: args.dur };
}

function isNumOrNums(v: unknown): boolean {
  return (
    typeof v === "number" ||
    (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number"))
  );
}

/** Read the comp frame rate (a plain read: no undo group). */
async function compFps(
  transport: AeTransport,
  comp: unknown,
): Promise<{ fps: number } | { error: string }> {
  const res = await transport.execute({
    label: "keyframe.comp_fps",
    undoGroup: false,
    code: `${jsxCompPreamble({ comp })}
            return { ok: true, fps: _comp.frameRate };`,
  });
  if (!res.ok) return { error: res.error ?? "AE call failed" };
  const r = res.result as { ok: boolean; error?: string; fps?: number };
  if (!r.ok || typeof r.fps !== "number") return { error: r.error ?? "could not read the comp" };
  return { fps: r.fps };
}

const nodeOnly = (name: string) =>
  jsxFail(`${name} without fps runs on the MCP server side; pass fps to use it inside batch.run`);

// ---------------------------------------------------------------------------
// keyframe.fit_curve
// ---------------------------------------------------------------------------

function computeFit(src: Source, fps: number, tol: number, maxKeys: number): FitResult {
  const opts = { fps, tol, maxKeys };
  if (src.mode === "samples") return fitSamples(src.times!, src.values!, opts);
  return fitMove(src.f!, src.t0, src.dur, opts);
}

function fitWriteJsx(args: Record<string, unknown>, fit: FitResult, absolute: boolean): string {
  const job = {
    keys: fit.keys,
    ks: fit.keys[0].t,
    ke: fit.keys[fit.keys.length - 1].t,
    absolute,
    from: args.from ?? null,
    to: args.to ?? null,
    replace: args.replace === true,
    fps: fit.fps,
  };
  return `
            ${jsxCompPreamble(args)}
            var _layers = AE.resolveLayers(_comp, ${jsxVal(args.layer)});
            if (_layers.length === 0) return { ok: false, error: "no layers matched" };
            var _propPath = ${jsxVal(args.property)};
            var _job = ${jsxVal(job)};
            var _warn = [];
            if (Math.abs(_comp.frameRate - _job.fps) > 0.001) _warn.push("comp runs at " + _comp.frameRate + " fps but the keys were fitted at " + _job.fps + " fps");
            function _num(v) {
                if (typeof v === "number") return true;
                if (!(v instanceof Array) || v.length === 0) return false;
                for (var i = 0; i < v.length; i++) if (typeof v[i] !== "number") return false;
                return true;
            }
            function _keysIn(p, a, b) {
                var fol = AE.separationFollowers(p);
                var ts = fol ? fol : [p];
                var n = 0;
                for (var i = 0; i < ts.length; i++) for (var k = 1; k <= ts[i].numKeys; k++) {
                    var kt = ts[i].keyTime(k);
                    if (kt >= a - 0.0001 && kt <= b + 0.0001) n++;
                }
                return n;
            }
            function _removeIn(p, a, b) {
                var fol = AE.separationFollowers(p);
                var ts = fol ? fol : [p];
                for (var i = 0; i < ts.length; i++) for (var k = ts[i].numKeys; k >= 1; k--) {
                    var kt = ts[i].keyTime(k);
                    if (kt >= a - 0.0001 && kt <= b + 0.0001) ts[i].removeKey(k);
                }
            }
            function _val(u, from, to) {
                if (_job.absolute) return u;
                if (!(from instanceof Array)) return from + (to - from) * u;
                var o = [];
                for (var i = 0; i < from.length; i++) o.push(from[i] + (to[i] - from[i]) * u);
                return o;
            }
            function _spd(s, from, to, spatial, len) {
                if (_job.absolute) return s;
                if (!(from instanceof Array)) return s * (to - from);
                if (spatial) return Math.abs(s) * len;
                var o = [];
                for (var i = 0; i < from.length; i++) o.push(s * (to[i] - from[i]));
                return o;
            }
            var _out = [];
            var _failed = 0;
            for (var _li = 0; _li < _layers.length; _li++) {
                var _l = _layers[_li];
                var _r = { index: _l.index, name: _l.name, ok: false };
                _out.push(_r);
                var _p = AE.propertyAtPath(_l, _propPath);
                if (!_p || _p.propertyType !== PropertyType.PROPERTY) { _failed++; _r.error = "property path not found on this layer"; continue; }
                if (!_p.canVaryOverTime) { _failed++; _r.error = "property cannot be keyframed"; continue; }
                var _fol = AE.separationFollowers(_p);
                var _bez = true;
                try { _bez = (_fol ? _fol[0] : _p).isInterpolationTypeValid(KeyframeInterpolationType.BEZIER); } catch (eB) { }
                if (!_bez) { _failed++; _r.error = "property only takes HOLD keys (checkbox, menu, layer control, source text): it cannot carry a curve"; continue; }
                var _from = _job.from !== null ? _job.from : AE.readValue(_p, _job.ks);
                var _to = _job.to;
                if (!_job.absolute) {
                    if (!_num(_from) || !_num(_to)) { _failed++; _r.error = "from/to must be numbers or number arrays (this property holds " + typeof _from + ")"; continue; }
                    if ((_from instanceof Array) !== (_to instanceof Array) || (_from instanceof Array && _from.length !== _to.length)) { _failed++; _r.error = "from and to must have the same dimensions as the property (from = " + _from.toString() + ")"; continue; }
                } else if (typeof AE.readValue(_p, _job.ks) !== "number") {
                    _failed++; _r.error = "samples fit a 1-D property; for Position separate dimensions and target X/Y Position"; continue;
                }
                var _spatial = false;
                if (!_fol) {
                    try { _spatial = (_p.propertyValueType === PropertyValueType.TwoD_SPATIAL || _p.propertyValueType === PropertyValueType.ThreeD_SPATIAL); } catch (eS) { }
                }
                var _len = 0;
                if (!_job.absolute && _from instanceof Array) {
                    for (var _d = 0; _d < _from.length; _d++) _len += (_to[_d] - _from[_d]) * (_to[_d] - _from[_d]);
                    _len = Math.sqrt(_len);
                }
                var _n = _keysIn(_p, _job.ks, _job.ke);
                if (_n > 0 && !_job.replace) { _failed++; _r.error = "already has " + _n + " keys between " + _job.ks + "s and " + _job.ke + "s (pass replace: true to overwrite them)"; continue; }
                if (_n > 0) { _removeIn(_p, _job.ks, _job.ke); _r.replaced = _n; }
                var _specs = [];
                for (var _k = 0; _k < _job.keys.length; _k++) {
                    var _kk = _job.keys[_k];
                    _specs.push({ time: _kk.t, value: _val(_kk.v, _from, _to), inSpeed: _spd(_kk.inSpeed, _from, _to, _spatial, _len), outSpeed: _spd(_kk.outSpeed, _from, _to, _spatial, _len),
                        inInfluence: _kk.inInfluence, outInfluence: _kk.outInfluence, interp: "bezier" });
                }
                try {
                    var _res = AE.applyKeySpecs(_p, _specs, { spatialTangents: "linear" });
                    _r.ok = true;
                    _r.keys = _res.keysWritten;
                    if (_res.warnings.length) _r.warnings = _res.warnings;
                } catch (eW) { _failed++; _r.error = AE.errText(eW); }
            }
            return { ok: _failed === 0, error: _failed === 0 ? null : (_failed + " of " + _out.length + " layers failed"), layers: _out, warnings: _warn };
        `;
}

function fitSummary(fit: FitResult, absolute: boolean) {
  return {
    fps: fit.fps,
    maxErrorPct: Math.round(fit.maxError * 10000) / 100,
    worstTime: Math.round(fit.worstTime * 10000) / 10000,
    worstFrame: Math.round(fit.worstTime * fit.fps),
    // Normalised keys: v is the fraction of the move (0 = from, 1 = to) and
    // speeds are fractions per second; with samples they are channel units.
    units: absolute ? "channel" : "fraction",
    keys: fit.keys.map((k) => ({ ...k, frame: Math.round(k.t * fit.fps) })),
  };
}

function checkFitArgs(args: Record<string, unknown>): Source | string {
  const src = readSource(args);
  if (typeof src === "string") return src;
  if (src.mode === "curve") {
    if (!isNumOrNums(args.to)) return "to (number or number array) is required with curve";
    if (args.from !== undefined && args.from !== null && !isNumOrNums(args.from))
      return "from must be a number or number array";
  }
  if (args.fps !== undefined && !(typeof args.fps === "number" && args.fps > 0))
    return "fps must be > 0";
  return src;
}

registerOp({
  name: "keyframe.fit_curve",
  category: "keyframe",
  description:
    "Write bezier keys that MEASURABLY match a source easing curve (spring, back, expo, bounce, cubic-bezier) or a sampled channel: keys land on whole frames (first at/before t0, last at/after t0 + dur), every turning point (overshoot peak, undershoot dip, bounce impact) becomes a real key, each key gets the source's own speed and the influences are searched until AE's curve is within tolerance of the source at every frame and 4 sub-frames per frame. Returns the keys and the largest error in % of the move. " +
    "Use this instead of guessing ease numbers when matching code-made motion (CSS/GSAP/Remotion/Lottie) or a reference. A spring's dur is its settling window: it crosses the target at about 20 % of it; never add a bounce/inertia expression on top of these keys. dryRun returns the keys without touching AE. Check the result with keyframe.verify_curve.",
  params: [
    SHARED[0],
    {
      name: "layer",
      type: "any",
      description: "Layer index, name, { id }, 'selected', or an array of those",
      required: true,
    },
    ...SHARED.slice(1, 7),
    {
      name: "to",
      type: "any",
      description:
        "Value at the end (number or array, same dimensions as the property); required with curve",
      required: false,
    },
    SHARED[7],
    {
      name: "tolerance",
      type: "number",
      description: "Error budget, % of the move (default 2)",
      required: false,
      default: 2,
    },
    {
      name: "maxKeys",
      type: "number",
      description: "Most keys for the move (default 10)",
      required: false,
      default: 10,
    },
    {
      name: "replace",
      type: "boolean",
      description: "Overwrite keys already inside the move's frames (default false: refuse)",
      required: false,
      default: false,
    },
    {
      name: "dryRun",
      type: "boolean",
      description: "Only compute and return the keys (no AE call when fps is given)",
      required: false,
      default: false,
    },
  ],
  toJsx(args) {
    const src = checkFitArgs(args);
    if (typeof src === "string") return jsxFail(src);
    if (typeof args.fps !== "number") return nodeOnly("keyframe.fit_curve");
    const fit = computeFit(src, args.fps, tolOf(args), maxKeysOf(args));
    return fitWriteJsx(args, fit, src.mode === "samples");
  },
  async run(args, transport) {
    const src = checkFitArgs(args);
    if (typeof src === "string") return { ok: false, error: src };
    let fps = args.fps as number | undefined;
    if (typeof fps !== "number") {
      const r = await compFps(transport, args.comp);
      if ("error" in r) return { ok: false, error: r.error };
      fps = r.fps;
    }
    const absolute = src.mode === "samples";
    const fit = computeFit(src, fps, tolOf(args), maxKeysOf(args));
    const summary = fitSummary(fit, absolute);
    const within = fit.maxError <= tolOf(args) + 1e-9;
    const note = within
      ? undefined
      : `best fit is ${summary.maxErrorPct}% off at frame ${summary.worstFrame} with ${fit.keys.length} keys: raise maxKeys or lengthen the move`;
    if (args.dryRun === true)
      return { ok: true, dryRun: true, ...summary, ...(note ? { warning: note } : {}) };
    const res = await transport.execute({
      label: "keyframe.fit_curve",
      code: fitWriteJsx(args, fit, absolute),
    });
    if (!res.ok) return { ok: false, error: res.error ?? "AE call failed" };
    const r = res.result as Record<string, unknown>;
    const warnings = [...((r.warnings as string[]) ?? []), ...(note ? [note] : [])];
    return { ...r, ...summary, warnings };
  },
});

function tolOf(args: Record<string, unknown>): number {
  return (typeof args.tolerance === "number" && args.tolerance > 0 ? args.tolerance : 2) / 100;
}
function maxKeysOf(args: Record<string, unknown>): number {
  const n = typeof args.maxKeys === "number" ? Math.round(args.maxKeys) : 10;
  return Math.min(30, Math.max(2, n));
}

// ---------------------------------------------------------------------------
// keyframe.verify_curve
// ---------------------------------------------------------------------------

interface SampleRead {
  ok: boolean;
  error?: string;
  fps: number;
  ks: number;
  ke: number;
  times: number[];
  values: (number | number[])[];
  from: number | number[];
  to: number | number[];
  keys: { t: number; inType: string; outType: string }[];
}

/** Sample a property in AE between the move's frames, sub samples per frame. */
function sampleJsx(args: Record<string, unknown>, src: Source, sub: number): string {
  const job = {
    t0: src.t0,
    dur: src.dur,
    sub,
    fps: typeof args.fps === "number" ? args.fps : null,
    pre: args.postExpression !== true,
    from: args.from ?? null,
    to: args.to ?? null,
  };
  return `
            ${jsxCompLayerPreamble(args)}
            var _p = AE.propertyAtPath(_layer, ${jsxVal(args.property)});
            if (!_p || _p.propertyType !== PropertyType.PROPERTY) return { ok: false, error: "property path not found on this layer" };
            var _job = ${jsxVal(job)};
            var _fps = _job.fps !== null ? _job.fps : _comp.frameRate;
            var _ks = Math.floor(_job.t0 * _fps + 0.000001) / _fps;
            var _ke = Math.ceil((_job.t0 + _job.dur) * _fps - 0.000001) / _fps;
            var _fol = AE.separationFollowers(_p);
            function _at(t) {
                if (!_fol) return _p.valueAtTime(t, _job.pre);
                var o = [];
                for (var i = 0; i < _fol.length; i++) o.push(_fol[i].valueAtTime(t, _job.pre));
                return o;
            }
            var _n = Math.round((_ke - _ks) * _fps * _job.sub);
            var _ts = [], _vs = [];
            for (var _i = 0; _i <= _n; _i++) {
                var _t = _ks + _i / (_fps * _job.sub);
                _ts.push(_t);
                _vs.push(_at(_t));
            }
            var _kp = _fol ? _fol[0] : _p;
            var _keys = [];
            function _it(x) { return x === KeyframeInterpolationType.HOLD ? "hold" : (x === KeyframeInterpolationType.LINEAR ? "linear" : "bezier"); }
            for (var _k = 1; _k <= _kp.numKeys; _k++) {
                var _kt = _kp.keyTime(_k);
                if (_kt >= _ks - 0.0001 && _kt <= _ke + 0.0001) _keys.push({ t: _kt, inType: _it(_kp.keyInInterpolationType(_k)), outType: _it(_kp.keyOutInterpolationType(_k)) });
            }
            var _v0 = _vs[0];
            if (typeof _v0 !== "number" && !(_v0 instanceof Array)) return { ok: false, error: "property does not hold numbers" };
            return { ok: true, fps: _fps, ks: _ks, ke: _ke, times: _ts, values: _vs,
                from: _job.from !== null ? _job.from : _vs[0], to: _job.to !== null ? _job.to : _vs[_vs.length - 1], keys: _keys };
        `;
}

/** Compare AE samples with the source. Exported for the offline tests. */
export function verifyRead(
  read: SampleRead,
  src: Source,
  tolPct: number,
  tolFrames: number,
  dim?: number,
) {
  const ts = read.times;
  const pick = (v: number | number[]): number[] =>
    Array.isArray(v) ? (dim !== undefined ? [v[dim]] : v) : [v];
  if (src.mode === "samples") {
    const vals = ts.map((t) => interpSamples(src.times!, src.values!, t));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of src.values!) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const amp = Math.max(1e-9, hi - lo);
    const ae = read.values.map((v) => (pick(v)[0] - lo) / amp);
    const ref = vals.map((v) => (v - lo) / amp);
    return compareCurves(ts, ae, ref, read.fps, tolPct, tolFrames, false);
  }
  // AE reports Scale on a 2D layer with three dimensions: compare the
  // dimensions the move names (from/to) and ignore the rest.
  const nd = Math.min(pick(read.from).length, pick(read.to).length);
  const from = pick(read.from).slice(0, nd);
  const to = pick(read.to).slice(0, nd);
  const D = to.map((x, i) => x - from[i]);
  const L2 = D.reduce((s, x) => s + x * x, 0);
  if (!(L2 > 0)) throw new Error("from and to are equal: nothing to compare (pass from/to)");
  const L = Math.sqrt(L2);
  const f = src.f!;
  const refFrac = ts.map((t) =>
    t <= src.t0 ? 0 : t >= src.t0 + src.dur ? 1 : f((t - src.t0) / src.dur),
  );
  const aeVecs = read.values.map((v) => pick(v).slice(0, nd));
  // Fraction along the move for timing; full vector distance for the error.
  const aeFrac = aeVecs.map((v) => v.reduce((s, x, i) => s + (x - from[i]) * D[i], 0) / L2);
  const errs = aeVecs.map((v, j) => {
    let d2 = 0;
    for (let i = 0; i < v.length; i++) {
      const r = from[i] + D[i] * refFrac[j];
      d2 += (v[i] - r) * (v[i] - r);
    }
    return Math.sqrt(d2) / L;
  });
  return compareCurves(ts, aeFrac, refFrac, read.fps, tolPct, tolFrames, true, errs);
}

registerOp({
  name: "keyframe.verify_curve",
  category: "keyframe",
  readOnly: true,
  description:
    "Measure how closely the keys AE actually plays match a source easing curve or sampled channel: samples the property (pre-expression by default) at every frame and 4 sub-frames per frame over the move, and reports the largest error in % of the move, the frame where it happens, and the timing error in frames of the 50 % crossing, the arrival and the overshoot peak. ok is false past the tolerance (default 2 % and 1 frame): refit with keyframe.fit_curve. Same curve / samples / t0 / dur / from / to as keyframe.fit_curve; from/to default to the values at the first and last frame of the move.",
  params: [
    SHARED[0],
    {
      name: "layer",
      type: "any",
      description: "1-based layer index, name or { id }",
      required: true,
    },
    ...SHARED.slice(1, 7),
    {
      name: "to",
      type: "any",
      description: "Value at the end (default: the value at the last frame of the move)",
      required: false,
    },
    SHARED[7],
    {
      name: "dim",
      type: "number",
      description: "Compare one dimension only (0-based) of a multi-dimensional property",
      required: false,
    },
    {
      name: "tolerance",
      type: "number",
      description: "Allowed error, % of the move (default 2)",
      required: false,
      default: 2,
    },
    {
      name: "timingTolerance",
      type: "number",
      description: "Allowed timing error, frames (default 1)",
      required: false,
      default: 1,
    },
    {
      name: "subFrames",
      type: "number",
      description: "Samples per frame (default 4)",
      required: false,
      default: 4,
    },
    {
      name: "postExpression",
      type: "boolean",
      description: "Sample after expressions instead of the raw keys (default false)",
      required: false,
      default: false,
    },
  ],
  toJsx: () =>
    jsxFail(
      "keyframe.verify_curve compares on the MCP server side and cannot be used inside batch.run",
    ),
  async run(args, transport) {
    const src = readSource(args);
    if (typeof src === "string") return { ok: false, error: src };
    const sub =
      typeof args.subFrames === "number"
        ? Math.min(20, Math.max(1, Math.round(args.subFrames)))
        : 4;
    const res = await transport.execute({
      label: "keyframe.verify_curve",
      undoGroup: false,
      code: sampleJsx(args, src, sub),
    });
    if (!res.ok) return { ok: false, error: res.error ?? "AE call failed" };
    const read = res.result as SampleRead;
    if (!read.ok) return read;
    const tolPct = typeof args.tolerance === "number" ? args.tolerance : 2;
    const tolFrames = typeof args.timingTolerance === "number" ? args.timingTolerance : 1;
    try {
      const v = verifyRead(
        read,
        src,
        tolPct,
        tolFrames,
        typeof args.dim === "number" ? args.dim : undefined,
      );
      const [ks, ke] = frameWindow(src.t0, src.dur, read.fps);
      return {
        ...v,
        fps: read.fps,
        window: { start: ks, end: ke },
        keys: read.keys,
        ...(v.ok
          ? {}
          : {
              hint: "Refit with keyframe.fit_curve (same curve, replace: true) and verify again.",
            }),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  },
});
