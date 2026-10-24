// A strict After Effects mock for offline tests: runs the JSX the operations
// generate — with the real jsx/helpers.jsx, import.jsx and toolkit.jsx loaded
// — inside a Node vm, against an object model that behaves like AE where AE
// has bitten real builds. Each rule below was measured in After Effects 26.5
// (24/10/2026); a mock that accepts what AE rejects is a bug in the mock, and
// so is one that rejects what AE accepts.
//
//   - property("Name") returns null for a name/matchName AE does not have; the
//     tree is a whitelist (ae-verified-matchnames.json), nothing is invented
//   - adding a child to an indexed group (Effects, Masks, shape Contents, text
//     Animators/Selectors/Properties) kills handles to the group's other
//     children and everything below them ("Object is invalid"); moveTo kills
//     every handle in the group, the moved one included. Transform handles
//     survive an effect add, and the 3D switch kills nothing.
//   - hold-only properties (Checkbox, Dropdown, Layer control, Source Text)
//     reject bezier and linear interpolation and any temporal ease
//   - setTemporalEaseAtKey wants one ease for spatial / 1-D / colour / shape
//     values and value.length otherwise (3 for Scale, even on a 2D layer)
//   - KeyframeEase influence outside 0.1..100 throws at construction
//   - setValue on a keyframed property throws; a separated leader and the Z
//     follower of a 2D layer are hidden and throw on write
//   - two keys inside one frame are accepted silently by AE: recorded as an issue
//   - NaN values, beginUndoGroup inside operation code: recorded as issues

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { evalKeys, type AeKey } from "../../src/ease-fit.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JSX_DIR = path.resolve(HERE, "../../jsx");
const VERIFIED = JSON.parse(
  readFileSync(path.resolve(HERE, "../../Kiến thức/Kỹ thuật/MatchName đã kiểm chứng.json"), "utf8"),
) as Verified;

interface PropSpec {
  matchName: string;
  name: string;
  /** PropertyValueType key, or "GROUP" / "INDEXED" for groups. */
  type: string;
  value?: unknown;
  hold?: boolean;
  children?: PropSpec[];
  /** Children that can be added (indexed groups). */
  addable?: string[];
}
interface Verified {
  layer: PropSpec[];
  textLayer: PropSpec[];
  shapeLayer: PropSpec[];
  groups: Record<string, PropSpec>;
  effects: Record<string, { name: string; params: PropSpec[] }>;
  effectsVerifiedOnly: string[];
  notReal: Record<string, string>;
  opensDialogOnAdd: Record<string, string>;
}

export const VERIFIED_MATCHNAMES = VERIFIED;

const PVT = {
  NO_VALUE: "NO_VALUE",
  ThreeD_SPATIAL: "ThreeD_SPATIAL",
  ThreeD: "ThreeD",
  TwoD_SPATIAL: "TwoD_SPATIAL",
  TwoD: "TwoD",
  OneD: "OneD",
  COLOR: "COLOR",
  CUSTOM_VALUE: "CUSTOM_VALUE",
  MARKER: "MARKER",
  LAYER_INDEX: "LAYER_INDEX",
  MASK_INDEX: "MASK_INDEX",
  SHAPE: "SHAPE",
  TEXT_DOCUMENT: "TEXT_DOCUMENT",
};
const KIT = { LINEAR: 6612, BEZIER: 6613, HOLD: 6614 };
const PT = { PROPERTY: 6212, INDEXED_GROUP: 6213, NAMED_GROUP: 6214 };

export class AeMockError extends Error {}

export interface MockRun {
  ok: boolean;
  result: unknown;
  error: string | null;
  issues: string[];
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export function createAeMock() {
  const issues: string[] = [];
  const issue = (m: string) => {
    if (!issues.includes(m)) issues.push(m);
  };
  let nextId = 1;
  let undoDepth = 0;

  // ---- vm realm -----------------------------------------------------------
  const sandbox: Record<string, unknown> = {};
  const ctx = vm.createContext(sandbox);
  // Arrays handed to JSX must come from the vm realm, or `x instanceof Array` is false.
  const toVm = vm.runInContext("(function (v) { return JSON.parse(JSON.stringify(v)); })", ctx) as (
    v: unknown,
  ) => unknown;
  const out = (v: unknown) => (v !== null && typeof v === "object" ? toVm(v) : v);

  function KeyframeEase(
    this: { speed: number; influence: number },
    speed: number,
    influence: number,
  ) {
    if (!(influence >= 0.1 && influence <= 100))
      throw new AeMockError(
        `After Effects error: Unable to call "Constructor" because of parameter 2. Value ${influence} out of range 0.1 to 100.`,
      );
    this.speed = speed;
    this.influence = influence;
  }

  // ---- properties ---------------------------------------------------------
  class Prop {
    matchName: string;
    name: string;
    spec: PropSpec;
    parent: Prop | null;
    layer: Layer;
    children: Prop[] = [];
    gen = 0;
    keys: {
      t: number;
      v: unknown;
      inE: { speed: number; influence: number }[];
      outE: { speed: number; influence: number }[];
      inT: number;
      outT: number;
    }[] = [];
    _value: unknown;
    expression = "";
    expressionEnabled = true;
    expressionError = "";
    _separated = false;
    enabled = true;
    selected = false;

    constructor(spec: PropSpec, parent: Prop | null, layer: Layer) {
      this.spec = spec;
      this.matchName = spec.matchName;
      this.name = spec.name;
      this.parent = parent;
      this.layer = layer;
      this._value = clone(spec.value);
      for (const c of spec.children ?? [])
        this.children.push(new Prop(resolveSpec(c), this, layer));
    }

    get isGroup() {
      return this.spec.type === "GROUP" || this.spec.type === "INDEXED";
    }
    get isIndexed() {
      return this.spec.type === "INDEXED";
    }
    /** Groups that take addProperty (indexed, plus text Animator Properties, a named group in AE). */
    get takesChildren() {
      return this.isIndexed || (this.spec.addable ?? []).length > 0;
    }
    get propertyType() {
      return this.isGroup ? (this.isIndexed ? PT.INDEXED_GROUP : PT.NAMED_GROUP) : PT.PROPERTY;
    }
    get propertyValueType() {
      return this.isGroup ? PVT.NO_VALUE : PVT[this.spec.type as keyof typeof PVT];
    }
    get isSpatial() {
      return this.spec.type === "TwoD_SPATIAL" || this.spec.type === "ThreeD_SPATIAL";
    }
    get canVaryOverTime() {
      return !this.isGroup && this.spec.type !== "NO_VALUE";
    }
    get numProperties() {
      return this.children.length;
    }
    get numKeys() {
      return this.keys.length;
    }
    get isTimeVarying() {
      return this.keys.length > 0 || this.expression !== "";
    }
    get propertyIndex() {
      return this.parent ? this.parent.children.indexOf(this) + 1 : 1;
    }
    get propertyDepth() {
      let d = 1;
      for (let p = this.parent; p; p = p.parent) d++;
      return d;
    }
    get parentProperty(): Prop | Layer {
      return this.parent ? handle(this.parent) : this.layer;
    }
    propertyGroup(n = 1): Prop | Layer {
      let p: Prop | null = this.parent;
      for (let i = 1; i < n && p; i++) p = p.parent;
      return p ? handle(p) : this.layer;
    }
    where() {
      const names: string[] = [this.name];
      for (let p = this.parent; p; p = p.parent) names.unshift(p.name);
      return `${this.layer.containingComp.name} > ${this.layer.name} > ${names.join("/")}`;
    }

    property(k: number | string) {
      if (!this.isGroup) return null;
      let c: Prop | undefined;
      if (typeof k === "number") c = this.children[k - 1];
      else c = this.children.find((p) => p.matchName === k || p.name === k);
      return c ? handle(c) : null;
    }
    canAddProperty(m: string) {
      // AE 26.5 on shape Contents: true for any "ADBE Vector Filter/Shape/Graphic - …", real or not
      if (
        (this.matchName === "ADBE Root Vectors Group" || this.matchName === "ADBE Vectors Group") &&
        /^ADBE Vector (Filter|Shape|Graphic) - /.test(m)
      )
        return true;
      return this.takesChildren && (this.spec.addable ?? []).includes(m) && !!buildAddable(m);
    }
    addProperty(m: string) {
      if (VERIFIED.opensDialogOnAdd[m])
        issue(`addProperty("${m}") ${VERIFIED.opensDialogOnAdd[m]}`);
      if (VERIFIED.notReal[m] || (!buildAddable(m) && this.takesChildren))
        throw new AeMockError(
          `addProperty("${m}"): not a verified matchName — in After Effects 26.5 an unknown name can CRASH the app instead of failing (${VERIFIED.notReal[m] ?? "check canAddProperty first"})`,
        );
      if (!this.canAddProperty(m))
        throw new AeMockError(
          `After Effects error: can not add a property with this name (${m}) to ${this.name}`,
        );
      const sp = buildAddable(m)!;
      if (this.matchName === "ADBE Effect Parade") {
        // AE numbers duplicate effect names: "Slider Control 2"
        let n = 1;
        const base = sp.name;
        while (this.children.some((c) => c.name === sp.name)) sp.name = `${base} ${++n}`;
      }
      killChildren(this);
      const p = new Prop(sp, this, this.layer);
      this.children.push(p);
      return handle(p);
    }
    moveTo(i: number) {
      // every handle into the group dies, the moved one included
      const par = this.parent;
      const a = par ? par.children : this.layer.children;
      if (par) killChildren(par);
      a.splice(a.indexOf(this), 1);
      a.splice(i - 1, 0, this);
    }
    remove() {
      const par = this.parent!;
      killChildren(par);
      par.children.splice(par.children.indexOf(this), 1);
    }
    duplicate() {
      const par = this.parent!;
      killChildren(par);
      const p = new Prop(clone(this.spec), par, this.layer);
      par.children.push(p);
      return handle(p);
    }

    // ---- separation
    get dimensionsSeparated() {
      return this._separated;
    }
    set dimensionsSeparated(v: boolean) {
      if (this.matchName !== "ADBE Position") throw new AeMockError("property cannot be separated");
      if (v === this._separated) return;
      const fol = this.followerProps();
      if (v) {
        const val = this._value as number[];
        fol.forEach((f, d) => (f._value = val[d] ?? 0));
      } else {
        this._value = fol.map((f) => f._value);
      }
      this._separated = v;
    }
    followerProps(): Prop[] {
      const tg = this.parent!;
      return ["ADBE Position_0", "ADBE Position_1", "ADBE Position_2"].map((m) =>
        tg.children.find((c) => c.matchName === m)!,
      );
    }
    getSeparationFollower(d: number) {
      return this._separated ? handle(this.followerProps()[d]) : null;
    }
    get hidden() {
      if (this.matchName === "ADBE Position" && this._separated) return true;
      if (/^ADBE Position_[012]$/.test(this.matchName)) {
        const leader = this.parent!.children.find((c) => c.matchName === "ADBE Position")!;
        if (!leader._separated) return true;
        if (this.matchName === "ADBE Position_2" && !this.layer.threeDLayer) return true;
      }
      return false;
    }

    // ---- values
    dims(): number {
      const v = this._value;
      return Array.isArray(v) ? v.length : 1;
    }
    easeCount(): number {
      if (this.isSpatial) return 1;
      if (
        ["OneD", "COLOR", "SHAPE", "TEXT_DOCUMENT", "LAYER_INDEX", "CUSTOM_VALUE"].includes(
          this.spec.type,
        )
      )
        return 1;
      return this.dims();
    }
    get holdOnly() {
      return this.spec.hold === true;
    }
    normalize(v: unknown): unknown {
      if (Array.isArray(v) && Array.isArray(this._value)) {
        // AE pads a short array with the current components (Scale [x, y] on a 3-D value)
        const cur = this._value as unknown[];
        const o = cur.map((c, i) => (i < v.length ? v[i] : c));
        return o;
      }
      return clone(v);
    }
    checkWritable(what: string) {
      if (this.hidden)
        throw new AeMockError(
          `After Effects error: Can not "${what}" with this property because the property or a parent property is hidden.`,
        );
      if (this.isGroup) throw new AeMockError(`${this.name} is a group, it holds no value`);
    }
    get value() {
      if (this._separated) return out(this.followerProps().map((f) => f.valueAt(0)));
      return out(this.keys.length ? this.valueAt(this.layer.containingComp.time) : this._value);
    }
    setValue(v: unknown) {
      this.checkWritable("set value");
      if (this.keys.length)
        throw new AeMockError(
          "After Effects error: Can not call setValue() on a property with keyframes. Use setValueAtTime() or setValueAtKey() instead.",
        );
      if (hasNaN(v)) issue(`NaN value on ${this.where()}`);
      this._value = this.normalize(v);
    }
    setValueAtTime(t: number, v: unknown) {
      this.checkWritable("set value");
      if (!Number.isFinite(t)) issue(`bad key time on ${this.where()}`);
      if (hasNaN(v)) issue(`NaN key value on ${this.where()} at ${t}`);
      const fd = this.layer.containingComp.frameDuration;
      const same = this.keys.find((k) => Math.abs(k.t - t) < 1e-7);
      if (same) {
        same.v = this.normalize(v);
        return;
      }
      if (this.keys.some((k) => Math.abs(Math.round(k.t / fd) - Math.round(t / fd)) === 0))
        issue(`two keys in one frame (${t.toFixed(4)} s) on ${this.where()}`);
      const n = this.easeCount();
      const ease = () => Array.from({ length: n }, () => ({ speed: 0, influence: 16.666666667 }));
      this.keys.push({
        t,
        v: this.normalize(v),
        inE: ease(),
        outE: ease(),
        inT: this.holdOnly ? KIT.HOLD : KIT.LINEAR,
        outT: this.holdOnly ? KIT.HOLD : KIT.LINEAR,
      });
      this.keys.sort((a, b) => a.t - b.t);
    }
    key(k: number) {
      const kk = this.keys[k - 1];
      if (!kk)
        throw new AeMockError(
          `After Effects error: key index ${k} out of range (${this.keys.length} keys) on ${this.where()}`,
        );
      return kk;
    }
    keyTime(k: number) {
      return this.key(k).t;
    }
    keyValue(k: number) {
      return out(this.key(k).v);
    }
    setValueAtKey(k: number, v: unknown) {
      this.key(k).v = this.normalize(v);
    }
    removeKey(k: number) {
      this.key(k);
      this.keys.splice(k - 1, 1);
    }
    nearestKeyIndex(t: number) {
      let best = 0;
      let d = Infinity;
      this.keys.forEach((k, i) => {
        if (Math.abs(k.t - t) < d) {
          d = Math.abs(k.t - t);
          best = i;
        }
      });
      return best + 1;
    }
    isInterpolationTypeValid(t: number) {
      return this.holdOnly ? t === KIT.HOLD : true;
    }
    setInterpolationTypeAtKey(k: number, a: number, b?: number) {
      const kk = this.key(k);
      if (this.holdOnly && (a !== KIT.HOLD || (b !== undefined && b !== KIT.HOLD)))
        throw new AeMockError("After Effects error: Invalid interpolation type for this property.");
      kk.inT = a;
      kk.outT = b === undefined ? a : b;
    }
    keyInInterpolationType(k: number) {
      return this.key(k).inT;
    }
    keyOutInterpolationType(k: number) {
      return this.key(k).outT;
    }
    setTemporalEaseAtKey(
      k: number,
      inE: { speed: number; influence: number }[],
      outE?: { speed: number; influence: number }[],
    ) {
      const kk = this.key(k);
      if (this.holdOnly)
        throw new AeMockError(
          "After Effects error: Can not set temporal ease. BEZIER interpolation required for ease but not permitted for this property.",
        );
      const n = this.easeCount();
      const o = outE ?? inE;
      if (inE.length !== n || o.length !== n)
        throw new AeMockError(
          `After Effects error: Unable to call "setTemporalEaseAtKey" because of parameter ${inE.length !== n ? 1 : 2}. Value array does not have ${n} elements.`,
        );
      for (const e of [...inE, ...o])
        if (!Number.isFinite(e.speed)) issue(`NaN ease speed on ${this.where()}`);
      kk.inE = inE.map((e) => ({ speed: e.speed, influence: e.influence }));
      kk.outE = o.map((e) => ({ speed: e.speed, influence: e.influence }));
      // AE turns an eased key to bezier
      kk.inT = KIT.BEZIER;
      kk.outT = KIT.BEZIER;
    }
    keyInTemporalEase(k: number) {
      return out(this.key(k).inE);
    }
    keyOutTemporalEase(k: number) {
      return out(this.key(k).outE);
    }
    setSpatialTangentsAtKey(k: number) {
      this.key(k);
      if (!this.isSpatial) throw new AeMockError("After Effects error: property is not spatial");
    }
    keyInSpatialTangent() {
      return out([0, 0, 0]);
    }
    keyOutSpatialTangent() {
      return out([0, 0, 0]);
    }
    setSpatialContinuousAtKey() {}
    setSpatialAutoBezierAtKey() {}
    setTemporalContinuousAtKey() {}
    setTemporalAutoBezierAtKey() {}
    setRovingAtKey() {}
    keyRoving() {
      return false;
    }
    keySpatialContinuous() {
      return false;
    }
    keySpatialAutoBezier() {
      return false;
    }
    keyTemporalContinuous() {
      return false;
    }
    keyTemporalAutoBezier() {
      return false;
    }

    /** Evaluate the keys the way AE does (temporal bezier; spatial = along a straight path). */
    valueAt(t: number): unknown {
      if (this._separated) return this.followerProps().map((f) => f.valueAt(t));
      if (!this.keys.length) return clone(this._value);
      const K = this.keys;
      const first = K[0].v;
      if (!Array.isArray(first))
        return evalKeys(
          K.map((k) => aeKey(k, 0, k.v as number)),
          t,
        );
      if (this.isSpatial) {
        // distance along the polyline of key values
        const dist = [0];
        for (let i = 1; i < K.length; i++)
          dist.push(dist[i - 1] + len(sub(K[i].v as number[], K[i - 1].v as number[])));
        const s = evalKeys(
          K.map((k, i) => aeKey(k, 0, dist[i])),
          t,
        );
        let i = 0;
        while (i < K.length - 2 && dist[i + 1] < s) i++;
        const a = K[i].v as number[];
        const b = K[i + 1].v as number[];
        const seg = dist[i + 1] - dist[i];
        const f = seg > 0 ? (s - dist[i]) / seg : 0;
        return a.map((x, d) => x + (b[d] - x) * f);
      }
      return (first as number[]).map((_, d) =>
        evalKeys(
          K.map((k) => aeKey(k, Math.min(d, k.inE.length - 1), (k.v as number[])[d])),
          t,
        ),
      );
    }
    valueAtTime(t: number, _pre?: boolean) {
      return out(this.valueAt(t));
    }
  }

  const aeKey = (k: Prop["keys"][number], d: number, v: number): AeKey => ({
    t: k.t,
    v,
    inSpeed: k.inE[d].speed,
    outSpeed: k.outE[d].speed,
    inInfluence: k.inE[d].influence,
    outInfluence: k.outE[d].influence,
    inType: k.inT === KIT.HOLD ? "hold" : k.inT === KIT.LINEAR ? "linear" : "bezier",
    outType: k.outT === KIT.HOLD ? "hold" : k.outT === KIT.LINEAR ? "linear" : "bezier",
  });

  function killChildren(group: Prop) {
    group.gen++;
  }

  /** Handles snapshot the generation of every indexed ancestor; a change there kills them. */
  function handle(p: Prop): Prop {
    const chain: [Prop, number][] = [];
    for (let a = p.parent; a; a = a.parent) if (a.takesChildren) chain.push([a, a.gen]);
    const dead = () => chain.some(([a, g]) => a.gen !== g);
    const fail = () => {
      throw new AeMockError(`Object is invalid (stale handle to ${p.name})`);
    };
    return new Proxy(p, {
      get(t, k) {
        if (k === "__raw") return t;
        if (dead()) fail();
        const v = Reflect.get(t, k, t);
        return typeof v === "function" ? v.bind(t) : v;
      },
      set(t, k, v) {
        if (dead()) fail();
        return Reflect.set(t, k, v, t);
      },
    });
  }

  function resolveSpec(s: PropSpec): PropSpec {
    const g = VERIFIED.groups[s.matchName];
    if (g && !s.children && !s.addable) return { ...clone(g), name: s.name ?? g.name };
    return clone(s);
  }
  function buildAddable(m: string): PropSpec | null {
    const fx = VERIFIED.effects[m];
    if (fx) return { matchName: m, name: fx.name, type: "GROUP", children: clone(fx.params) };
    if (VERIFIED.effectsVerifiedOnly.includes(m))
      return { matchName: m, name: m.replace(/^ADBE /, ""), type: "GROUP", children: [] };
    const g = VERIFIED.groups[m];
    return g ? resolveSpec(g) : null;
  }

  // ---- layers, comps, project --------------------------------------------
  class Layer {
    containingComp: CompItem;
    name: string;
    id = nextId++;
    children: Prop[];
    inPoint = 0;
    outPoint: number;
    startTime = 0;
    stretch = 100;
    threeDLayer = false;
    motionBlur = false;
    enabled = true;
    selected = false;
    locked = false;
    shy = false;
    guideLayer = false;
    label = 0;
    parent: Layer | null = null;
    hasVideo = true;
    hasAudio = false;
    audioEnabled = false;
    source: unknown = null;
    constructor(comp: CompItem, name: string, tree: PropSpec[]) {
      this.containingComp = comp;
      this.name = name;
      this.outPoint = comp.duration;
      this.children = tree.map((sp) => new Prop(resolveSpec(sp), null, this));
    }
    get index() {
      return this.containingComp._layers.indexOf(this) + 1;
    }
    get matchName() {
      return "ADBE AV Layer";
    }
    get propertyDepth() {
      return 0;
    }
    get numProperties() {
      return this.children.length;
    }
    property(k: number | string): Prop | null {
      const c: Prop | undefined =
        typeof k === "number"
          ? this.children[k - 1]
          : this.children.find((p) => p.matchName === k || p.name === k);
      return c ? handle(c) : null;
    }
    get transform(): Prop | null {
      return this.property("ADBE Transform Group");
    }
    get effect(): Prop | null {
      return this.property("ADBE Effect Parade");
    }
    remove() {
      const a = this.containingComp._layers;
      a.splice(a.indexOf(this), 1);
    }
    moveToBeginning() {
      const a = this.containingComp._layers;
      a.splice(a.indexOf(this), 1);
      a.unshift(this);
    }
    setParentWithJump(p: Layer) {
      this.parent = p;
    }
    sourceRectAtTime() {
      return out({ left: -50, top: -50, width: 100, height: 100 });
    }
  }
  class AVLayer extends Layer {}
  class ShapeLayer extends AVLayer {}
  class TextLayer extends AVLayer {}
  class CameraLayer extends Layer {}
  class LightLayer extends Layer {}
  class TextDocument {
    text: string;
    fontSize = 60;
    font = "ArialMT";
    fillColor = [1, 1, 1];
    applyFill = true;
    justification = 0;
    tracking = 0;
    constructor(t: string) {
      this.text = t;
    }
    resetCharStyle() {}
    resetParagraphStyle() {}
  }
  class Item {
    id = nextId++;
    name: string;
    parentFolder: unknown = null;
    selected = false;
    comment = "";
    label = 0;
    constructor(name: string) {
      this.name = name;
    }
    remove() {
      project.items_.splice(project.items_.indexOf(this), 1);
    }
  }
  class FolderItem extends Item {}
  class FootageItem extends Item {}
  class CompItem extends Item {
    width: number;
    height: number;
    duration: number;
    frameRate: number;
    pixelAspect: number;
    _layers: Layer[] = [];
    time = 0;
    motionBlur = false;
    shutterAngle = 180;
    shutterPhase = -90;
    motionBlurSamplesPerFrame = 16;
    workAreaStart = 0;
    workAreaDuration: number;
    bgColor = [0, 0, 0];
    layers: Record<string, (...a: never[]) => Layer>;
    constructor(name: string, w: number, h: number, pa: number, dur: number, fps: number) {
      super(name);
      this.width = w;
      this.height = h;
      this.pixelAspect = pa;
      this.duration = dur;
      this.frameRate = fps;
      this.workAreaDuration = dur;
      const add = <L extends Layer>(L: L) => {
        this._layers.unshift(L);
        return L;
      };
      this.layers = {
        addSolid: (_c: unknown, n: string) => add(new AVLayer(this, n, clone(VERIFIED.layer))),
        addNull: () => {
          const l = add(new AVLayer(this, "Null 1", clone(VERIFIED.layer)));
          l.hasVideo = false;
          return l;
        },
        addShape: () => add(new ShapeLayer(this, "Shape Layer 1", clone(VERIFIED.shapeLayer))),
        addText: (t?: string) => {
          const l = add(new TextLayer(this, t || "Text", clone(VERIFIED.textLayer)));
          l.children
            .find((c) => c.matchName === "ADBE Text Properties")!
            .children.find((c) => c.matchName === "ADBE Text Document")!._value = new TextDocument(
            t || "",
          );
          return l;
        },
        precompose: () => {
          throw new AeMockError("precompose is not mocked");
        },
      };
    }
    get frameDuration() {
      return 1 / this.frameRate;
    }
    get numLayers() {
      return this._layers.length;
    }
    layer(i: number | string) {
      if (typeof i === "string") return this._layers.find((l) => l.name === i) ?? null;
      if (!(i >= 1 && i <= this._layers.length))
        throw new AeMockError(`After Effects error: layer index ${i} out of range`);
      return this._layers[i - 1];
    }
    openInViewer() {}
  }
  const project = {
    items_: [] as Item[],
    file: null,
    activeItem: null as Item | null,
    get numItems() {
      return this.items_.length;
    },
    item(i: number) {
      return this.items_[i - 1];
    },
    items: {
      addComp: (n: string, w: number, h: number, pa: number, d: number, f: number) => {
        const c = new CompItem(n, w, h, pa, d, f);
        project.items_.push(c);
        return c;
      },
      addFolder: (n: string) => {
        const f = new FolderItem(n);
        project.items_.push(f);
        return f;
      },
    },
  };
  const app = {
    version: "26.5x89",
    project,
    beginUndoGroup() {
      undoDepth++;
      issue(
        "operation code called beginUndoGroup: the dispatcher already opens one undo group per call",
      );
    },
    endUndoGroup() {
      undoDepth = Math.max(0, undoDepth - 1);
    },
    beginSuppressDialogs() {},
    endSuppressDialogs() {},
    executeCommand() {},
    findMenuCommandId() {
      return 0;
    },
  };

  Object.assign(sandbox, {
    app,
    AE: {},
    KeyframeEase,
    KeyframeInterpolationType: KIT,
    PropertyValueType: PVT,
    PropertyType: PT,
    CompItem,
    FootageItem,
    FolderItem,
    AVLayer,
    ShapeLayer,
    TextLayer,
    CameraLayer,
    LightLayer,
    TextDocument,
    Shape: function Shape() {},
    MarkerValue: function MarkerValue(this: { comment: string }, c: string) {
      this.comment = c;
    },
    ParagraphJustification: { LEFT_JUSTIFY: 7413, CENTER_JUSTIFY: 7415, RIGHT_JUSTIFY: 7414 },
    BlendingMode: { NORMAL: 5212, ADD: 5220, SCREEN: 5219 },
    TrackMatteType: {
      ALPHA: 5012,
      ALPHA_INVERTED: 5013,
      LUMA: 5014,
      LUMA_INVERTED: 5015,
      NO_TRACK_MATTE: 5016,
    },
    $: { writeln() {}, fileName: "" },
  });
  for (const f of ["helpers.jsx", "import.jsx", "toolkit.jsx"]) {
    vm.runInContext(readFileSync(path.join(JSX_DIR, f), "utf8"), ctx, { filename: f });
  }

  return {
    app,
    issues,
    /** Run an operation body (the toJsx output, which ends in `return …;`). */
    run(body: string): MockRun {
      const before = issues.length;
      try {
        const result = vm.runInContext(`(function () {\n${body}\n})()`, ctx, {
          filename: "op.jsx",
        });
        const r = JSON.parse(JSON.stringify(result ?? null));
        const ok = !(r && typeof r === "object" && r.ok === false);
        return {
          ok,
          result: r,
          error: ok ? null : String(r.error ?? "failed"),
          issues: issues.slice(before),
        };
      } catch (e) {
        return {
          ok: false,
          result: null,
          error: (e as Error).message,
          issues: issues.slice(before),
        };
      }
    },
    addComp(name: string, w = 1920, h = 1080, dur = 10, fps = 25) {
      return project.items.addComp(name, w, h, 1, dur, fps);
    },
    /** The raw property (no stale-handle proxy) for assertions. */
    prop(comp: string, layer: string, path: string[]): Prop {
      const c = project.items_.find((i) => i instanceof CompItem && i.name === comp) as CompItem;
      const l = c._layers.find((x) => x.name === layer)!;
      let p: Prop | undefined = undefined;
      let kids = l.children;
      for (const seg of path) {
        p = kids.find((x) => x.matchName === seg || x.name === seg);
        if (!p) throw new Error(`no ${seg} on ${layer}`);
        kids = p.children;
      }
      return p!;
    },
  };
}

function hasNaN(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasNaN);
  return typeof v === "number" && !Number.isFinite(v);
}
const sub = (a: number[], b: number[]) => a.map((x, i) => x - (b[i] ?? 0));
const len = (a: number[]) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));

export type AeMock = ReturnType<typeof createAeMock>;
