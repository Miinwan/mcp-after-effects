# Choosing transitions — Use when deciding which transition to put on a cut (Premiere or After Effects): situation → transition → tool → duration → ease. Only lists what is installed on the owner's machine.

Updated 2026-10-23. Installed: Film Impact (built into Premiere 26.5's Video Transitions), Mister Horse Premiere Composer / Animation Composer (panel only), Adobe's native effects + CycoreFX in AE. Not installed: Sapphire, BCC, Video Copilot, Red Giant.

## How to choose
1. Ask what the cut should feel like: continuity (nobody notices), a change of pace (hit the beat), a change of topic (new section), the ending.
2. A hard cut is the default. Add a transition only when the cut needs to say something; 70–80 % of cuts in an ad are still hard cuts.
3. Pick one main family and one secondary family per video. The next job uses another family (no single look for every job).
4. Put the transition on the music beat: the transition's midpoint (Premiere) or its strongest frame (AE) lands on the beat.

## Situations

| Situation | Premiere (Film Impact, `batch_add_transitions` / `add_transition_to_clip`) | After Effects (`anim.scene_transition`, `template.transition`) | Duration | Ease |
|---|---|---|---|---|
| Hotel, resort, spa: slow, upscale | Light Leak, Blur Dissolve, Film Dissolve | `dream` | 16–24 frames (0.7–1 s) | soft 0.1/33 on both ends, no overshoot |
| F&B, food, bar | Whip in the camera's pan direction, Push, Light Sweep | `whip`, `push` | 8–12 frames | fast in, slow out (out influence 70–85 %) |
| Mall, sale, promotion | Flash (on the beat), Stretch Wipe, Shape Flow | `template.transition` flash / slide_panels, `slide_up` | 4–10 frames | punchy, speed ramp in the middle |
| Event recap, music, youth teaser | Glitch, Flash, Zoom Blur, Earthquake (sparingly) | `zoom`, `whip` | 4–8 frames | cut on the beat, sharp ease |
| New topic / chapter | 3D Roll, Page Peel, Dip to Black/White | `flip`, `template.transition` wipe/circle | 12–16 frames | mid ease, slight overshoot on flips |
| Interview, testimonial | Hard cut, J-cut/L-cut audio; Cross Dissolve for time jumps | none | 8–12 frames | — |
| Logo or PSD graphics into the next scene | Shape Dissolve, Linear Wipe | `push`, `slide_up`, PSD auto (`psd.animate_scenes transition:"auto"`) | 0.5–0.8 s | 0.1/16.7 (the golden pair, see Ease và timing.md) |
| Ending into the endcard | Dip to White (white background) / Dip to Black (dark background), Luma Fade | `dream`, pinned logo | 18–30 frames | decelerating |

## Notes per tool
- Premiere: Film Impact transitions are applied by name and tuned in Effect Controls; the Film Impact Dashboard panel is for previewing. Premiere Composer (Mister Horse) has transition presets but only through its panel; the MCP cannot call it.
- After Effects: `anim.scene_transition` works on precomp layers with motion blur and easing built in; retime with `anim.adjust`. Animation Composer is panel-only; the MCP reads the result and retimes it.
- Complex transitions on Premiere footage: `send_to_after_effects` → build in AE → `return_from_after_effects`.
- Keep everything editable by hand: Film Impact transitions are ordinary clip transitions, AE ones are ordinary keyframes (never locked behind expressions).
