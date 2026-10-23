# Choosing tools and plug-ins — Use when planning any After Effects job: task → MCP op (ae_do) → installed effect/plug-in (matchName) → caveat. Only lists what is installed on the owner's machine.

Updated 2026-10-23. Ops read from `src/operations/*.ts`; effects and matchNames from `Plugin đã cài/Hiệu ứng After Effects.md` (447 effects, AE 26.5). Call an op with `ae_do { op, args }`; full parameters via `ae_catalog`. Installed: Adobe's native effects, CycoreFX HD (the `CC …` group), Cineware, Mocha AE, Beauty Box (Digital Anarchy), Animation Composer (panel only). Not installed: Red Giant, Sapphire, BCC, Video Copilot, Particular, Optical Flares. Do not propose them.

## Order of a job
1. `ae_context`, `ae_guide` (the client note in `Khách hàng/`, `Cách làm việc`), `project.checkpoint` before large changes.
2. Build with high-level ops (`psd.*`, `anim.*`, `template.*`); drop to `effect.add` / `keyframe.*` only when no high-level op fits.
3. Check: `anim.review`, `text.qa`, `expression.validate`, `ae_render_frame` (contact sheet), `render.frame_diff` for before/after.
4. Apply feedback with `anim.adjust` / `anim.polish` on the existing work; do not rebuild.
5. Output: `render.export` (delivery), `render.background` (aerender in the background), `bridge.to_premiere` (back to Premiere).

## Building from PSDs and existing designs

| Task | Op | Effect / plug-in | Notes |
|---|---|---|---|
| Import a PSD as a comp | `psd.import` | — | `editableText` to make text editable; then `text.qa` to catch fonts missing diacritics |
| Assign layer roles, propose a plan | `psd.plan` (read-only) | — | Edit the plan, then `anim.apply_plan`; without a brief use `psd.auto_animate` |
| Multi-scene PSD (one group per scene) | `psd.animate_scenes` | Native motion blur | One style per scene, change `seed` for another look; `keepStatic` pins the logo |
| Recolour vector artwork to the brand | `brand.apply`, `shape.recolor` | — | Needs a brand kit (`brand.save`) |
| Split letters/objects of a shape into layers | `layer.split_groups`, `layer.convert_to_shapes` | — | To animate each letter of a vector logo |
| One template, many versions (CSV) | `data.to_comps`, `render.variants` | — | Translations, branches, event dates |

## Motion

| Task | Op | Effect / plug-in | Notes |
|---|---|---|---|
| Keyframed entrance / exit / accent | `anim.apply` | `blur_in`: Fast Box Blur `ADBE Box Blur2`; `wipe_in`: Linear Wipe `ADBE Linear Wipe` | Presets: fade, rise, slide, scale, pop, drop, rotate, blur, wipe, stretch, push, whip, flip, swing, zoom_blur, ken_burns (+ `_out`); accents: pulse, shake, nudge |
| Gentle loop while a scene holds | `anim.loop` | Expression added to the base value | float, sway, pulse, wiggle, spin, twinkle, hop, flutter; `seed` so layers do not move in phase |
| Physics after keyframes | `expression.apply_preset` | Expression | inertia, bounce_back, elastic, loop_cycle, loop_pingpong, wiggle… |
| Animation inside text | `text.animate` | Native Text Animator | char_fade, typewriter, char_rise, char_pop, char_blur, word_pop, tracking_in… See `Chuyển động/Kinetic typography` |
| Light sweep over text / logo / product | `anim.shine` | CC Light Sweep `CC Light Sweep` | Works on titles that are images; `repeatEvery` to repeat |
| Speed-ramp footage | `anim.speed_ramp` | Time Remap + frame blending | slowmo_hit, fast_slow, slow_fast, ramp_in_out, stutter. Cleaner slow motion: Pixel Motion Blur `ADBE OFMotionBlur` or Timewarp `ADBE Timewarp` via `effect.add` |
| Transition between two scenes | `anim.scene_transition` | Native motion blur, blur for `dream` | push, slide_up, whip, flip, dream, zoom. Choose with `Công thức/Chọn chuyển cảnh` |
| Graphic transition on a cut | `template.transition` | Brand-coloured solid/shape | flash, wipe, circle, slide_panels |
| Lower third, title card | `template.lower_third`, `template.title_card` | — | Fonts/colours from the brand kit (`brand`) |
| Logo reveal | `template.logo_reveal` | `particle`: CC Scatterize `CC Scatterize` + CC Particle Systems II `CC Particle Systems II`, Grow Bounds first | Styles pop, blur, particle; get the logo with `brand.find_logo` |
| Fix existing animation | `anim.adjust`, `anim.polish`, `anim.review` | — | Feedback like "too fast", "more stagger" is fixed in place |

## Extra effects via `effect.add` (matchName)

| Task | Effect to use (matchName) | Notes |
|---|---|---|
| Glow on text, logo | Glow `ADBE Glo2` | Recipes in `Chuyển động/Glow` |
| Light rays, background burst | CC Light Rays `CC Light Rays`, CC Light Burst 2.5 `CC Light Burst 2.5` | On an adjustment layer; heavy in 4K comps |
| Strong motion smear, zoom to centre | CC Radial Blur `CC Radial Blur`, CC Radial Fast Blur `CC Radial Fast Blur`, Directional Blur `ADBE Motion Blur` | Radial Fast Blur is lighter, good for preview |
| Motion blur for layers without transform keys (precomp, footage) | CC Force Motion Blur `CC Force Motion Blur` | Does not replace motion blur on keyframed layers |
| Quick transition wipes | CC Light Wipe `CC Light Wipe`, CC Grid Wipe `CC Grid Wipe`, CC Radial ScaleWipe `CC Radial ScaleWipe`, Linear Wipe `ADBE Linear Wipe` | Keyframe Completion 0→100 |
| Page turn, curl | CC Page Turn `CC Page Turn` | Menus, F&B brochures |
| Sphere, cylinder (logo around a globe) | CC Sphere `CC Sphere`, CC Cylinder `CC Cylinder` | Light fake 3D, no camera needed |
| Particles, rain, snow, bubbles | CC Particle World `CC Particle World`, CC Particle Systems II, CC Rainfall `CSRainfall`, CC Snowfall `CSSnowfall`, CC Bubbles `CC Bubbles`, CC Star Burst `CC Star Burst` | Emitters replace the whole layer: put them on their own solid, blend Add |
| Shatter / dissolve into particles | CC Pixel Polly `CC Pixel Polly`, CC Scatterize, Shatter `APC Shatter` | Grow Bounds first if the frame clips |
| Distortion, shake, liquid | Turbulent Displace `ADBE Turbulent Displace`, Wave Warp `ADBE Wave Warp`, CC Bend It `CC Bend It`, CC Smear `CC Smear` | |
| Tiled background, kaleidoscope | Motion Tile `ADBE Tile`, CC RepeTile `CC RepeTile`, CC Kaleida `CC Kaleida` | |
| Light glitch for events, teasers | CC Block Load `CS BlockLoad`, Offset `ADBE Offset`, Venetian Blinds `ADBE Venetian Blinds` | 2–4 frames, on the beat |
| Unified colour grade | CC Toner `CC Toner`, Lumetri Color `ADBE Lumetri`, Curves `ADBE CurvesCustom`, Apply Color LUT `ADBE Apply Color LUT2` | See `Chuyển động/Grade màu`; AE ↔ Premiere colour mismatch: `color.report`, `color.setup` |
| Vignette, film burn | CC Vignette `CS Vignette`, CC Burn Film `CC Burn Film` | |
| Film grain | Add Grain `VISINF Grain Implant` | Slow to render, switch on last |
| Skin smoothing (interviews, beauty) | Beauty Box `Digital Anarchy Beauty Box` | Heavy: apply on a precomp trimmed to the shot, render in the background |
| Surface tracking, screen replacement | Mocha AE `mochaAECC`, CC Power Pin `CC Power Pin` | Mocha opens its own UI (done by hand); the MCP applies CC Power Pin once the four corners exist |
| Stabilise shaky footage | Warp Stabilizer `ADBE SubspaceStabilizer` | Slow analysis; better done in Premiere first |
| Keying | Keylight (1.2) `Keylight 906`, Simple Choker `ADBE Simple Choker` | |
| Cinema 4D models | Cineware `CINEMA 4D Effect` | See `Plugin đã cài/Plugin bên thứ ba`; 3D inside AE: `Kỹ thuật/3D` |

## Presets, panels and plug-ins that cannot be called directly
- 1242 `.ffx` presets (`Plugin đã cài/Preset After Effects (.ffx)`): apply with `layer.apply_preset { path }`.
- MOGRTs: export with `egp.export_mogrt` after adding controls with `egp.add_property`; installed list in `Plugin đã cài/MOGRT`.
- Animation Composer, Motion Bro, Motion Array: panels used by hand; the MCP reads the result (`ae_layer_info`) and retimes it (`anim.adjust`). See `Plugin đã cài/Animation Composer`.
- No op for an effect's parameters: use `effect.set_property` after `effect.add` (parameter names via `effect.list_on_layer`).

## Brand and client assets
| Task | Op | Notes |
|---|---|---|
| Get a client logo | `brand.find_logo { client, tone }` | tone `trắng` (white) for dark backgrounds, `đen` (black) for light ones, `động` (animated) for endcards |
| Colours from finished artwork | `brand.colors_from_file { file }` | PSD, AI/PDF, PNG, JPG; returns hex + area share, flags neutral colours |
| Colours from a swatch | `project.parse_swatch` | The visual team's `.ase` file |
| Save, apply a brand kit | `brand.save`, `brand.apply` | Workflow: `Khách hàng/Hướng dẫn` |

## From Premiere and back
`bridge.from_premiere { handoff }` builds a comp with the frame size and fps of the clip Premiere sent (`send_to_after_effects`); do the effects, then `bridge.to_premiere` renders ProRes 4444 with alpha for Premiere's `return_from_after_effects`.
