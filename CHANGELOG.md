# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Measured easing**: `keyframe.fit_curve` writes bezier keys fitted to a source curve (spring, back, expo, bounce, cubic-bezier, CSS keywords) or to a sampled channel: keys on whole frames, every turning point a real key, the source's speed at each key and influences searched until the error at every frame and 4 sub-frames is under 2 % of the move; `keyframe.verify_curve` (read-only) samples what AE plays and reports the largest error and the timing error of the 50 % crossing, arrival and peak. Fitting runs on the server side (`src/ease-fit.ts`), no Python; method after the ae-builder skill by 100x Engineers. Ease speeds can be given per dimension.
- **Offline After Effects mock** (`tests/helpers/ae-mock.ts`): runs the operations' real generated JSX, with `helpers.jsx`, `import.jsx` and `toolkit.jsx` loaded, against an object model that reproduces behaviour measured in After Effects 26.5 — unknown names read as null, `addProperty`/`moveTo` invalidate sibling handles, hold-only properties reject bezier, Scale needs three eases, two keys in one frame, hidden separation followers. Every `anim.apply` and `text.animate` preset, `keyframe.fit_curve`/`verify_curve`, `keyframe.apply`, `effect.add` and `property.add` run through it. The whitelist is `Kiến thức/Kỹ thuật/MatchName đã kiểm chứng` (74 effects, layer, text, shape and mask trees dumped from a live AE). New lint rules: ES3 reserved words as bare keys or variable names, trailing commas, and any hard-coded `addProperty` matchName not in the verified table.
- **Mock and lint method** after the ae-builder skill by 100x Engineers.
- **Motion library (`motion.ts`)**: `anim.apply` entrance / exit / accent presets (fade, rise, slide, scale, pop, drop, rotate, blur, wipe, stretch, push, whip, flip, swing, zoom blur, pulse, shake, nudge, Ken Burns) that keep the layer's final values, ease 15/85 and switch on motion blur; `anim.loop` (float, sway, pulse, wiggle, spin, twinkle, hop, flutter) added on top of the base value and driven by Slider Controls for hand tuning; `anim.apply_plan` applies a whole plan as one undo step; `expression.apply_preset` (inertia, bounce back, elastic, loop, wiggle X/Y, looping wiggle, speed control).
- **Editing existing animation**: `anim.adjust` (shift, stretch, compress, re-ease existing keys, ripple, re-stagger), `anim.review` (flags linear keys, missing motion blur, no stagger, tempo too fast or slow, text on screen too briefly) and `anim.polish` (fixes those in place).
- **Templates**: `template.lower_third`, `template.title_card`, `template.logo_reveal` (pop, blur, particle with Grow Bounds set before Scatterize), `template.transition` (flash, wipe, circle, slide panels, with `start`), all reading fonts and colours from the brand kit.
- **PSD pipeline**: `psd.import` (cropped layers, fps, duration, editable text), `psd.plan` (layer roles from Vietnamese or English names, or from geometry), `psd.auto_animate`, `psd.sequence_scenes` and `psd.animate_scenes` for multi-scene PSDs. Plans take a `seed` for controlled variety (entrance direction, text style, loops, exits, light sweeps, tempo), so scenes and jobs do not repeat one look; every scene gets its own style and the seed is returned to rebuild it. With a static logo and scene transitions, one logo is pinned on the main comp and hidden inside each scene.
- **Kinetic text (`text-motion.ts`)**: `text.animate` per character, word or line (char_fade, typewriter, char_rise, char_drop, char_pop, char_blur, char_rotate, char_random, word_pop, tracking_in and their `_out` versions; loops wave, scale_wave, jitter with sliders); `anim.shine` light sweep that also works on titles that are images, optionally repeating.
- **Scene transitions**: `anim.scene_transition` (push, slide up, whip, flip, dream, zoom), also inserted automatically by `psd.animate_scenes` from the seed. Looks learned from event-reel references.
- **Speed ramp**: `anim.speed_ramp` with Time Remap (slowmo_hit, fast_slow, slow_fast, ramp_in_out, stutter or custom segments), eased speed changes, source time always moving forward, frame blending and motion blur on.
- **Premiere ↔ After Effects bridge**: `bridge.from_premiere` builds a comp matching the clip (frame, fps, Motion, frame-rounded handles); `bridge.to_premiere` renders ProRes 4444 with alpha into the handoff folder.
- **Delivery export**: `render.export` renders a master inside After Effects, then ffmpeg makes YouTube 4K/1080, Reels, 4:5, square, LED, a watermarked review with timecode, ProRes master and PNG alpha; files are named `<Client> <Title> <Aspect> V<n>`, logged with measured LUFS, and the job runs in the background with `render.export_status`. Every H.264 output is processed at 16-bit with high-quality scaling, progressive, square pixel, BT.709, VBR 1 pass (Full HD 50 Mbps, 4K 20 Mbps) with bitrate lowered automatically to keep files under 1 GB, and the QT Gamma Compensation LUT applied (`MCP_QT_GAMMA_LUT`), never to ProRes or PNG masters.
- **Post-delivery clean-up**: `project.review_unused` (read-only) finds footage the delivered comps no longer use (recursively through precomps) and surplus media in the source folders and `Proxies`, writing a JSON report in the same format as the Premiere server; `project.clean_unused { report, confirm: true }` takes a checkpoint, re-checks, removes items in one undo group and moves files to the Trash through Finder. Files in use, project files and deliverable folders are never touched; only files inside the job folder go to the Trash, and proxies follow their source.
- **Brand tools**: brand kits (`brand.save`, `brand.apply`); a client logo library (`brand.scan_logos`, `brand.find_logo { client, tone }`) that measures transparency, coverage and tone from the pixels so meaningless file names do not matter; `brand.colors_from_file` reads the five dominant colours of finished artwork (PSD, AI/PDF, PNG, JPG).
- **Studio operations**: checkpoints, expression validation, text QA, colour-management report and setup, data-driven comps, frame diffing, background rendering with `aerender`, and a refresh of the installed-effects list into the knowledge base.
- **Knowledge base (`ae_guide`)**: workflow rules, easing and timing, kinetic typography, glow, grading, 3D, ExtendScript cookbook, script rules, render order, project organisation, export specs, project clean-up, tool and plug-in selection, transition selection, client how-to, and the installed plug-ins, presets, scripts and MOGRTs (`npm run quet-plugin`). JSON data next to a note of the same name is read through the note.
- **Error hints** (`src/error-hints.ts`) for the 3D renderer, null Position, separated dimensions, expressions, fonts and dialogs; `eval.run` refuses code containing redacted placeholders.

### Changed

- Phase-2 presets with overshoot or bounce (`pop`, `drop`, `flip`, `stretch`, `swing`, and `rise`/`slide` with `overshoot`) are now fitted to a physical curve (back ease, gravity with a hop, damped spring) instead of hand-set keys, which were 9 to 36 % off; entrances and exits are within 0.5 %, and their keys carry speeds.
- Machine-specific paths (logo library) come from environment variables or a git-ignored `config.local.json`.
- Package renamed to `mcp-after-effects`.

### Fixed

- After Effects could crash on `addProperty` with a made-up shape item: on shape Contents, `canAddProperty` answers true for any "ADBE Vector Filter/Shape/Graphic - …" name. `property.add` and project import now go through `AE.safeAddProperty`, which checks shape items against the verified list (`AE.SHAPE_ITEMS`).
- `effect.add` checks `canAddProperty` before adding (an unknown matchName used to reach `addProperty` directly) and refuses Apply Color LUT, which opens a file picker that blocks all scripting; `text.add_animator` and project import skip properties AE cannot add instead of calling `addProperty` blindly.
- `instance.dialogs` reports file pickers (drawn by the system's Open and Save Panel Service, so they carry no After Effects window), and `instance.dismiss_dialog` presses Cancel on them and on AE alerts whose button label is only in the accessibility description.
- `text.qa` measures text boxes at the requested time instead of the current playhead.
- The 3D hint no longer attaches to dialog errors.

## [0.3.2] - 2026-10-16

### Security

- Updated the MCP SDK and its dependencies to releases that fix known vulnerabilities.

## [0.3.1] - 2026-09-29

### Added

- Modal dialogs are detected and named: calls fail with `DIALOG_OPEN` quoting the dialog's text instead of a bare timeout. `instance.dialogs` lists open dialogs and `instance.dismiss_dialog` closes one with Escape (its cancel action, so nothing is saved or discarded).
- Dialog detection on macOS through Accessibility (`AXModal`), with a window-list fallback when the permission is missing. `instance.start` on macOS works through `open -n`.

### Fixed

- Calls no longer stack "Cannot run a script while a modal dialog is waiting" alerts: the push path checks for dialogs before launching and stops with `DIALOG_OPEN`.

## [0.3.0] - 2026-09-28

### Added

- Multiple After Effects instances (`-m`) through a resident agent installed into `Scripts/Startup` (`install-agent`, `uninstall-agent`, `agent-status`, `instances` CLI subcommands); `AE_MCP_INSTANCE` and a per-call `instance` argument; `NO_INSTANCE` error code.
- Worker instances: `instance.start`, `instance.stop`, `instance.list`, `project.merge`.
- Composite operations: `keyframe.apply`; layout and timing (`layer.set_anchor`, `layer.set_timing`, `layer.set_visibility_schedule`, `comp.set_layer_order`, `comp.resize`, `project.rename`, `layer.create_adjustment`); shape contents (`shape.group_bounds`, `shape.recolor`, `shape.signature`, `layer.split_groups`, `layer.convert_to_shapes`); geometric masks; `render.variants`, `comp.sample`, contact sheets and frame analysis on `ae_render_frame`; `layer.copy_to_comp` options.
- Array targets for layer arguments; new ExtendScript helpers listed by `ae_context`; `detail: 'summary'` layer info; keyframe easing in JSON export and import; several frames per `ae_render_frame` call; script errors report the failing line and an excerpt; render template names matched case-insensitively.

### Changed

- `keyframe.set_easing`'s `hold` preset is documented as symmetric; one-sided hold is `keyframe.apply interp: 'hold'`.

### Fixed

- A call could run against a throwaway After Effects instance; writes to separated Position failed silently; `layer.copy_to_comp` acted on the wrong layer; every item was reported as a folder (left-associative ternaries in ExtendScript, now linted); render queue output folders are created when missing.

## [0.2.0] - 2026-08-12

### Added

- 61 operations covering the 2024–2026 scripting surface: box and vertical text, per-range styling, text measurement, variable fonts, glyph checks, raw render-queue settings, 3D renderers and parametric meshes, footage reload and placeholders, keyframe interpolation and labels, effect and property reordering, dropdown controls, project XMP and swatches, preferences, font management, Essential Graphics media replacement.
- App-configuration operations require `confirm: true`.
- Enum names in `layer.set_props`; more mask properties; dialog suppression in the dispatcher.

### Fixed

- `silhouetteAlpha` blend mode, track mattes on any layer, undo stack corruption across project boundaries, 3D layer types in `project.find_layers`, generic objects serialised as `null`.

## [0.1.3] - 2026-08-11

### Fixed

- `project.undo` now runs outside the undo group so it actually reverts the previous call.

## [0.1.2] - 2026-08-10

### Fixed

- Release mirror publishing guard.

## [0.1.1] - 2026-08-10

### Fixed

- Calls timed out on After Effects builds without native `JSON`; dispatcher errors could raise a blocking dialog; `layer.move` failed for every layer; unserialisable responses now fail immediately.

## [0.1.0] - 2026-08-09

### Added

- 136 atomic operations across 21 categories, stable layer references (`{ id }`), colour-managed frame capture, batched reads, macOS support, schema validation before After Effects is contacted, read-only mode and category allowlist, a unified error envelope, configurable IPC mailbox and timeouts.

### Security

- Arguments are never interpolated as code into generated ExtendScript; `eval.run` is opt-in; the IPC mailbox is private (`0700`).
