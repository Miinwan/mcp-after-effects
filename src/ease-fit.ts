// Ease fitting — turn a source easing curve (spring, back, expo, bounce,
// cubic-bezier, or a densely sampled channel) into After Effects bezier keys
// that reproduce it, measured at every frame and sub-frame. Runs on the Node
// side; the method (turning points become keys, source speed at each key,
// searched influences, frame-aware error) follows the ae-builder skill by
// 100x Engineers, reimplemented here from the maths.
//
// A temporal bezier segment in AE from key a to key b (length T) has its two
// handles at x = out-influence·T after a and in-influence·T before b; their
// heights follow the out speed of a and the in speed of b. Influences are
// 0..1 here, AE shows them as %.
//
// The fitter works in a normalised channel (0 = from, 1 = to): keys carry the
// fraction and the speed in fractions per second, and the JSX side scales
// both by the real move (per dimension, or by path length for spatial props).

export type CurveFn = (u: number) => number;

export type CurveSpec =
  | string
  | { type: "spring"; damping?: number; frequency?: number }
  | { type: "back"; overshoot?: number }
  | { type: "cubicBezier"; x1: number; y1: number; x2: number; y2: number }
  | { type: string; [k: string]: unknown };

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

export function spring(damping: number, frequency: number): CurveFn {
  return (u) => 1 - Math.exp(-damping * u) * Math.cos(frequency * u);
}

export function back(c1: number): CurveFn {
  const c3 = c1 + 1;
  return (u) => 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
}

function outBounce(u: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (u < 1 / d1) return n1 * u * u;
  if (u < 2 / d1) return n1 * (u -= 1.5 / d1) * u + 0.75;
  if (u < 2.5 / d1) return n1 * (u -= 2.25 / d1) * u + 0.9375;
  return n1 * (u -= 2.625 / d1) * u + 0.984375;
}

/** CSS cubic-bezier(x1, y1, x2, y2): solve x(s) = u, return y(s). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): CurveFn {
  const bx = (s: number) => 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3;
  const by = (s: number) => 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3;
  return (u) => {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (bx(m) < u) lo = m;
      else hi = m;
    }
    return by((lo + hi) / 2);
  };
}

const inOut =
  (fin: CurveFn): CurveFn =>
  (u) =>
    u < 0.5 ? fin(2 * u) / 2 : 1 - fin(2 - 2 * u) / 2;
const out =
  (fin: CurveFn): CurveFn =>
  (u) =>
    1 - fin(1 - u);
const pow =
  (n: number): CurveFn =>
  (u) =>
    u ** n;
const sineIn: CurveFn = (u) => 1 - Math.cos((u * Math.PI) / 2);
const expoIn: CurveFn = (u) => (u <= 0 ? 0 : 2 ** (10 * u - 10));
const bounceIn: CurveFn = (u) => 1 - outBounce(1 - u);

/** Named curves (aliases follow easings.net / GSAP names). */
export const NAMED_CURVES: Record<string, CurveFn> = {
  linear: (u) => u,
  springElegant: spring(5, 8),
  springSnappy: spring(7, 13),
  outBack: back(1.70158),
  outBackSoft: back(1.1),
  inQuad: pow(2),
  outQuad: out(pow(2)),
  inOutQuad: inOut(pow(2)),
  gravity: pow(2),
  inCubic: pow(3),
  outCubic: out(pow(3)),
  inOutCubic: inOut(pow(3)),
  inQuart: pow(4),
  outQuart: out(pow(4)),
  inOutQuart: inOut(pow(4)),
  inQuint: pow(5),
  outQuint: out(pow(5)),
  inOutQuint: inOut(pow(5)),
  inSine: sineIn,
  outSine: out(sineIn),
  inOutSine: (u) => -(Math.cos(Math.PI * u) - 1) / 2,
  inExpo: expoIn,
  outExpo: (u) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u)),
  inOutExpo: (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 2 ** (20 * u - 10) / 2 : (2 - 2 ** (-20 * u + 10)) / 2,
  outBounce,
  inBounce: bounceIn,
  inOutBounce: inOut(bounceIn),
  // CSS keywords
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  "ease-in": cubicBezier(0.42, 0, 1, 1),
  "ease-out": cubicBezier(0, 0, 0.58, 1),
  "ease-in-out": cubicBezier(0.42, 0, 0.58, 1),
};

/** Resolve a curve spec to a function, or return an error string. */
export function resolveCurve(spec: unknown): CurveFn | string {
  if (typeof spec === "string") {
    const s = spec.trim();
    const m = /^cubic-bezier\(\s*([^,]+),([^,]+),([^,]+),([^)]+)\)$/i.exec(s);
    if (m) {
      const n = m.slice(1).map(Number);
      if (n.some((x) => !Number.isFinite(x))) return `bad cubic-bezier '${s}'`;
      return cubicBezier(n[0], n[1], n[2], n[3]);
    }
    const key = Object.keys(NAMED_CURVES).find(
      (k) => k.toLowerCase() === s.replace(/^ease(?=[A-Z])/, "").toLowerCase(),
    );
    if (key) return NAMED_CURVES[key];
    return `unknown curve '${s}'. Known: ${Object.keys(NAMED_CURVES).join(", ")}, cubic-bezier(x1,y1,x2,y2), or { type: spring | back | cubicBezier }`;
  }
  if (spec && typeof spec === "object") {
    const o = spec as Record<string, unknown>;
    const num = (k: string, d: number) => (typeof o[k] === "number" ? (o[k] as number) : d);
    if (o.type === "spring") {
      const d = num("damping", 5);
      const f = num("frequency", 8);
      if (!(d > 0) || !(f > 0)) return "spring needs damping > 0 and frequency > 0";
      return spring(d, f);
    }
    if (o.type === "back") return back(num("overshoot", 1.70158));
    if (o.type === "cubicBezier") {
      const v = ["x1", "y1", "x2", "y2"].map((k) => o[k]);
      if (v.some((x) => typeof x !== "number")) return "cubicBezier needs numeric x1, y1, x2, y2";
      return cubicBezier(...(v as [number, number, number, number]));
    }
    return `unknown curve type '${String(o.type)}' (spring | back | cubicBezier)`;
  }
  return "curve must be a name, 'cubic-bezier(...)' or { type, ... }";
}

// ---------------------------------------------------------------------------
// AE bezier evaluation
// ---------------------------------------------------------------------------

/** Value of AE's temporal bezier at local time t (0..T). fo/fi are 0..1. */
export function bezValue(
  T: number,
  v0: number,
  v1: number,
  so: number,
  fo: number,
  si: number,
  fi: number,
  t: number,
): number {
  if (t <= 0) return v0;
  if (t >= T) return v1;
  const x1 = fo * T;
  const x2 = T - fi * T;
  const y1 = v0 + so * fo * T;
  const y2 = v1 - si * fi * T;
  // x(s) is monotonic for any influences in 0..1 (x'(s) >= 0), so bisection is safe.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const s = (lo + hi) / 2;
    const x = 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3 * T;
    if (x < t) lo = s;
    else hi = s;
  }
  const s = (lo + hi) / 2;
  return (1 - s) ** 3 * v0 + 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3 * v1;
}

/** One AE key as the evaluator sees it (speeds in value units per second, influences in %). */
export interface AeKey {
  t: number;
  v: number;
  inSpeed?: number;
  outSpeed?: number;
  inInfluence?: number;
  outInfluence?: number;
  inType?: "linear" | "bezier" | "hold";
  outType?: "linear" | "bezier" | "hold";
}

/** Evaluate a 1-D key list the way AE does (bezier, linear and hold sides). */
export function evalKeys(keys: AeKey[], t: number): number {
  if (keys.length === 0) return 0;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const T = b.t - a.t;
  if (a.outType === "hold") return a.v;
  if (a.outType === "linear" && b.inType === "linear") return a.v + ((b.v - a.v) * (t - a.t)) / T;
  // A linear side is a bezier with the straight-line speed and 1/3 influence.
  const lin = (b.v - a.v) / T;
  const so = a.outType === "linear" ? lin : (a.outSpeed ?? 0);
  const fo = a.outType === "linear" ? 1 / 3 : (a.outInfluence ?? 33.33) / 100;
  const si = b.inType === "linear" ? lin : (b.inSpeed ?? 0);
  const fi = b.inType === "linear" ? 1 / 3 : (b.inInfluence ?? 33.33) / 100;
  return bezValue(T, a.v, b.v, so, fo, si, fi, t - a.t);
}

// ---------------------------------------------------------------------------
// Fitting
// ---------------------------------------------------------------------------

/** A fitted key in the normalised channel: v is the fraction of the move, speeds are fractions per second. */
export interface FitKey {
  t: number;
  v: number;
  inSpeed: number;
  outSpeed: number;
  inInfluence: number;
  outInfluence: number;
}

export interface FitResult {
  keys: FitKey[];
  /** Largest error as a fraction of the move (0.02 = 2 %), over every frame and sub-frame. */
  maxError: number;
  /** Time of the largest error. */
  worstTime: number;
  fps: number;
}

export interface FitOptions {
  fps: number;
  /** Error budget as a fraction of the move (default 0.02). */
  tol?: number;
  /** Sub-samples per frame where the error is measured (default 4: motion blur shows in-betweens). */
  sub?: number;
  maxKeys?: number;
}

const COARSE = [0.1, 5, 10, 15, 20, 25, 30, 33.33, 40, 50, 60, 70, 80, 90, 100];
const MULTS = [0.6, 0.8, 1, 1.2, 1.4];
const EPS = 1e-6;

interface SegFit {
  fo: number;
  fi: number;
  so: number;
  si: number;
  err: number;
  worst: number;
}

/**
 * Frame-aware fit of one channel g(t) (absolute time, value in move fractions
 * so `amp` = 1 for a curve, or the channel's range for samples).
 * ks/ke: first and last key times (whole frames). extra: turning-point times.
 */
function fitChannel(
  g: (t: number) => number,
  ks: number,
  ke: number,
  extra: number[],
  amp: number,
  opts: FitOptions,
): FitResult {
  const fps = opts.fps;
  const fd = 1 / fps;
  const tol = opts.tol ?? 0.02;
  const sub = opts.sub ?? 4;
  const maxKeys = opts.maxKeys ?? 10;
  const snap = (t: number) => Math.round(t * fps) / fps;
  const h = Math.min(1e-4, fd / 100);
  const dOut = (t: number) => (g(t + h) - g(t)) / h;
  const dIn = (t: number) => (g(t) - g(t - h)) / h;
  const sameFrame = (a: number, b: number) => Math.abs(a - b) < fd / 2;

  let knots = [ks, ke];
  for (const t of extra.map(snap)) {
    if (t > ks && t < ke && !knots.some((k) => sameFrame(k, t))) knots.push(t);
  }
  knots.sort((a, b) => a - b);
  const samples: number[] = [];
  const nSamp = Math.round((ke - ks) * fps * sub);
  for (let i = 0; i <= nSamp; i++) samples.push(ks + (i * fd) / sub);

  const cache = new Map<string, SegFit>();
  const segFit = (a: number, b: number): SegFit => {
    const id = `${a.toFixed(6)}|${b.toFixed(6)}`;
    const hit = cache.get(id);
    if (hit) return hit;
    const T = b - a;
    const va = g(a);
    const vb = g(b);
    const sa = dOut(a);
    const sb = dIn(b);
    const ts = samples.filter((x) => x >= a - EPS && x <= b + EPS).map((x) => x - a);
    const src = ts.map((x) => g(a + x));
    const errOf = (so: number, fo: number, si: number, fi: number) => {
      let e = 0;
      let w = a;
      for (let j = 0; j < ts.length; j++) {
        const d = Math.abs(bezValue(T, va, vb, so, fo / 100, si, fi / 100, ts[j]) - src[j]);
        if (d > e) {
          e = d;
          w = a + ts[j];
        }
      }
      return [e, w];
    };
    // Free speed multipliers only at the move's own ends, where it starts or
    // stops between frames and the exact speed at the frame is not the source's.
    const ma = a === ks ? MULTS : [1];
    const mb = b === ke ? MULTS : [1];
    let best: SegFit = { fo: 33.33, fi: 33.33, so: sa, si: sb, err: Infinity, worst: a };
    for (const m1 of ma) {
      for (const m2 of mb) {
        for (const fo of COARSE) {
          for (const fi of COARSE) {
            const [e, w] = errOf(sa * m1, fo, sb * m2, fi);
            if (e < best.err) best = { fo, fi, so: sa * m1, si: sb * m2, err: e, worst: w };
          }
        }
      }
    }
    // Refine the influences around the best coarse pair.
    const c = { ...best };
    for (let fo = Math.max(0.1, c.fo - 5); fo <= Math.min(100, c.fo + 5) + EPS; fo += 0.5) {
      for (let fi = Math.max(0.1, c.fi - 5); fi <= Math.min(100, c.fi + 5) + EPS; fi += 0.5) {
        const [e, w] = errOf(c.so, fo, c.si, fi);
        if (e < best.err) best = { ...best, fo, fi, err: e, worst: w };
      }
    }
    best.err /= amp;
    cache.set(id, best);
    return best;
  };

  let fits: SegFit[] = [];
  for (;;) {
    fits = [];
    for (let i = 0; i < knots.length - 1; i++) fits.push(segFit(knots[i], knots[i + 1]));
    let wi = 0;
    for (let i = 1; i < fits.length; i++) if (fits[i].err > fits[wi].err) wi = i;
    if (fits[wi].err <= tol || knots.length >= maxKeys) break;
    const a = knots[wi];
    const b = knots[wi + 1];
    let add = snap(fits[wi].worst);
    if (!(add > a + EPS && add < b - EPS)) add = snap((a + b) / 2);
    if (!(add > a + EPS && add < b - EPS)) break;
    knots = [...knots, add].sort((x, y) => x - y);
  }

  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const keys: FitKey[] = knots.map((t, i) => {
    const inS = i > 0 ? fits[i - 1].si : fits[0].so;
    const outS = i < fits.length ? fits[i].so : inS;
    return {
      t: r6(t),
      v: r6(g(t) / amp),
      inSpeed: r6((i > 0 ? inS : outS) / amp),
      outSpeed: r6(outS / amp),
      inInfluence: i > 0 ? r2(fits[i - 1].fi) : 33.33,
      outInfluence: i < fits.length ? r2(fits[i].fo) : 33.33,
    };
  });
  let worst = fits[0];
  for (const f of fits) if (f.err > worst.err) worst = f;
  return { keys, maxError: worst.err, worstTime: worst.worst, fps };
}

/**
 * Turning points of a normalised curve: velocity changes sign (overshoot peaks,
 * undershoot dips, bounce impacts). Wiggles under 0.4 % around the target are
 * ignored unless they are a cusp (a bounce).
 */
export function turningPoints(f: CurveFn, n = 1200): number[] {
  const h = 1e-5;
  const us: number[] = [];
  const d: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = Math.min(1 - h, Math.max(h, i / n));
    us.push(i / n);
    d.push((f(u + h) - f(u - h)) / (2 * h));
  }
  const pts: number[] = [];
  for (let i = 1; i <= n; i++) {
    const flip = (d[i - 1] > 0 && d[i] <= 0) || (d[i - 1] < 0 && d[i] >= 0);
    if (!flip) continue;
    const u = us[i];
    if (u <= 0.01 || u >= 0.99) continue;
    const cusp = Math.abs(d[i - 1]) + Math.abs(d[i]) > 1;
    if (Math.abs(f(u) - 1) > 0.004 || cusp) pts.push(u);
  }
  return pts;
}

/** The whole frame window a move occupies: last frame at/before t0, first at/after t0 + dur. */
export function frameWindow(t0: number, dur: number, fps: number): [number, number] {
  const ks = Math.floor(t0 * fps + 1e-6) / fps;
  const ke = Math.ceil((t0 + dur) * fps - 1e-6) / fps;
  return [ks, ke];
}

/**
 * Fit one move of a normalised curve f (0 → 1, may overshoot) that starts at
 * t0 and lasts dur seconds. Keys land on whole frames; turning points become
 * keys; the error is measured at every frame and `sub` sub-frames.
 */
export function fitMove(f: CurveFn, t0: number, dur: number, opts: FitOptions): FitResult {
  const g = (t: number) => {
    if (t <= t0) return 0;
    if (t >= t0 + dur) return 1;
    return f((t - t0) / dur);
  };
  const [ks, ke] = frameWindow(t0, dur, opts.fps);
  return fitChannel(
    g,
    ks,
    ke,
    turningPoints(f).map((u) => t0 + u * dur),
    1,
    opts,
  );
}

/** Linear interpolation over sorted sample times. */
export function interpSamples(times: number[], values: number[], t: number): number {
  if (t <= times[0]) return values[0];
  const n = times.length - 1;
  if (t >= times[n]) return values[n];
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (times[m] <= t) lo = m;
    else hi = m;
  }
  const k = (t - times[lo]) / (times[hi] - times[lo]);
  return values[lo] + (values[hi] - values[lo]) * k;
}

/**
 * Fit ANY sampled channel (a camera drift, a squash chain, a tracked MP4
 * element): times/values sampled densely over ONE move. Keys come back in the
 * channel's own units (amp is folded back in), on whole frames.
 */
export function fitSamples(times: number[], values: number[], opts: FitOptions): FitResult {
  const t0 = times[0];
  const t1 = times[times.length - 1];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const amp = Math.max(1e-9, hi - lo);
  const g = (t: number) => interpSamples(times, values, t);
  // Real changes of direction become keys; noise on flat stretches is ignored.
  const eps = (1e-3 * amp) / Math.max(1e-9, t1 - t0);
  const turns: number[] = [];
  let last = 0;
  for (let i = 1; i < times.length; i++) {
    const s = (values[i] - values[i - 1]) / (times[i] - times[i - 1]);
    const sg = s > eps ? 1 : s < -eps ? -1 : 0;
    if (sg === 0) continue;
    if (last && sg !== last) turns.push(times[i - 1]);
    last = sg;
  }
  const [ks, ke] = frameWindow(t0, t1 - t0, opts.fps);
  const r = fitChannel(g, ks, ke, turns, amp, opts);
  // fitChannel normalised by amp; give the keys back in channel units.
  r.keys = r.keys.map((k) => ({
    ...k,
    v: Math.round(k.v * amp * 1e6) / 1e6,
    inSpeed: Math.round(k.inSpeed * amp * 1e6) / 1e6,
    outSpeed: Math.round(k.outSpeed * amp * 1e6) / 1e6,
  }));
  return r;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyResult {
  ok: boolean;
  /** Largest value error, % of the move. */
  maxErrorPct: number;
  worstTime: number;
  worstFrame: number;
  /** Largest timing error of the landmarks (50 % crossing, arrival, overshoot peak), in frames. */
  timingErrorFrames: number;
  landmarks: { name: string; source: number; ae: number; frames: number }[];
  samples: number;
}

function crossing(ts: number[], vs: number[], level: number): number | null {
  for (let i = 0; i < vs.length; i++) {
    if (vs[i] >= level) {
      if (i === 0) return ts[0];
      const k = (level - vs[i - 1]) / (vs[i] - vs[i - 1]);
      return ts[i - 1] + (ts[i] - ts[i - 1]) * k;
    }
  }
  return null;
}

function peakTime(ts: number[], vs: number[]): [number, number] {
  let m = 0;
  for (let i = 1; i < vs.length; i++) if (vs[i] > vs[m]) m = i;
  return [ts[m], vs[m]];
}

/**
 * Compare what AE plays (ae, sampled at ts, in move fractions 0 → 1) with the
 * source (ref at the same times). Value error in % of the move; timing error
 * of the 50 % crossing, the first arrival at the target and the overshoot peak.
 */
export function compareCurves(
  ts: number[],
  ae: number[],
  ref: number[],
  fps: number,
  tolPct = 2,
  tolFrames = 1,
  withLandmarks = true,
  errs?: number[],
): VerifyResult {
  let e = 0;
  let wi = 0;
  for (let i = 0; i < ts.length; i++) {
    const d = errs ? errs[i] : Math.abs(ae[i] - ref[i]);
    if (d > e) {
      e = d;
      wi = i;
    }
  }
  const landmarks: VerifyResult["landmarks"] = [];
  const add = (name: string, s: number | null, a: number | null) => {
    if (s === null || a === null) return;
    landmarks.push({ name, source: r4(s), ae: r4(a), frames: r2(Math.abs(s - a) * fps) });
  };
  // Timing is only well defined where the curve moves: the 50 % crossing, the
  // first arrival when it crosses the target with real speed (springs, backs,
  // bounces — not an expo tail creeping in), and a visible overshoot peak.
  if (withLandmarks) add("50%", crossing(ts, ref, 0.5), crossing(ts, ae, 0.5));
  const arr = withLandmarks ? crossing(ts, ref, 1) : null;
  if (arr !== null) {
    const fd = 1 / fps;
    const i = ts.findIndex((x) => x >= arr);
    const j = ts.findIndex((x) => x >= arr - fd);
    if (i > 0 && j >= 0 && ref[i] - ref[j] > 0.02) add("arrival", arr, crossing(ts, ae, 1));
  }
  const [pt, pv] = peakTime(ts, ref);
  if (withLandmarks && pv > 1.02) add("peak", pt, peakTime(ts, ae)[0]);
  const timing = landmarks.reduce((m, l) => Math.max(m, l.frames), 0);
  const pct = e * 100;
  return {
    ok: pct <= tolPct && timing <= tolFrames,
    maxErrorPct: r2(pct),
    worstTime: r4(ts[wi] ?? 0),
    worstFrame: Math.round((ts[wi] ?? 0) * fps),
    timingErrorFrames: timing,
    landmarks,
    samples: ts.length,
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// ---------------------------------------------------------------------------
// Unit fits for preset tables
// ---------------------------------------------------------------------------

const unitCache = new Map<string, FitKey[]>();

/**
 * Fit a normalised curve over a unit duration (u = 0..1) for preset tables
 * that are stretched to any duration later: keys at u (snapped to 1/100),
 * speeds in fractions per unit u. The fit is affine in time, so the error is
 * the same at any duration. Memoised by `id`.
 */
export function fitUnit(id: string, f: CurveFn, tol = 0.005, maxKeys = 8): FitKey[] {
  const hit = unitCache.get(id);
  if (hit) return hit;
  const g = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : f(t));
  const keys = fitChannel(g, 0, 1, turningPoints(f), 1, { fps: 100, sub: 2, tol, maxKeys }).keys;
  unitCache.set(id, keys);
  return keys;
}

/** A back ease whose overshoot peaks at `peak` (1.1 = 10 % past the target). */
export function backWithPeak(peak: number): CurveFn {
  let lo = 0;
  let hi = 8;
  const top = (c: number) => {
    const f = back(c);
    let m = 0;
    for (let i = 0; i <= 500; i++) m = Math.max(m, f(i / 500));
    return m;
  };
  for (let i = 0; i < 40; i++) {
    const c = (lo + hi) / 2;
    if (top(c) < peak) lo = c;
    else hi = c;
  }
  return back((lo + hi) / 2);
}

/**
 * A drop under gravity that lands, hops `hop` (fraction of the fall) and
 * lands again, all inside u = 0..1: 0 → 1 (impact) → 1 − hop → 1.
 */
export function gravityHop(hop: number): CurveFn {
  const tf = 1 / (1 + 2 * Math.sqrt(hop));
  return (u) => {
    if (u <= tf) return (u / tf) ** 2;
    const x = (u - tf) / (1 - tf);
    return 1 - 4 * hop * x * (1 - x);
  };
}
