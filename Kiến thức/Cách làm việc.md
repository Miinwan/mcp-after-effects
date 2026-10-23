# Working rules — Use at the start of every After Effects session: the owner's mandatory rules for driving After Effects.

Read this first in every After Effects session. The owner is a video editor and motion designer whose clients are hotels, resorts, F&B, malls and events. Address the owner as "anh" and reply in Vietnamese.

## Every session
1. `ae_context` first: open project, active comp, selected layers, helper list.
2. `ae_guide` for the relevant topic before planning motion (easing, typography, installed plug-ins, client brand).
3. Before any edit touching more than a few layers: `ae_do project.checkpoint` with a short label. Checkpoints live in "<project> checkpoints" next to the .aep.
4. One `ae_do` call = one undo step. Group a multi-step change into ONE `batch.run` so a single Cmd+Z reverts it. Never call beginUndoGroup / endUndoGroup inside eval.run — the dispatcher already opens exactly one group (nested groups caused the old "Cmd+Z jumps back past the MCP edit" bug).
5. Look at the result: `ae_render_frame` with `returnImage: true` (default) at the key moments, or `times` + `contactSheet: {}` for motion. Judge spacing, overlap, text overflow and colour yourself before reporting done.
6. Before delivery: `ae_do text.qa` (Vietnamese diacritics, off-frame text, missing fonts) and `ae_do expression.validate`.

## Feedback: fix what is there, do not rebuild
Owner's rule (2026-10-23): when feedback comes in, edit the existing work and keep every part that was not mentioned. Rebuilding from scratch throws away approved details and the owner's own hand edits.
1. Read the current state first (`ae_layer_info`, `anim.review`, a contact sheet) — the comp may contain manual changes since your last call.
2. Map each comment to the smallest edit: timing ("chậm hơn" slower, "trễ chút" a bit later) → `anim.adjust` (shift / duration / speed, re-ease); feel ("mềm hơn" softer, "giật" jerky) → `anim.adjust` inInfluence/outInfluence or `anim.polish`; loop too strong → change the loop's slider value; one element wrong → `anim.apply` with `replace: true` on that layer only.
3. Rebuild only when it is genuinely cheaper: the structure is wrong (comp size, layer split, concept), or more than about half of the layers would change. Say which you chose and why in one line.
4. Checkpoint (`project.checkpoint`) before a large revision so the approved version stays recoverable.
5. Re-run `anim.review` and look at a contact sheet after the edit; report only what changed.

## Leave everything editable by hand
- Animation is written as ordinary keyframes on the layer itself — no locked precomps, no baked renders, no expressions where keyframes would do.
- Loops (`anim.loop`) read Slider Controls on the layer ("Trôi · biên độ (px)", "… · tần số"), tuned by hand in Effect Controls. Re-running keeps the slider values unless a value is passed.
- Name layers and effects clearly (layer names from the PSD, "Blur (anim)", "Wipe (anim)", "LT Title"…). Never lock layers, never shy them, never collapse the owner's work into precomps without asking.
- `anim.apply` never overwrites keys made inside a window unless `replace: true`; keys outside the window are never touched.

## Every job its own look
Owner's rule (2026-10-23): jobs must not all share one animation style for text or images. Be creative per brief.
- `psd.plan` / `psd.animate_scenes` with `seed` compose a look from pools (entrances and directions, per-letter text styles, loops, exits, shine, tempo). New job → new seed; consecutive scenes never repeat hero, headline or exit. Report the seed so a liked version can be rebuilt.
- The composed plan is a starting point: read the brief, the client note and the references, then change presets, timing and accents so the piece fits that client (a resort is not a mall sale).
- Per-letter text animation (`text.animate`) for real text layers; titles that are images get `anim.shine`, `anim.apply` or wipes. Mix several techniques in one piece, but keep one hero move at a time.
- Before reusing an approved look from an earlier job, check that the client wants the same series look; otherwise vary it.

## Visual quality checklist (the "eye")
- Every move is eased (bezier). Linear only for constant motion (spin, scroll, loopOut). Entrances land soft (in-influence 75–90), exits take off soft.
- Motion blur on for anything that moves fast (presets switch it on; comp shutter 180°).
- Stagger related elements 0.06–0.12 s; never 3+ elements starting on the same frame.
- Overshoot small (pop 105–112 %); one hero move at a time; decor loops gentle.
- Before showing a draft: `anim.review` + contact sheet at entrance, mid, end. Fix with `anim.polish` / `anim.adjust`, then show.

## Vietnamese text
- Check glyph coverage (`text.qa` / `font.check_glyphs`) whenever the text has diacritics: many display fonts lack ằ, ẫ, ự, ỹ…
- Keep the line breaks the client wrote; never auto-translate.
- Prices use dots: 2.500.000đ. Dates dd/mm or "Thứ Bảy, 26/10".

## Delivery formats
- Social: 1080x1920 (9:16 reels/TikTok), 1080x1350 (4:5 feed), 1080x1080; LED/billboard sizes vary per venue — read the brief.
- Typical frame rate 25 fps (PAL region) unless the footage says otherwise; 30 fps for some social briefs.
- Renders: H.264 for review and social, ProRes 422 HQ for masters, PNG sequence with alpha for overlays.

## Motion taste (default when there is no brief)
- Clean, energetic, readable: entrances 0.4–0.8 s, ease-out on entrances, ease-in on exits, stagger 0.06–0.12 s between related elements.
- Hold every text long enough to read twice (about 0.25 s per word, minimum 1.5 s).
- One hero motion at a time; decor moves gently (float / sway loops), never competes with the headline.
- Keep logos static and readable at the end for at least 1.5 s.

## Safety
- Never delete layers, comps or footage the owner made without saying so first; prefer disabling.
- Brand kits: `brand.list` / `brand.get` before choosing colours or fonts for a known client.
- Render in the background with `render.background` (aerender) for long renders so AE stays usable — save first.
