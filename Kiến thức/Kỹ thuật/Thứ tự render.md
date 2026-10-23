# Render order — Use when stacking effects, grades, passes, mattes, or output layers. Gives render order from project baseline to output, including particle->grain->grade and 32bpc rules. Needs comp structure and source bit depth.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

AE RENDER ORDER — compositing stack rules
Fetch before building any effect/grade stack or pre-comp structure. Violating these orders produces banding, grain that looks digital, and glow on wrong data.

=== 6-STEP HARD ORDER ===
Always work top-to-bottom before touching effects or grade:

  1. PROJECT BASELINE
     - Set 32 bpc (File > Project Settings > Color > Depth > 32 bits per channel)
     - Enable color management / working space
     - Interpret every EXR: assign correct color space, premultiply alpha

  2. PASS VERIFICATION
     - Confirm Beauty / Alpha / Z-Mist / Crypto / Vector passes load correctly
     - Check EXR multi-channel extraction (EXtractoR / ProEXR) before any compositing

  3. MATTE CORRECTNESS
     - View alpha channel in isolation; inspect edge quality
     - Fix premultiply / un-premultiply before any blending
     - Correct edge fringe or coverage issues here, not later

  4. INTEGRATION
     - Color match render to plate / background
     - Match black level (lift) between CG and live elements
     - Add grain match, blur match, and lens response (CA / vignette / distortion)
     - All of this happens BEFORE any stylization

  5. STYLIZATION
     - Glow / optical flare / bloom
     - LUT or look development (CC Toner / Lumetri)
     - Typography, UI overlays, rhythm decorations

  6. OUTPUT CHECK
     - Inspect for banding (gradient / sky / glow center)
     - Check for halo artifacts at matte edges
     - Verify highlight clipping and compression headroom

Do NOT start with plugins or LUTs. Confirm bit-depth, color management, passes, and matte first; otherwise all glow and grade stacks downstream are built on wrong data.

=== LAYER STACK ORDER (bottom to top) ===
This controls render order within a comp:

  BOTTOM
    main render / background / footage
    particle layers  (Particular / CC Particle World)
    grain layer      (Add Grain / fast-grain)
    grade adj layers (glow adj / sharpen adj / Toner adj / final adj)
  TOP
    text / UI / letterbox bars / decoration

Rule: particle -> grain -> grade. Order cannot be reversed.
Reason: grain must land on top of particles so it reads as unified film texture. Grade must sit above grain so it unifies the entire frame including the grain. If grade comes before grain the noise looks like a digital overlay with no relationship to the toned image.

=== 32 BPC IS MANDATORY FOR BLENDER/EXR COMPS ===
Blender EXR carries 16/32-bit float data. Setting the AE project to 8 bpc:
  - Truncates EXR on import
  - Causes banding in any gradient area (sky, fog, glow center) once Glow + Curves stack
  - Destroys HDR highlight info; bloom / overshoot become impossible

Set via ae_exec:
  app.project.bitsPerChannel = 32;

Performance note: 32 bpc uses 4x the memory of 8 bpc and renders ~2x slower. It is mandatory for any Blender EXR comp. 8 bpc is acceptable ONLY for pure MG/UI projects (no Glow stacking) or when the source is already compressed mp4/png.

=== COMMON ORDER VIOLATIONS AND FIXES ===

Violation: Started comp with a Glow plugin before verifying alpha
  Fix: Solo the alpha channel first (ae_exec: set View to Alpha). Confirm matte is clean. Apply premultiply correction if fringe exists. Only then re-enable Glow.

Violation: Grain layer placed above grade adj layers
  Fix: Move grain layer below all grade adj layers in layer stack. Use ae_exec to reorder:
    comp.layer("GRAIN").moveAfter(comp.layer("MAIN_RENDER"));
  Verify: preview should show grain affected by grade, not sitting on top of it.

Violation: Project is 8 bpc and banding appears in glow/sky region
  Fix: Switch to 32 bpc immediately (app.project.bitsPerChannel = 32). Re-render / re-preview. If banding persists after the switch, the source footage itself may be 8-bit compressed — source quality is the ceiling.

Violation: Grade LUT applied at step 2 (before integration)
  Fix: Move LUT adj layer above the integration adj layers (color match, black level, grain match). Integration must always be solved in neutral / log space before any look is applied.

=== TOOL NAMES ===
All ae-mcp tool references use underscore convention:
  ae_exec         — run ExtendScript in AE
  ae_previewFrame — grab a frame for visual verification
  ae_skillList    — list available bundled skills
  ae_skillUse     — fetch a skill prompt by name

