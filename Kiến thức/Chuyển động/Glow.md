# Glow — Use when building AE glow, atmosphere, volumetric, multi Optical Flares, or beat-flash+bokeh stacks. Gives layered glow recipes with paid-plugin and free alternatives. Needs the vibe, layers, and available plugins.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

AE GLOW RECIPES — layered light stacks (not one Glow)
Core principle: glow is a stack, not a single effect. Layer at least 2–3 passes like grading.

!!! PLUGIN CAVEAT — READ FIRST !!!
These stacks name several third-party plugins. Status:
  Deep Glow (Video Copilot)    — FREE. Strongly preferred over the paid alternatives.
  Saber (Video Copilot)        — FREE. Use as volumetric beam or as a budget flare sub.
  Optical Flares (Video Copilot) — PAID (~$150). Free substitutes: Saber (less realistic) or
                                    AE-native CC Light Rays + CC Light Burst 2.5 combined.
  CROSSPHERE Bokeh (CROSSPHERE) — FREE substitute for paid BCC Lens Blur; keyframeable pulse.
If a paid plugin is absent, follow the "Free substitute" note for that stack.
Before applying any plugin effect, confirm it is installed:
  ae_exec -> app.effects contains the plugin's matchName, or ae_listEffects.


=== STACK A: Atmosphere + Volumetric (cold-night / sci-fi vibe) ===

Layer order (top to bottom in comp):
  1. Deep Glow layer      — wide low-freq ambient glow
  2. Saber layer          — tight high-freq volumetric beam from light source
  3. Curves adj layer     — push highlights to 110%+

--- A-1. Deep Glow (cold-white atmosphere, FREE) ---
Apply to a precomp or top solid:
  ae_applyEffect(layerId, "Deep Glow")
Key params via ae_setProperty (use property index if display name is ambiguous):
  Color       #D9DBFF  (cool white with blue tint)
  Threshold   0.55
  Radius      35
  Brightness  1.4
  Blend Mode  Add  (set on the layer itself: ae_setProperty -> "ADBE Blend Mode" -> BlendingMode.ADD)

[PAID flag: Deep Glow is FREE — no substitution needed.]

--- A-2. Saber volumetric beam (FREE) ---
Add Saber on a separate solid/shape that traces the beam path:
  ae_applyEffect(layerId, "Saber")
Params:
  Color (gradient from) #A98A80  (warm beige)
  Color (gradient to)   #D1948A  (warm pink)
  Body Size             8
  Glow Spread           35
  Glow Bias             0.3
  Render Mode           "Glow Only"  (so it does not re-render the source layer)
CRITICAL: Saber on its own layer scoped to the beam path only — do NOT apply full-frame
or it will smear foreground elements. Use a shape layer or precomp mask.

--- A-3. Curves highlight push ---
Add an adjustment layer above all glow layers:
  ae_applyEffect(adjLayerId, "ADBE Curves")
  → Lift the highlights on the RGB channel so peak whites exceed 100% (push to ~1.1–1.15).
  ae_setProperty(adjLayerId, "ADBE Effect Parade/ADBE Curves/...", ...)
  (Use property index 1 for RGB master curve; set a control point at [0.85, 1.0] → [1.0, 1.15].)

When to use Stack A:
  Cold moon night, snowscape, sci-fi, any scene with cool ambient + warm practical light.
  Classic "cool/warm tension" — the cold Deep Glow fights the warm Saber beam.

Do NOT:
  ✗ Use "Atmospheric Glow" or "Optical Glow" as a Deep Glow substitute — both are paid
    and objectively worse. Deep Glow is free and better.
  ✗ Apply Saber at full-frame without masking — smears the foreground.


=== STACK B: Multi-point Optical Flares (interior warm-light / teal-orange vibe) ===

PRINCIPLE: one flare per light source, each with its own color/size/bias — NOT one giant
halo over the whole frame.

Layer order:
  1. Optical Flares layer — primary light source (e.g. main ceiling lamp)
  2. Optical Flares layer — secondary source (text / UI / decorative element)
  3. Optical Flares layer — motion trail / moving element

[PAID flag: Optical Flares is PAID (~$150).]
Free substitute: Saber on a small point-light shape layer (less photorealistic but serviceable).
Free native substitute: CC Light Rays + CC Light Burst 2.5 stacked on an adjustment layer
  positioned above the light source layer — gives a convincing lens-flare bloom with no spend.

--- B-1. Primary flare (warm street-lamp template) ---
  ae_applyEffect(flareLayerId, "Optical Flares")
  Color (Global)  #FFE0A8
  Brightness      35
  Scale           50
  Position        Track to specific light-source point
  Source Type     3D or Layer Marker (tie to a null if the source moves)

Each additional flare layer: vary Color/Scale/Brightness per source type.
  e.g. neon sign flare: Color #B0FFF0 (teal), Brightness 20, Scale 30

--- B-2. Free native path: CC Light Rays + CC Light Burst 2.5 ---
On an adjustment layer directly above the source layer:
  ae_applyEffect(adjId, "CC Light Rays")
    Intensity  100, Radius  70, Center  [source_x, source_y]
  ae_applyEffect(adjId, "CC Light Burst 2.5")
    Intensity  50,  Center  same as above
Blend Mode on adj layer: Add. Opacity: 60–80%.

When to use Stack B:
  Interior multi-light scenes (lamps, corridor lights, street lamps, neon signs).
  Teal-orange color grading (P2 style).
  "Lens-real" light halos — car headlights, signage.


=== STACK C: Beat White-Flash + Bokeh Pulse (MV / ritual / rhythmic vibe) ===

Layer order:
  1. White Solid (beat flash)
  2. CROSSPHERE Bokeh layer (pulse)
  3. Curves adj layer (after-glow tail)

--- C-1. Beat white flash ---
Add a white solid full-comp size:
  ae_createSolid(compId, [1,1,1], "FX_BEATFLASH", compW, compH)
Blend Mode: Add (or Screen)
  ae_setProperty(layerId, "ADBE Blend Mode", BlendingMode.ADD)
Opacity keyframes (CRITICAL — this is the soul of the effect):
  Frame 0 of beat: Opacity 100%
  Frame at 0.1s:   Opacity 0%
  Easing: physical eye-adaptation curve — NOT default Easy Ease.
  The 0.1s→16.7ms ease pair simulates real physical flash persistence.
  Use ae_setKeyframeEase or ExtendScript KeyframeEase with influence ~90 on the out-tangent.
  (Default Easy Ease looks like a PowerPoint transition — avoid it.)

--- C-2. CROSSPHERE Bokeh pulse (FREE, substitute for paid BCC Lens Blur) ---
  ae_applyEffect(bokehLayerId, "CROSSPHERE Bokeh")
Params + keyframes:
  Radius       7 (at beat frame) → 0 (at beat+2 frames)  — keyframed
  Blade Count  6
  Threshold    0.7
  Sync timing: same frame as flash, or 1–2 frames delayed for a "lens catching up" feel.

[CROSSPHERE Bokeh is FREE. No paid substitution needed.]
If CROSSPHERE is absent: use native "Camera Lens Blur" effect with Iris Radius keyframed
  7→0 over 2 frames — less stylized but functional.

--- C-3. Curves after-glow tail ---
Adjustment layer above the two layers above, lasting 3 frames after the flash:
  ae_applyEffect(adjId, "ADBE Curves")
  Gently lift the highlight endpoint (RGB master) for frames 1–3 post-flash, then return to
  neutral. This mimics the eye lingering on the bright peak.

When to use Stack C:
  Music MVs, rhythmic cuts, ritual / ceremony moments, scene openers.
  Any moment that needs "weight" — the bokeh pulse signals importance.

Do NOT:
  ✗ Use default Easy Ease on the opacity fade — it will look like a cheap PowerPoint.
  ✗ Let the flash run longer than ~1s — ritual becomes "flashed blind".
  ✗ Leave Bokeh Radius static (constant bokeh, no pulse) — kills the rhythmic feel.


=== STACK D (SKIPPED): Blender Compositor Glare Nodes ===
Blender-side Glare nodes (Fog Glow, Streaks, Ghosts) are out of scope here.
Short rule: if delivering a SINGLE STILL from Blender, add glow in Blender Compositor.
For multi-shot edits, beat glow, or animated text — always use AE-side stacks A/B/C.


=== VIBE → RECIPE DECISION TREE ===

Vibe / context                    Recommended stack
────────────────────────────────────────────────────────────
Cold moon-night / sci-fi          A (Deep Glow + Saber volumetric + Curves)
Interior warm-light / teal-orange B (multi-point Optical Flares or CC substitutes)
Ritual / MV / beat-rhythm         C (White Flash + CROSSPHERE Bokeh + Curves)
Single Blender still for delivery Blender Compositor Glare — skip AE glow

Mixed vibe? Stack them:
  Cold night + ritual moment → A + C  (run both stacks on separate layer groups)
  Interior warm + MV energy  → B + C  (flares persistent; flash triggers on beat only)


=== ae-mcp TOOLING QUICK-REF ===

Apply an effect:
  ae_applyEffect(layerId, effectName)          -- by display name
  ae_applyEffect(layerId, matchName=...)       -- by matchName for reliability

Set a property (blend mode, opacity, effect param):
  ae_setProperty(layerId, matchPath, value)
  ae_setProperty(layerId, "ADBE Blend Mode", BlendingMode.ADD)
  ae_setProperty(layerId, "ADBE Transform Group/ADBE Opacity", 85)

If property(name) returns null, address by index:
  ae_exec -> layer.property("ADBE Effect Parade").property(effectIndex).property(paramIndex)

Re-acquire refs after addProperty (AE invalidates stale refs):
  ae_exec -> AEMCP.propByMatchPath(layer, fullMatchPath)

Preview a frame after building the stack:
  ae_previewFrame(compId, timeInSeconds)

