# Live test results in After Effects

Run on 2026-10-23 against After Effects 2026 (26.5), macOS, Node 24.19, through a stdio test client using the same `dist/index.js` that Claude Desktop runs. Scratch project with checkpoints next to it.

## Phase 0: foundation

- [x] `ae_context`, `ae_version_info` work. The very first call failed with -609 ("invalid connection") while macOS was asking for the Automation permission; every call after that was fine.
- [x] Comp, shape, Vietnamese text with diacritics and keyframes: correct, all accents render (Montserrat).
- [x] Automatic undo: after 20 MCP calls in a row, one `project.undo` reverts only the last call, the next one the call before it. Four `psd.auto_animate` calls are removed by exactly four undos, earlier work intact.
- [x] **Undo with manual edits in between**: confirmed by the owner that Cmd+Z no longer skips past MCP calls as it did in the old build.
- [x] `ae_render_frame` returns a preview image and a contact sheet in the result.
- [x] `project.checkpoint`, `text.qa`, `expression.validate`, `color.report` work. Fixed `text.qa` measuring text boxes at the wrong time.
- [x] `render.background` rendered a 4 s comp and an 11.2 s reel, `render.background_status` reported done, exit 0. Note: with the default output module aerender writes H.264 `.mp4` even when `outputPath` ends in `.mov`; the status now also returns `writtenTo`, the real file.
- [x] Real dialog: opened Composition Settings while a script was running. The MCP did not hang: the call timed out after 15 s with a hint, the next call reported `DIALOG_OPEN` with the text of both dialogs, `instance.dismiss_dialog` cancelled each one, After Effects carried on with the project unchanged. Script `alert()` calls are already suppressed and cannot block.
- [x] Knowledge base: `ae_guide` lists and reads the new notes; all 52 matchNames and every operation in `Công thức/Chọn tool và plugin` exist; `brand.colors_from_file` on a reel PSD returned its 5 brand colours; `text.animate` char_rise, `anim.shine` and Glow applied from the tables render correctly.
- [x] `quet-plugin.mjs`: 22 scripts, 1242 `.ffx` presets, 105 MOGRTs, 19 extensions. `knowledge.refresh_effects`: 447 effects in 25 categories.

## Phase 2: motion library

- [x] fade / rise / pop / slide (overshoot) / drop / blur / wipe / stretch / rotate entrances; staggered fade_out; pulse, shake; float, sway, twinkle. Contact sheet smooth and in order.
- [x] Overwrite guard: re-applying a preset into a window that already has keys is skipped and reported; keys outside the window (entrance plus exit) coexist.
- [x] Loop sliders: a slider tuned by hand to 12 keeps its value when `anim.loop` runs again.
- [x] `anim.review` → `anim.polish` → `anim.adjust` (stretch 0.1 s to 0.6 s, stagger 0.1 s, ease 85): 13 issues down to 1 (text on screen under 1.5 s, which is a creative call).
- [x] Lower thirds (left and right), title card pop, slide_panels transition with a test brand kit.
- [ ] Owner review of the motion feel.

## Phase 3: PSD pipeline

- [x] `psd.import` of a 252 MB reel PSD: cropped layers, 30 fps, 5 top-level groups (Intro, three scenes, background).
- [x] `psd.sequence_scenes` 4 × 2.8 s = 11.2 s; `psd.auto_animate` energetic per scene, logo static.
- [x] Contact sheet compared with the delivered version: tempo and entrance style close. Differences: light rays not rotating yet, headline exit not pulling to the centre, mascot entering from below instead of from the side.
- [ ] Owner review of the render.

## Kinetic text and variety (same day, after feedback)

- Feedback: the four scenes looked alike; text should animate inside itself; every job should get its own look.
- [x] `text.animate` on Vietnamese text: typewriter, char_rise + wave, char_pop + scale_wave, staggered char_blur_out all correct.
- [x] `psd.animate_scenes` with seeds 5150 and 2310: a different style per scene, a different set per seed.
- [x] Bugs found in the render and fixed: a "Color Fill" sticker outline moved on its own and showed a pink patch during transitions (now follows the object above it); parenting before the object settled offset the outline (now parented at the settle time); the "no loop" option was being replaced by wave 62 % of the time.
- Lesson: to rebuild, open a checkpoint instead of counting undos (`ae_render_frame` also takes a slot in the undo history).
