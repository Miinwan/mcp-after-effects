# Ease and timing — Use when setting keyframe velocities, timing animations, inPoint cascade, or beat-sync. Gives the golden 0.1/16.7 ease pair, cheat table, and timing recipes. Needs property dimensions, frame rate, and beat context.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

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

