# Ease and timing — Use when setting keyframe velocities, matching a source curve (spring, back, bounce, cubic-bezier) with keyframe.fit_curve / verify_curve, timing animations, inPoint cascade, or beat-sync. Gives the measured-easing rule, the spring trap, the golden 0.1/16.7 ease pair, cheat table, and timing recipes.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

=== MEASURED EASING: keyframe.fit_curve / keyframe.verify_curve ===
When motion must match a source (code that made an MP4 — CSS, GSAP, Remotion, Lottie, a spring — or a tracked reference), do not guess speed/influence. Fit it, then measure it.

  ae_do keyframe.fit_curve { comp, layer, property, curve: "springElegant", t0: 1, dur: 0.65, from: [0,0], to: [100,100] }
  ae_do keyframe.verify_curve { same comp/layer/property/curve/t0/dur/from/to }   // ok = within 2 % and 1 frame

The rule: keys reproduce the source within 2 % of the move at every frame and 4 sub-frames per frame (motion blur shows in-betweens), and within 1 frame of timing. "Similar ease" is not a match.

How the fit works (runs on the MCP side, method after the ae-builder skill):
  - keys only on whole frames: the first at/before t0, the last at/after t0 + dur
  - every turning point (overshoot peak, undershoot dip, bounce impact) is a real key, so the overshoot is visible and draggable
  - each key gets the source's own speed; influences are searched until AE's bezier matches; if a segment is still off, a key is added at its worst frame and the fit is redone
  - samples: { times, values } fits any 1-D channel (camera drift, squash chain, tracked element)
  - curve: a name, "cubic-bezier(x1,y1,x2,y2)", { type: "spring", damping, frequency } = 1 − e^(−d·u)·cos(f·u), { type: "back", overshoot }

SPRINGS — the trap:
  A spring's "duration" is its SETTLING window, not its travel time. 1 − e^(−5u)·cos(8u) over 0.65 s crosses the target at 0.13 s (about 20 % of the window), peaks at 117 % at 0.21 s and is settled by 0.57 s. Two keys 0.65 s apart with a bounce expression after them arrive about 5× late (70 % error).
  - Do not span keys over the nominal duration of a spring or back ease.
  - Overshoot is keys. Do not stack a bounce/inertia expression on keys to imitate it.
  - Keep timing curves out of expressions (Math.pow, Math.exp, ease() over time): the designer cannot see or drag them. Keys carry the curve; expressions map, offset and combine. expression.apply_preset bounce/inertia/elastic is for reactions with named controls only.
  - Match motion blur: shutter angle of the source, phase = −angle/2.

Normalised curves, fitted at 25 fps on real moves (frame snapping included):
| Curve                         | Keys | Shape of the keys                                   | Max error |
|-------------------------------|------|-----------------------------------------------------|-----------|
| springElegant 1−e^−5u·cos 8u  | 4    | 0 → 117 % peak → small dip → 100 %                  | 0.22 %    |
| springSnappy 1−e^−7u·cos 13u  | 5–6  | 0 → 121 % → 96 % → 100.7 % → 100 %                  | 0.39 %    |
| outBack c1 = 1.70158          | 3    | 0 → 110 % at 0.58 → 100 %                           | 0.01 %    |
| outCubic                      | 2    | out speed 3·move/dur, influence ≈ 33 / in speed 0    | 0.06 %    |
| outExpo                       | 2–3  | fast out (≈ 6.8·move/dur), long in influence         | 0.19 %    |
| inOutExpo                     | 4    | 2 keys reads cleaner but is about 3 % off           | 0.40 %    |
| gravity (inQuad)              | 2–3  | out speed 0 / in speed 2·move/dur (parabola)        | 0.14 %    |
| outBounce                     | 8    | each impact a key with full speed (a cusp)          | 0.37 %    |
Measured in After Effects 26.5 (24/10/2026): Scale spring 0.22 % / 0.01 frame, Rotation bounce 0.37 %, separated X/Y Position springSnappy 0.39 %, spatial Position outBack 1.15 % (AE's arc-length mapping adds about 1 %).

Phase-2 presets (anim.apply) with overshoot are fitted to a physical curve, within 0.5 % of it: pop = back peaking at 1 + overshoot (default 110 %), slide/rise with overshoot = back, drop = gravity fall + hop of `overshoot` (default 12 %) with the impacts as keys, flip = back 8° past flat, stretch = damped spring 1 − e^−6u·cos 8u, swing = −14°·e^−2.5u·cos 11u. easeStrength does not change these (the curve is the physics). Two-key presets (fade, scale, slide…) are defined by their 15/85 ease itself.

AE EASE & TIMING — keyframe velocity, cascade inPoints, beat-sync
Apply these rules any time you are setting keyframe velocities, staggering layer entries, or locking animation to a music track. Set keyframe properties via ae_exec JSX; validate expressions with ae_validateExpressions.

=== THE GOLDEN EASE PAIR: 0.1 out / 16.7 in ===
This single pair covers white-flash opacity, Bokeh pulse radius, Saber size-in, Light Burst opacity, and decorative text pops — anything that must feel like real physical light.

Meaning:
  Influence Out = 0.1   => animation leaves the first keyframe almost instantly at full speed (near-zero ramp-up)
  Influence In  = 16.7  => animation arrives at the last keyframe with an extremely long, barely perceptible tail (slow decay)
Result: instant peak => lingering fade. Simulates eye adaptation to a camera flash.

How to set via JSX (setTemporalEaseAtKey):
  IMPORTANT — ease arrays must match the property value dimension.
  For scalar props (opacity, single-value effects) the arrays have length 1.
  For 2-D props (position on a 2-D layer) length 2; for 3-D length 3.
  Use AEMCP.easeKeys(prop) to build correctly-sized arrays rather than hard-coding [ease].

  // Example: 1-D property (opacity)
  var prop = layer.property("ADBE Opacity");
  var easeOut = new KeyframeEase(0, 0.1);   // speed, influence
  var easeIn  = new KeyframeEase(0, 16.7);
  prop.setTemporalEaseAtKey(1, [easeOut], [easeOut]);  // keyframe 1: out
  prop.setTemporalEaseAtKey(2, [easeIn],  [easeIn]);   // keyframe 2: in

  // For a 2-D position prop, duplicate into length-2 arrays:
  prop.setTemporalEaseAtKey(1, [easeOut, easeOut], [easeOut, easeOut]);

Application checklist:
  - white-flash solid: opacity 100 -> 0, ease pair 0.1 / 16.7
  - Bokeh pulse: radius/scale 7 -> 0, same pair
  - Saber size-in: size 0 -> 8, outgoing 0.1
  - Light Burst opacity: 100 -> 0, 0.1 / 16.7
  - decorative text pop: scale 110->100 + opacity 0->100, outgoing 0.1 on scale

=== EASE-PAIR CHEAT TABLE ===
| Use case               | Out   | In    | Character                        |
|------------------------|-------|-------|----------------------------------|
| Golden flash/pulse     | 0.1   | 16.7  | instant peak, long tail (physics)|
| Default Easy Ease      | 33    | 33    | symmetric, mediocre              |
| Bouncy/soft enter      | 0     | 75    | slow in, very slow out (pillow)  |
| Hard stop              | 75    | 0     | fast decel to dead stop (punch)  |
| Camera pan / slide     | 50    | 50    | classic ease in/out              |
| Rhythm cut / linear    | 0     | 0     | constant speed, mechanical       |

Never leave multiple objects on the default 33/33 — it reads as a budget template. Vary the pair per element type to add hierarchy.

=== INPOINT CASCADE (stagger layer entries) ===
Simultaneous entry destroys rhythm. Stagger every element 1-3 frames (24 fps project).

Manual stagger pattern:
  Element_01  inPoint = 01:00
  Element_02  inPoint = 01:02  (+2 frames)
  Element_03  inPoint = 01:04  (+2 frames)
  Element_04  inPoint = 01:06

JSX to set in a loop (run via ae_exec):
  var comp = app.project.activeItem;
  var baseTime = comp.frameDuration * 24;  // frame 24 = 01:00 @ 24fps
  var stagger  = comp.frameDuration * 2;   // 2-frame stagger
  for (var i = 1; i <= comp.numLayers; i++) {
    comp.layer(i).inPoint = baseTime + stagger * (i - 1);
  }

Pasteable AE Expression — attach to a layer's startTime to cascade from the layer above:
  // Paste on Element_02, Element_03, etc. (index-based)
  var staggerFrames = 2;
  thisComp.layer(index - 1).inPoint + framesToTime(staggerFrames);

Validate any expression string with ae_validateExpressions before applying.

Apply cascade to:
  - multi-particle groups entering simultaneously
  - text / decoration layers
  - Shape Layer fans / radial bursts

=== BEAT SYNC (lock animation to music) ===
Tools:
  Beat Assistant (free AE plug-in) — auto-detects BPM and plants Composition Markers on every beat.
  Manual markers — scrub the track, press * on the numpad at each downbeat to plant a marker; name it in the Markers panel.

Density by music type:
  MV / slow narrative    => 1-2 flashes per bar, golden ease pair (0.1 / 16.7)
  Drum & bass / fast cut => flash on every beat, short ease (0/0 or 0/33)
  Ambient / low-freq     => skip flash entirely; use Bokeh pulse + volumetric light breath

Do NOT:
  - place a flash that misses the beat — it reads as a random glitch
  - stack flashes so densely that the viewer loses the sense of event
  - use the same ease pair on every element — no depth

=== LAYER NAMING & TIMELINE STRUCTURE ===
Layer naming convention:
  Cascading entry layers  => Element_01, Element_02, ...
  Beat-locked flash layers => Beat_01_flash, Beat_02_flash, ...
  Marker labels => use time-code, e.g. Beat_01 [01:00:00]

Timeline block pattern:
  Beat 01 [01:00:00]  -- flash (white solid + bokeh pulse)
  Beat 02 [02:15:08]  -- flash
  Beat 03 [04:00:00]  -- flash + cut
  Beat 04 [05:15:08]  -- flash + bokeh + Saber

Planting comp markers in JSX:
  var m = comp.markerProperty;
  var mv = new MarkerValue("Beat_01");
  m.setValueAtTime(1.0, mv);  // 1.0 = 1 second

Label every marker; re-editing to a different BPM then becomes a matter of nudging marker positions rather than hunting unnamed keyframes.

