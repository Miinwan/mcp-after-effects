# Third-party plug-ins in After Effects — Use when picking CycoreFX, Cineware, Mocha AE or Beauty Box effects: what each is for, matchName, how to call it through the MCP, performance notes.

Updated 2026-10-23. Taken from `Hiệu ứng After Effects.md` (scanned by `knowledge.refresh_effects`) and `Adobe After Effects 2026 Plug-ins.md`. All are added with `ae_do effect.add { comp, layer, matchName }` and tuned with `effect.set_property` (parameter names via `effect.list_on_layer` after adding). Animation Composer (Mister Horse) is panel-only: see `Animation Composer`. Choose by task: `Công thức/Chọn tool và plugin`.

## CycoreFX HD (the `CC …` group, bundled with After Effects)
A light effect set that runs well on any machine and renders faster than most equivalent native effects. The ones worth using for motion:

| Effect | matchName | Use when | Notes |
|---|---|---|---|
| CC Light Sweep | `CC Light Sweep` | A light band sweeping over text, logos, bottles, products | `anim.shine` wraps it (angle, width, intensity, repeat) |
| CC Light Rays | `CC Light Rays` | Rays radiating from a logo or title | On the logo layer itself or an adjustment layer; glow recipes in `Chuyển động/Glow` |
| CC Light Burst 2.5 | `CC Light Burst 2.5` | A flash as a logo/title lands | Key Intensity up then off within 6–10 frames |
| CC Radial Blur / Radial Fast Blur | `CC Radial Blur`, `CC Radial Fast Blur` | Zoom smear into the centre on transitions, beat hits | Fast Blur is much lighter; Radial Blur is higher quality and slow |
| CC Vector Blur, CC Cross Blur | `CC Vector Blur`, `CS CrossBlur` | Directional smear, lens-style cross blur | |
| CC Force Motion Blur | `CC Force Motion Blur` | Motion blur on precomps/footage without transform keys | Render time grows with samples; 8–16 is enough |
| CC Particle World, CC Particle Systems II | `CC Particle World`, `CC Particle Systems II` | Sparkle dust, confetti, a burst as the logo appears | Emitters replace the whole layer: own solid, blend Add; `template.logo_reveal style particle` uses Systems II |
| CC Scatterize, CC Pixel Polly | `CC Scatterize`, `CC Pixel Polly` | Logo/text dissolving into particles or shattering, then reassembling | Switch on Grow Bounds or Collapse Transformations BEFORE the effect, or it clips to the frame |
| CC Star Burst, CC Bubbles, CC Rainfall, CC Snowfall, CC Drizzle | `CC Star Burst`, `CC Bubbles`, `CSRainfall`, `CSSnowfall`, `CC Drizzle` | Flying stars, bubbles, rain, snow, ripples | Rain/snow for seasonal pieces; Drizzle is heavy |
| CC Sphere, CC Cylinder | `CC Sphere`, `CC Cylinder` | Wrap an image onto a rotating sphere / cylinder (globe, can, glass) | Fake 3D, no camera needed |
| CC Page Turn | `CC Page Turn` | Turning pages of a menu, brochure, event calendar | Key Fold Position |
| CC Light Wipe, CC Grid Wipe, CC Radial ScaleWipe, CC Scale Wipe, CC Image Wipe, CC Glass Wipe, CC Jaws, CC Twister, CC WarpoMatic, CC Line Sweep | `CC Light Wipe`, `CC Grid Wipe`, `CC Radial ScaleWipe`, `CC Scale Wipe`, `CC Image Wipe`, `CC Glass Wipe`, `CC Jaws`, `CC Twister`, `CC WarpoMatic`, `CS LineSweep` | Graphic transitions inside AE | Key Completion 0→100; Light Wipe suits hotel/spa, Grid Wipe suits sales |
| CC Kaleida, CC RepeTile, CC Tiler | `CC Kaleida`, `CC RepeTile`, `CC Tiler` | Patterned backgrounds, kaleidoscope, image grids | |
| CC Bend It, CC Bender, CC Smear, CC Blobbylize, CC Flo Motion, CC Lens, CC Griddler | (as named) | Bending, pulling, bulging, liquid distortion on text or decor | Use lightly; too much looks cheap |
| CC Block Load | `CS BlockLoad` | Block-loading glitch for events, teasers | 2–4 frames |
| CC Toner | `CC Toner` | Unify tone across 3–5 luminance stops | Recipes in `Chuyển động/Grade màu` |
| CC Vignette, CC Burn Film, CC Overbrights | `CS Vignette`, `CC Burn Film`, `CC Overbrights` | Vignette, film-burn transitions, checking overexposed areas | Overbrights is a check only, switch off for renders |
| CC Power Pin | `CC Power Pin` | Pin an image to four corners (screens, signs) | Corners from Mocha AE or typed in |
| CC Wide Time | `CC Wide Time` | Echo-style time trails | Cost grows with frames before/after |

General: avoid the obsolete `CC Rain`, `CC Snow`, `CC Composite` (same names in the _Obsolete group); use `CSRainfall`, `CSSnowfall`, `CS Composite`.

## Cineware by Maxon
- Effect `Cineware` (`CINEMA 4D Effect`, Cinema 4D group); comes with Cineware Exporter, LiveLink, Scene Layer (`Cineware by Maxon` folder).
- Use it when a `.c4d` file (model, 3D logo, product) has to go into a comp: `project.import_file` the .c4d and put it in the comp; the layer carries the Cineware effect.
- Work with the draft renderer for quick previews and switch to final for the render. To drive the C4D scene with the AE camera, pick the comp camera in the effect. Read exact parameter names with `effect.list_on_layer`, never guess.
- Slow and RAM-hungry; without a full Cinema 4D the model can be shown but not edited. Simple 3D logos and text are faster with AE's own Cinema 4D renderer (`comp.set_renderer`, see `Kỹ thuật/3D`).

## Mocha AE (Boris FX, bundled with After Effects)
- matchName `mochaAECC`. Tracks planar surfaces (screens, signs, walls) and exports a corner pin or mask.
- Mocha opens its own window: tracking is done by hand; the MCP does the rest (CC Power Pin the image, colour, animate the inserted content).

## Beauty Box (Digital Anarchy)
- matchName `Digital Anarchy Beauty Box` (Digital Anarchy group; installed in MediaCore so Premiere sees it too).
- Skin smoothing for interviews, portraits, F&B beauty shots with people. Slow: apply on a precomp trimmed to the shot and render in the background with `render.background`.
