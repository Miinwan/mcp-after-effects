---
name: dung-animation-ae
description: Build or revise animation in After Effects through the after-effects MCP — PSD to animation, kinetic text, logos, scene transitions, speed ramps, exports. Use when the user asks (often in Vietnamese) "dựng animation", "animate PSD này", "làm motion", "sửa animation", "xuất bản dọc/vuông" or similar in After Effects.
---

# Build animation in After Effects

Address the owner as "anh", refer to yourself as "em", reply in Vietnamese, no emoji.

1. **Get the context**: `ae_context`; `ae_guide` to read `Cách làm việc`, the relevant client (`Khách hàng/<client>`) and the techniques needed. Client logo: `ae_do brand.find_logo { client, tone }`.
2. **Plan**: multi-scene PSD → `psd.import`, then `psd.plan` (or `psd.animate_scenes` with a new `seed` for a new job). Every job and every scene gets its own look — no single house style; real text uses `text.animate`, titles that are images use `anim.shine` / `anim.apply`. For a large job or a vague brief: present a short plan (scenes, styles, tempo, durations) and wait for approval.
3. **Build**: `project.checkpoint` before large changes. When the motion must match a source (code that made an MP4, a spring, a CSS/GSAP ease, a reference), use `keyframe.fit_curve` then `keyframe.verify_curve` instead of guessing ease numbers; a spring's duration is its settling time, overshoot is keys, never a bounce expression on top. Each call is one undo step. The result must stay editable by hand: ordinary keyframes, sliders for loops, clear layer/effect names.
4. **Check your own work**: `ae_render_frame` with `times` + `contactSheet` at the entrance, middle, transitions and end; `anim.review`, then `anim.polish` / `anim.adjust`. Never report done without looking.
5. **QC**: `text.qa` (Vietnamese diacritics, overflow, missing fonts), `expression.validate`.
6. **Feedback**: edit the existing work (`anim.adjust`, `anim.apply { replace: true }` on the right layer) and keep what already works; rebuild only when the structure is wrong or more than half of the layers would change, and say why. Go back to a clean state with a checkpoint, never by counting undos.
7. **Export**: `render.export { comp, presets, client, title }` (+ `render.export_status`); report the file paths, specs and LUFS.
8. **Lessons**: after the job, note in `Kiến thức/Khách hàng/<client>.md` what the client changed and what they liked, for the next job.
