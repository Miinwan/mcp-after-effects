// JSX bodies shared between the read/render TOOLS (ae_comp_info,
// ae_layer_info, ae_render_frame) and their operation twins (comp.info,
// layer.info, render.frame). One body, two surfaces — what a batch.run child
// reports can never drift from what the standalone tool reports.
//
// Lives under src/operations/ so the jsx ES3 lint scans these template
// literals like any other generated code. Each snippet only DEFINES a
// function; the call site supplies the lookup preamble. Inside batch.run
// every child runs in its own IIFE, so two children defining the same
// function never collide.

/** Defines `_compInfo(c)` → the ae_comp_info payload for one comp. */
export const COMP_INFO_FN = `
    function _compInfo(c) {
        var _ciLayers = [];
        for (var _ci = 1; _ci <= c.numLayers; _ci++) {
            _ciLayers.push(AE.serializeLayerSummary(c.layer(_ci)));
        }
        var _ciOut = AE.serializeItemSummary(c);
        _ciOut.ok = true;
        _ciOut.found = true;
        _ciOut.workAreaStart = c.workAreaStart;
        _ciOut.workAreaDuration = c.workAreaDuration;
        _ciOut.pixelAspect = c.pixelAspect;
        _ciOut.shutterAngle = c.shutterAngle;
        _ciOut.shutterPhase = c.shutterPhase;
        _ciOut.motionBlur = c.motionBlur;
        _ciOut.layers = _ciLayers;
        return _ciOut;
    }
`;

/** Defines `_layerFull(l, incl, detail)` → the ae_layer_info payload for one layer. */
export const LAYER_FULL_FN = `
    function _layerFull(l, incl, detail) {
        var _lfOut = AE.serializeLayerFull(l, { includeProperties: incl, detail: detail });
        _lfOut.ok = true;
        _lfOut.found = true;
        return _lfOut;
    }
`;

/** Defines `_renderFrame(c, timeSeconds, absOutPath, useDisplayStartTime)`. */
export const RENDER_FRAME_FN = `
    function _renderFrame(c, t0, outAbs, useDst) {
        var _rfT = t0;
        if (useDst) _rfT = _rfT + c.displayStartTime;
        var _rfFile = AE.ensureParentDir(outAbs);
        try {
            try { if (_rfFile.exists) _rfFile.remove(); } catch (eRm) { }
            c.saveFrameToPng(_rfT, _rfFile);
            // saveFrameToPng can return before the file is fully on disk
            // (seen on AE 26.x). Wait until it exists and its size is stable,
            // so a caller that removes temporary layers right after us does
            // not change what gets captured.
            var _rfLast = -1;
            var _rfStable = 0;
            for (var _rfW = 0; _rfW < 150; _rfW++) {
                var _rfCheck = new File(_rfFile.fsName);
                var _rfLen = _rfCheck.exists ? _rfCheck.length : -1;
                if (_rfLen > 0 && _rfLen === _rfLast) { _rfStable++; if (_rfStable >= 2) break; } else { _rfStable = 0; }
                _rfLast = _rfLen;
                $.sleep(50);
            }
            return {
                ok: true,
                writtenTo: _rfFile.fsName.replace(/\\\\/g, "/"),
                time: _rfT,
                compName: c.name,
                size: [c.width, c.height]
            };
        } catch (eRf) {
            return { ok: false, error: "saveFrameToPng failed: " + AE.errText(eRf) };
        }
    }
`;

/**
 * Defines the motion-library engine used by anim.* and template.* (motion.ts):
 *   `_animApply(layer, job)` — write one preset's keyframes on one layer.
 *   `_animExprApply(layer, job)` — attach an additive loop / physics expression.
 *   `_animEntranceEnd(layer)` — when a layer's entrance keyframes finish.
 * A job's tracks are resolved on the Node side (motion.ts presetJob); this
 * engine only turns relative values into real ones (rest value, distance,
 * direction) and writes them through AE.applyKeySpecs.
 */
export const ANIM_FN = `
    function _animDir(name) {
        if (name === "right") return [1, 0];
        if (name === "up") return [0, -1];
        if (name === "down") return [0, 1];
        return [-1, 0];
    }
    function _animIsFx(which) { return which === "blur" || which === "wipe"; }
    function _animFxInfo(which) {
        if (which === "blur") return { matchName: "ADBE Box Blur2", label: "Blur (anim)", param: "ADBE Box Blur2-0001" };
        return { matchName: "ADBE Linear Wipe", label: "Wipe (anim)", param: "ADBE Linear Wipe-0001" };
    }
    function _animFindFx(layer, which, create) {
        var info = _animFxInfo(which);
        var par = layer.property("ADBE Effect Parade");
        if (!par) return null;
        for (var i = 1; i <= par.numProperties; i++) {
            var e = par.property(i);
            if (e.matchName === info.matchName && e.name === info.label) return e;
        }
        if (!create) return null;
        if (!par.canAddProperty(info.matchName)) return null;
        var fx = par.addProperty(info.matchName);
        fx.name = info.label;
        return fx;
    }
    function _animProp(layer, which, create) {
        if (_animIsFx(which)) {
            var fx = _animFindFx(layer, which, create);
            return fx ? fx.property(_animFxInfo(which).param) : null;
        }
        var tg = layer.property("ADBE Transform Group");
        if (!tg) return null;
        if (which === "opacity") return tg.property("ADBE Opacity");
        if (which === "position") return tg.property("ADBE Position");
        if (which === "scale") return tg.property("ADBE Scale");
        if (which === "rotation") return tg.property("ADBE Rotate Z");
        if (which === "rotateY") return layer.threeDLayer ? tg.property("ADBE Rotate Y") : null;
        return null;
    }
    function _animTargets(prop) {
        var fol = AE.separationFollowers(prop);
        return fol ? fol : [prop];
    }
    function _animKeysIn(prop, a, b) {
        var n = 0;
        var ts = _animTargets(prop);
        for (var i = 0; i < ts.length; i++) {
            for (var k = 1; k <= ts[i].numKeys; k++) {
                var kt = ts[i].keyTime(k);
                if (kt >= a - 0.0001 && kt <= b + 0.0001) n++;
            }
        }
        return n;
    }
    function _animRemoveIn(prop, a, b) {
        var ts = _animTargets(prop);
        for (var i = 0; i < ts.length; i++) {
            for (var k = ts[i].numKeys; k >= 1; k--) {
                var kt = ts[i].keyTime(k);
                if (kt >= a - 0.0001 && kt <= b + 0.0001) ts[i].removeKey(k);
            }
        }
    }
    function _animValue(which, rest, v, dirV, dist) {
        if (which === "opacity") return rest * v;
        if (which === "rotation" || which === "rotateY") return rest + v;
        if (_animIsFx(which)) return v;
        if (which === "scale") {
            var s = [rest[0] * v[0], rest[1] * v[1]];
            if (rest.length > 2) s.push(rest[2] * v[0]);
            return s;
        }
        var p = [rest[0] + dirV[0] * dist * v, rest[1] + dirV[1] * dist * v];
        if (rest.length > 2) p.push(rest[2]);
        return p;
    }
    // Fitted presets carry speeds in v units per unit of duration: scale them
    // like the values. Spatial Position takes a speed along the path
    // (magnitude); separated X/Y take one signed speed per follower.
    function _animSpeed(which, rest, s, dirV, dist, dur, prop) {
        if (which === "opacity") return rest * s / dur;
        if (which === "rotation" || which === "rotateY" || _animIsFx(which)) return s / dur;
        if (which === "scale") {
            var sv = (s instanceof Array) ? s : [s, s];
            var o = [rest[0] * sv[0] / dur, rest[1] * sv[1] / dur];
            if (rest.length > 2) o.push(rest[2] * sv[0] / dur);
            return o;
        }
        if (AE.separationFollowers(prop)) {
            var ps = [dirV[0] * dist * s / dur, dirV[1] * dist * s / dur];
            if (rest.length > 2) ps.push(0);
            return ps;
        }
        return Math.abs(dist * s) / dur;
    }
    function _animWipeAngle(name) {
        if (name === "right") return 270;
        if (name === "up") return 180;
        if (name === "down") return 0;
        return 90;
    }
    function _animApply(layer, job) {
        var r = { layer: layer.name, index: layer.index, preset: job.preset };
        var comp = layer.containingComp;
        var tg = layer.property("ADBE Transform Group");
        if (!tg || !tg.property("ADBE Opacity")) {
            r.skipped = true;
            r.reason = "layer has no opacity (camera, light or audio-only layer)";
            return r;
        }
        var dur = job.duration;
        var start = job.start;
        if (start === null || start === undefined) {
            if (job.kind === "out") start = layer.outPoint - dur;
            else start = layer.inPoint;
        }
        var end = start + dur;
        var dirV = _animDir(job.direction);
        var dist = job.distance;
        if (dist === null || dist === undefined) dist = job.distFactor * (dirV[0] !== 0 ? comp.width : comp.height);
        var restT = start;
        if (job.kind === "in") restT = end;
        // Pass 1: look, change nothing. A window that already holds keys is
        // left alone unless replace is set — keys outside it (an entrance when
        // adding an exit) are never touched.
        var conflicts = [];
        var rests = {};
        var i, tr, p;
        for (i = 0; i < job.tracks.length; i++) {
            tr = job.tracks[i];
            p = _animProp(layer, tr.prop, false);
            if (!p && tr.prop === "rotateY") { rests.rotateY = 0; continue; }
            if (!p) {
                if (_animIsFx(tr.prop)) continue;
                r.skipped = true;
                r.reason = "layer has no " + tr.prop;
                return r;
            }
            if (_animKeysIn(p, start, end) > 0) conflicts.push(tr.prop);
            if (!_animIsFx(tr.prop)) rests[tr.prop] = AE.readValue(p, restT);
        }
        if (conflicts.length && !job.replace) {
            r.skipped = true;
            r.reason = "already has keyframes between " + start + "s and " + end + "s on " + conflicts.join(", ") + " (pass replace: true to overwrite them)";
            return r;
        }
        if (rests.opacity === 0 && job.kind !== "emphasis") r.warning = "opacity is 0 at the rest time, so the layer stays invisible";
        // Pass 2: switches and effects first — both invalidate property
        // references taken before them, so transform props are fetched after.
        for (i = 0; i < job.tracks.length; i++) {
            if (job.tracks[i].prop === "rotateY" && !layer.threeDLayer) { layer.threeDLayer = true; r.made3D = true; }
        }
        for (i = 0; i < job.tracks.length; i++) {
            tr = job.tracks[i];
            if (!_animIsFx(tr.prop)) continue;
            var fx = _animFindFx(layer, tr.prop, true);
            if (!fx) { r.skipped = true; r.reason = "cannot add " + _animFxInfo(tr.prop).matchName + " to this layer"; return r; }
            if (tr.prop === "wipe") {
                fx.property("ADBE Linear Wipe-0002").setValue(_animWipeAngle(job.direction));
                fx.property("ADBE Linear Wipe-0003").setValue(Math.round(Math.min(comp.width, comp.height) * 0.04));
            }
        }
        var written = 0;
        var warnings = [];
        for (i = 0; i < job.tracks.length; i++) {
            tr = job.tracks[i];
            p = _animProp(layer, tr.prop, false);
            if (!p) continue;
            if (conflicts.length) _animRemoveIn(p, start, end);
            var specs = [];
            for (var k = 0; k < tr.keys.length; k++) {
                var ks = tr.keys[k];
                var spec = {
                    time: start + ks.t * dur,
                    value: _animValue(tr.prop, rests[tr.prop], ks.v, dirV, dist),
                    inInfluence: ks.i,
                    outInfluence: ks.o
                };
                if (ks.interp) spec.interp = ks.interp;
                if (ks.si !== undefined) spec.inSpeed = _animSpeed(tr.prop, rests[tr.prop], ks.si, dirV, dist, dur, p);
                if (ks.so !== undefined) spec.outSpeed = _animSpeed(tr.prop, rests[tr.prop], ks.so, dirV, dist, dur, p);
                specs.push(spec);
            }
            var res = AE.applyKeySpecs(p, specs, { spatialTangents: "linear" });
            written += res.keysWritten;
            for (var w = 0; w < res.warnings.length; w++) warnings.push(tr.prop + ": " + res.warnings[w]);
        }
        if (job.motionBlur) {
            var moves = false;
            for (i = 0; i < job.tracks.length; i++) {
                var mp = job.tracks[i].prop;
                if (mp === "position" || mp === "scale" || mp === "rotation" || mp === "rotateY") moves = true;
            }
            if (moves) {
                try { if (layer.motionBlur === false) { layer.motionBlur = true; r.motionBlur = "on"; } } catch (eMb) { }
                try { if (comp.motionBlur === false) { comp.motionBlur = true; r.compMotionBlur = "on"; } } catch (eCmb) { }
            }
        }
        r.start = start;
        r.end = end;
        r.keys = written;
        if (conflicts.length) r.replaced = conflicts;
        if (warnings.length) r.warnings = warnings;
        return r;
    }
    // ---- per-character text animation and light sweep ----
    function _txtFontSize(layer) {
        try { return layer.property("ADBE Text Properties").property("ADBE Text Document").value.fontSize; } catch (eFs) { return 60; }
    }
    function _txtEm(v, em) {
        if (v instanceof Array) { var o = []; for (var i = 0; i < v.length; i++) o.push(v[i] * em); return o; }
        return v * em;
    }
    function _txtSlider(layer, name, value) {
        var par = layer.property("ADBE Effect Parade");
        for (var e = 1; e <= par.numProperties; e++) if (par.property(e).name === name) return false;
        var sl = par.addProperty("ADBE Slider Control");
        sl.name = name;
        sl.property("ADBE Slider Control-0001").setValue(value);
        return true;
    }
    function _txtApply(layer, job) {
        var r = { layer: layer.name, index: layer.index, preset: job.preset };
        if (!(layer instanceof TextLayer)) {
            r.skipped = true;
            r.reason = "not a text layer (raster titles: use anim.shine or anim.apply)";
            return r;
        }
        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        for (var a = 1; a <= animators.numProperties; a++) {
            if (animators.property(a).name === job.name) {
                if (!job.replace) { r.skipped = true; r.reason = "already has animator '" + job.name + "' (pass replace: true to rebuild it)"; return r; }
                animators.property(a).remove();
                r.replaced = true;
                break;
            }
        }
        var em = _txtFontSize(layer);
        var ctlMade = [];
        for (var c = 0; c < job.controls.length; c++) {
            if (_txtSlider(layer, job.controls[c].name, job.controls[c].value)) ctlMade.push(job.controls[c].name);
        }
        animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        var an = animators.addProperty("ADBE Text Animator");
        an.name = job.name;
        var props = an.property("ADBE Text Animator Properties");
        for (var k = 0; k < job.props.length; k++) {
            var pp = props.addProperty(job.props[k].m);
            var v = job.props[k].em ? _txtEm(job.props[k].v, em) : job.props[k].v;
            pp.setValue(v);
        }
        var start = job.start;
        if (start === null || start === undefined) {
            if (job.kind === "out") start = layer.outPoint - job.duration;
            else start = layer.inPoint;
        }
        var end = start + job.duration;
        if (job.kind === "loop") {
            var sel = an.property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
            var sa = job.startAfter;
            if (sa === "auto") sa = Math.max(_animEntranceEnd(layer), _txtEntranceEnd(layer));
            if (sa === null || sa === undefined) sa = layer.inPoint;
            sel.property("ADBE Text Range Type2").setValue(job.basedOn);
            sel.property("ADBE Text Expressible Amount").expression = job.expr.replace(/__SA__/g, String(Math.round(sa * 1000) / 1000));
            r.startAfter = sa;
        } else {
            var rs = an.property("ADBE Text Selectors").addProperty("ADBE Text Selector");
            var adv = rs.property("ADBE Text Range Advanced");
            adv.property("ADBE Text Range Type2").setValue(job.basedOn);
            adv.property("ADBE Text Range Shape").setValue(job.shape);
            if (job.randomize) adv.property("ADBE Text Randomize Order").setValue(1);
            rs.property("ADBE Text Percent Start").setValue(0);
            rs.property("ADBE Text Percent End").setValue(job.spread);
            // Ramp Up: characters past End are fully selected (the "from"
            // state), characters before Start are at rest — so sliding the
            // window from -spread to 100 reveals the text in reading order.
            var off = rs.property("ADBE Text Percent Offset");
            var a0 = -job.spread, a1 = 100;
            if (job.kind === "out") { a0 = 100; a1 = -job.spread; }
            if (job.shape === 1) {
                // Square: only the window is selected, so slide a full-width
                // window off to the right (0 → 100) to reveal left to right.
                rs.property("ADBE Text Percent End").setValue(100);
                a0 = 0;
                a1 = 100;
                if (job.kind === "out") { a0 = 100; a1 = 0; }
            }
            off.setValueAtTime(start, a0);
            off.setValueAtTime(end, a1);
            if (job.linear) {
                off.setInterpolationTypeAtKey(1, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                off.setInterpolationTypeAtKey(2, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
            } else {
                AE.setEase(off, 1, 33, job.ease[0]);
                AE.setEase(off, 2, job.ease[1], 33);
            }
            r.start = start;
            r.end = end;
        }
        if (ctlMade.length) r.controlsAdded = ctlMade;
        r.animator = an.name;
        return r;
    }
    function _txtEntranceEnd(layer) {
        var end = layer.inPoint;
        if (!(layer instanceof TextLayer)) return end;
        var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
        for (var a = 1; a <= animators.numProperties; a++) {
            var sels = animators.property(a).property("ADBE Text Selectors");
            for (var s = 1; s <= sels.numProperties; s++) {
                var off = null;
                try { off = sels.property(s).property("ADBE Text Percent Offset"); } catch (eO) { off = null; }
                if (!off || off.numKeys < 2) continue;
                var t = off.keyTime(2);
                if (t > end && t - layer.inPoint < 3) end = t;
            }
        }
        return end;
    }
    function _shineApply(layer, job) {
        var r = { layer: layer.name, index: layer.index, preset: "shine" };
        var par = layer.property("ADBE Effect Parade");
        if (!par || !par.canAddProperty("CC Light Sweep")) { r.skipped = true; r.reason = "cannot add CC Light Sweep to this layer"; return r; }
        var fx = null;
        for (var e = 1; e <= par.numProperties; e++) if (par.property(e).name === "Shine (anim)") fx = par.property(e);
        if (fx && !job.replace) { r.skipped = true; r.reason = "already has 'Shine (anim)' (pass replace: true to rebuild it)"; return r; }
        if (fx) { fx.remove(); r.replaced = true; }
        fx = layer.property("ADBE Effect Parade").addProperty("CC Light Sweep");
        fx.name = "Shine (anim)";
        var start = job.start;
        if (start === null || start === undefined) start = Math.max(_animEntranceEnd(layer), _txtEntranceEnd(layer)) + 0.1;
        var rc = layer.sourceRectAtTime(start, false);
        var w = Math.max(20, Math.round(Math.min(rc.width, rc.height) * job.width));
        var cy = rc.top + rc.height / 2;
        fx.property("CC Light Sweep-0002").setValue(job.angle);
        fx.property("CC Light Sweep-0003").setValue(2);
        fx.property("CC Light Sweep-0004").setValue(w);
        fx.property("CC Light Sweep-0005").setValue(job.intensity);
        fx.property("CC Light Sweep-0006").setValue(job.intensity * 1.5);
        fx.property("CC Light Sweep-0007").setValue(2);
        fx.property("CC Light Sweep-0008").setValue(job.color);
        var cen = fx.property("CC Light Sweep-0001");
        var x0 = rc.left - w * 2, x1 = rc.left + rc.width + w * 2;
        cen.setValueAtTime(start, [x0, cy]);
        cen.setValueAtTime(start + job.duration, [x1, cy]);
        AE.setEase(cen, 1, 33, 40);
        AE.setEase(cen, 2, 60, 33);
        if (job.repeatEvery) {
            // Hold off-frame until the next pass, then cycle — edit the keys to retime.
            cen.setValueAtTime(start + job.repeatEvery, [x1, cy]);
            cen.expression = 'loopOut("cycle")';
        }
        r.start = start;
        r.end = start + job.duration;
        if (job.repeatEvery) r.repeatEvery = job.repeatEvery;
        return r;
    }
    // A backing (sticker outline, colour fill) rides on the artwork above it:
    // parented for position/scale/rotation, opacity linked by expression.
    function _followApply(layer, job) {
        var r = { layer: layer.name, index: layer.index, preset: "follow" };
        var comp = layer.containingComp;
        var host = AE.findLayerInComp(comp, job.to);
        if (!host) { r.skipped = true; r.reason = "no layer to follow"; return r; }
        if (layer.parent && !job.replace) { r.skipped = true; r.reason = "already parented to " + layer.parent.name; return r; }
        // Parenting compensates for the parent's transform at the comp's
        // current time: do it while the host sits at rest, not mid-entrance.
        var saved = comp.time;
        var rest = Math.max(_animEntranceEnd(host), host.inPoint) + comp.frameDuration;
        try { comp.time = Math.min(rest, comp.duration - comp.frameDuration); } catch (eT) { }
        layer.parent = host;
        try { comp.time = saved; } catch (eR) { }
        var op = layer.property("ADBE Transform Group").property("ADBE Opacity");
        op.expression = "hasParent ? value * parent.transform.opacity / 100 : value;";
        r.follows = host.name;
        return r;
    }
    function _planRun(layer, job) {
        if (job.type === "follow") return _followApply(layer, job);
        if (job.type === "text") return _txtApply(layer, job);
        if (job.type === "shine") return _shineApply(layer, job);
        return _animApply(layer, job);
    }
    function _animEntranceEnd(layer) {
        var names = ["ADBE Opacity", "ADBE Position", "ADBE Scale", "ADBE Rotate Z"];
        var tg = layer.property("ADBE Transform Group");
        var times = [];
        for (var i = 0; i < names.length; i++) {
            var p = tg ? tg.property(names[i]) : null;
            if (!p) continue;
            var ts = _animTargets(p);
            for (var j = 0; j < ts.length; j++) {
                for (var k = 1; k <= ts[j].numKeys; k++) times.push(ts[j].keyTime(k));
            }
        }
        if (!times.length) return layer.inPoint;
        times.sort(function (a, b) { return a - b; });
        var end = times[0];
        for (var t = 1; t < times.length; t++) {
            if (times[t] - end > 1) break;
            end = times[t];
        }
        return end;
    }
    function _animExprProp(layer, target) {
        if (target instanceof Array) return AE.propertyAtPath(layer, target);
        var tg = layer.property("ADBE Transform Group");
        if (!tg) return null;
        var map = { position: "ADBE Position", scale: "ADBE Scale", rotation: "ADBE Rotate Z", opacity: "ADBE Opacity", anchorPoint: "ADBE Anchor Point" };
        if (!map.hasOwnProperty(target)) return null;
        return tg.property(map[target]);
    }
    function _animExprApply(layer, job) {
        var r = { layer: layer.name, index: layer.index, preset: job.preset };
        var prop = _animExprProp(layer, job.target);
        if (!prop) { r.skipped = true; r.reason = "property " + String(job.target) + " not found on this layer"; return r; }
        if (!prop.canSetExpression) { r.skipped = true; r.reason = prop.name + " cannot take an expression"; return r; }
        var targets = [prop];
        var scalar = false;
        var fol = AE.separationFollowers(prop);
        if (fol) {
            scalar = true;
            if (job.axis !== null && job.axis !== undefined) targets = [fol[job.axis]];
            else targets = fol;
        }
        var busy = [];
        for (var i = 0; i < targets.length; i++) {
            if (targets[i].expressionEnabled && targets[i].expression !== "") busy.push(targets[i].name);
        }
        if (busy.length && !job.replace) {
            r.skipped = true;
            r.reason = "already has an expression on " + busy.join(", ") + " (pass replace: true to overwrite it)";
            return r;
        }
        // Sliders first (adding an effect invalidates property references),
        // then re-resolve the target. An existing slider keeps the value the
        // user dialled in unless this call passed one explicitly.
        var ctl = job.controls || [];
        if (ctl.length) {
            var par = layer.property("ADBE Effect Parade");
            var made = [];
            for (var c = 0; c < ctl.length; c++) {
                var sl = null;
                for (var e = 1; e <= par.numProperties; e++) {
                    if (par.property(e).name === ctl[c].name) { sl = par.property(e); break; }
                }
                var fresh = !sl;
                if (fresh) {
                    sl = par.addProperty("ADBE Slider Control");
                    sl.name = ctl[c].name;
                    made.push(ctl[c].name);
                }
                if (fresh || ctl[c].explicit) {
                    var v = ctl[c].value;
                    if (v === null || v === undefined) {
                        v = ctl[c].compFactor ? Math.round(layer.containingComp.height * ctl[c].compFactor * 10) / 10 : ctl[c].fallback;
                    }
                    sl.property("ADBE Slider Control-0001").setValue(v);
                }
            }
            if (made.length) r.controlsAdded = made;
            prop = _animExprProp(layer, job.target);
            fol = AE.separationFollowers(prop);
            targets = [prop];
            if (fol) {
                if (job.axis !== null && job.axis !== undefined) targets = [fol[job.axis]];
                else targets = fol;
            }
        }
        var sa = job.startAfter;
        if (sa === "auto") sa = _animEntranceEnd(layer);
        if (sa === null || sa === undefined) sa = 0;
        var base = scalar ? job.exprScalar : job.exprArr;
        var errors = [];
        for (var j = 0; j < targets.length; j++) {
            var seed = job.seed + layer.index * 17 + j * 5;
            var txt = base.replace(/__SA__/g, String(Math.round(sa * 1000) / 1000)).replace(/__SEED__/g, String(seed));
            targets[j].expression = txt;
            targets[j].expressionEnabled = true;
            var exprErr = "";
            try { exprErr = String(targets[j].expressionError); } catch (eErr) { exprErr = ""; }
            if (exprErr) errors.push(targets[j].name + ": " + exprErr);
        }
        r.applied = targets.length;
        if (job.startAfter !== null && job.startAfter !== undefined) r.startAfter = sa;
        if (errors.length) r.expressionErrors = errors;
        return r;
    }
`;

/**
 * Defines the helpers that work on keyframes ALREADY in a layer — the
 * "fix what's there" side of the motion library (anim.adjust / anim.review /
 * anim.polish). `_edAnimated(layer, filter)` lists every keyed property
 * (transform, effects, text, masks), filter = array of short names
 * (position, scale, rotation, opacity, anchorPoint) or display names, or null.
 */
export const ANIM_EDIT_FN = `
    var _ED_SHORT = { position: "ADBE Position", scale: "ADBE Scale", rotation: "ADBE Rotate Z", opacity: "ADBE Opacity", anchorPoint: "ADBE Anchor Point" };
    function _edMatches(p, filter) {
        if (!filter) return true;
        for (var i = 0; i < filter.length; i++) {
            var f = filter[i];
            var mn = _ED_SHORT.hasOwnProperty(f) ? _ED_SHORT[f] : null;
            if (mn && (p.matchName === mn || p.matchName.indexOf(mn + "_") === 0)) return true;
            if (p.name === f || p.matchName === f) return true;
        }
        return false;
    }
    function _edAnimated(layer, filter) {
        var out = [];
        function walk(g, depth) {
            if (depth > 6) return;
            for (var i = 1; i <= g.numProperties; i++) {
                var p = null;
                try { p = g.property(i); } catch (eP) { continue; }
                if (!p || p.matchName === "ADBE Marker") continue;
                if (p.propertyType === PropertyType.PROPERTY) {
                    var n = 0;
                    try { n = p.numKeys; } catch (eN) { n = 0; }
                    if (n > 0 && _edMatches(p, filter)) out.push(p);
                } else {
                    walk(p, depth + 1);
                }
            }
        }
        walk(layer, 0);
        return out;
    }
    function _edIsMover(p) {
        var m = p.matchName;
        return m.indexOf("ADBE Position") === 0 || m === "ADBE Scale" || m.indexOf("ADBE Rotate") === 0 || m === "ADBE Anchor Point" || m === "ADBE Orientation";
    }
    function _edSame(a, b) {
        if (a && a.length !== undefined) {
            for (var i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 0.0001) return false;
            return true;
        }
        if (typeof a === "number") return Math.abs(a - b) <= 0.0001;
        return true;
    }
    // Contiguous runs of keys (gap <= 1 s) across a layer's animated props:
    // [{ from, to, keys }] in time order.
    function _edSegments(props) {
        var times = [];
        for (var i = 0; i < props.length; i++) {
            for (var k = 1; k <= props[i].numKeys; k++) times.push(props[i].keyTime(k));
        }
        times.sort(function (a, b) { return a - b; });
        var segs = [];
        for (var t = 0; t < times.length; t++) {
            var last = segs.length ? segs[segs.length - 1] : null;
            if (last && times[t] - last.to <= 1) { last.to = times[t]; last.keys++; }
            else segs.push({ from: times[t], to: times[t], keys: 1 });
        }
        return segs;
    }
    // A key that moves the value but has a LINEAR side (and is not a hold).
    function _edLinearKeys(p) {
        var LIN = KeyframeInterpolationType.LINEAR;
        var HOLD = KeyframeInterpolationType.HOLD;
        var hits = [];
        for (var k = 1; k <= p.numKeys; k++) {
            var ti = p.keyInInterpolationType(k);
            var to = p.keyOutInterpolationType(k);
            if (ti === HOLD || to === HOLD) continue;
            var inMoves = k > 1 && ti === LIN && !_edSame(p.keyValue(k - 1), p.keyValue(k));
            var outMoves = k < p.numKeys && to === LIN && !_edSame(p.keyValue(k), p.keyValue(k + 1));
            if (inMoves || outMoves) hits.push(k);
        }
        return hits;
    }
    function _edLoops(p) {
        var e = "";
        try { if (p.expressionEnabled) e = p.expression; } catch (eE) { e = ""; }
        return e.indexOf("loopOut") !== -1 || e.indexOf("loopIn") !== -1;
    }
    // Retime the keys of p that fall in [a, b]: t' = pivot + (t - pivot) * scale + shift.
    // Values, interpolation and tangents are kept; ease speeds are divided by
    // scale so the curve keeps its shape. Returns { moved, collisions }.
    function _edRetime(p, a, b, pivot, scale, shift) {
        var snap = AE.snapshotKeys(p);
        var sel = [];
        var keep = {};
        var i;
        for (i = 0; i < snap.length; i++) {
            if (snap[i].time >= a - 0.0001 && snap[i].time <= b + 0.0001) sel.push(snap[i]);
            else keep["t" + Math.round(snap[i].time * 1000)] = true;
        }
        if (!sel.length) return { moved: 0, collisions: 0 };
        for (i = p.numKeys; i >= 1; i--) {
            var kt = p.keyTime(i);
            if (kt >= a - 0.0001 && kt <= b + 0.0001) p.removeKey(i);
        }
        var fd = p.propertyGroup(p.propertyDepth).containingComp.frameDuration;
        var collisions = 0;
        for (i = 0; i < sel.length; i++) {
            var nt = pivot + (sel[i].time - pivot) * scale + shift;
            // Snap the MOVE to whole frames, not the key: a key that sat
            // between frames (or the pivot itself) stays where it was.
            nt = sel[i].time + Math.round((nt - sel[i].time) / fd) * fd;
            if (keep["t" + Math.round(nt * 1000)]) collisions++;
            sel[i].time = nt;
            if (scale !== 1) {
                var eases = ["inEase", "outEase"];
                for (var e = 0; e < 2; e++) {
                    var arr = sel[i][eases[e]];
                    if (!arr) continue;
                    var fixed = [];
                    for (var d = 0; d < arr.length; d++) fixed.push(new KeyframeEase(arr[d].speed / scale, arr[d].influence));
                    sel[i][eases[e]] = fixed;
                }
            }
        }
        AE.applyKeys(p, sel);
        return { moved: sel.length, collisions: collisions, times: (function () { var o = []; for (var q = 0; q < sel.length; q++) o.push(sel[q].time); return o; })() };
    }
`;
