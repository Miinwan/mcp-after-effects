# Kinetic typography — Use when animating kinetic typography, titles, 4-phase reveals, or spring/beat motion. Gives entrance styles, ease pairs, and type hierarchy. Needs text layers, timing, and visual rhythm.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

KINETIC TYPOGRAPHY REFERENCE — ae-mcp idiom
Run all JSX via ae_exec. Validate expression strings with ae_validateExpressions before setting. Preview single frames with ae_previewFrame. Ease arrays can be set with AEMCP.easeKeys helpers where available.

=== ANTI-SOIL DIAGNOSIS ("土味" checklist) ===
If a comp hits >=2 of these, it is amateur:
  - Text pops with no preparation  ->  missing ANTICIPATION (0.1-0.2 s reverse wind-up)
  - Text lands and freezes          ->  missing OVERSHOOT + SETTLE
  - Text exists alone on screen     ->  missing SECONDARY MOTION (lines / brackets / particles)
  - Scale is linear or Easy Ease 33.3  ->  flat default, no punch
  - One font size across all text   ->  missing TYPOGRAPHY HIERARCHY
  - Elements enter simultaneously   ->  missing STAGGER
  - Static hold looks like a PNG    ->  missing IDLE MICRO-MOTION

First principle: animation is not "text that moves" — it is the way text appears inside a choreographed visual event.

=== 4-PHASE REVEAL TEMPLATE ===
Every text entrance follows these four phases. Times shown for BPM 123 @ 25 fps (1 beat = 12 f).
Phase timings can scale proportionally for other BPMs.

  [1] ANTICIPATION   3-5 f (0.1-0.2 s)  scale 100->92 or position -10 px offset
                     curve: linear or accelerate-out
  [2] IMPACT         4-6 f (0.16-0.24 s)  main reveal — scale 92->108 (overshoot) / mask wipe
                     curve: snap ease-out  Out=0.1 / In=80
  [3] SETTLE         4-8 f (0.16-0.32 s)  overshoot back 108->100
                     curve: ease-in  Out=80 / In=0.1
  [4] EXIT           6-12 f               reverse motion + opacity 100->0
                     curve: quick ease-in

Five-phase variant (professional): anticipation(15%) / action(50%) / overshoot(20%) / settle(15%) / hold(>=18 f).
Hold must stay >= 18 f so the viewer can read the text. Hold is NOT static — idle micro-motion still runs.

=== KEY EASE PAIRS (replace Easy Ease 33.3 everywhere) ===

  Name              Out vel / In vel   CSS cubic-bezier          Feel
  Snap-impact       0.1 / 80           (0.16,1,0.3,1)            text hammers in — primary entrance
  easeOutQuint      0 / 75             (0.22,1,0.36,1)           slide in then soft stop
  easeOutBack       0 / 100 (oversh.)  (0.34,1.56,0.64,1)        spring pop with bounce
  Smooth flow       33.3 / 33.3        (0.45,0,0.55,1)           neutral transition
  Quick punch       0.1 / 0.1          (0.12,0,0.88,1)           short sharp hit
  Lazy drift        80 / 33.3          (0.7,0,0.9,1)             floating slow entry
  easeInOutQuint    75 / 75            (0.83,0,0.17,1)           push one element off to bring next one in

In AE: Keyframe Velocity dialog — Outgoing Influence = Out vel, Incoming Influence = In vel.
Never use a single ease style throughout one composition.

=== 8 ENTRANCE STYLES (2026 list) ===

1. MASK WIPE — rectangle mask slides across revealing text; pair with micro scale + position drift.
   Good for: title cards, hero text, VJ poster style.
   ae_exec: add mask to text layer, keyframe maskShape expansion over 8-12 f with Out=0.1/In=80.

2. SPLIT REVEAL — text split top/bottom halves slide from opposite directions to center.
   Add thin accent line (2-4 px) at the meeting seam. Good for: keyword impact.

3. GLYPH CASCADE — per-character stagger 1-2 f delay; 5-char word = 5-10 f full reveal.
   Enable motion blur. AE: Text Animator + Range Selector Offset 0%->-100% over duration.
   Good for: short words (DANCE, FREE, BREAK), lyrics.

4. STRETCH-SMEAR — entry: scale X=200% Y=50%, settle to 100/100 over 4 f; full motion blur.
   Good for: rock / speed feel.

5. POP-SQUASH — scale 0->110->95->102->100 over 6 f (4 keyframes, each with different ease).
   Add rotation oscillation -3->+2->0 deg. Good for: playful / cartoon / upbeat.

6. TYPE-ON GLITCH — chars appear one by one; each char gets +-1-2 px X/Y jitter for 1 f;
   add chromatic aberration (ADBE CHANNEL BLUR, RGB split 1-3 px) on first reveal frame.
   Good for: cyberpunk / electronic / digital.

7. 3D EXTRUDE DROP — text from Z+200 to Z=0; rotation X: -25->0 deg;
   per-character animator + Offset 0->100 over 12 f. Good for: giant hero single word.

8. LAYOUT CRASH — multiple words enter from different screen edges, each offset 1-3 f;
   all hit lock-in simultaneously on the last frame; add whole-comp position shake 5 px for 1 f.
   Good for: dance-break hit / paragraph opener / climax.

=== SECONDARY MOTION — must-haves (text without these reads as isolated) ===

A. GEOMETRIC LINES — thin horizontal/vertical line (2-4 px, color = accent) below or beside hero text;
   mask wipe in synchronised with main reveal; length matches text width or 1.5x.

B. BRACKETS / CORNER TICKS — small L-shaped corner marks [  ] or corner ticks at text edges;
   gives UI-framed feel. Stagger entry +2-4 f after hero.

C. TAG / NUMBER — small mono text (VOL.01 / SECTION 02 / 00:00:00) at 1/8 hero size, muted color.
   Stagger in last among the supporting group.

D. PROGRESS STRIP — narrow filled rect below hero, animating from 0->100% width in sync with reveal.
   Acts as visual anchor: "this section is active."

E. PARTICLE BURST — 6-12 small shapes (circles / dots) spawn on impact frame, scale 0->1 over 6 f,
   fly outward in radial directions, opacity->0 by frame 18. Colors: bright white + accent color.

F. GRAIN OVERLAY — full-frame noise solid, 24% opacity, 0.5-1 px noise (ADBE Add Noise2 ~8%).
   Instantly removes flat PowerPoint feel. Run ae_exec to add as adjustment layer above all.

Hold frames must also have micro-motion: wiggle(0.3, 1.5) on position, wiggle(0.5, 0.3) on rotation.
No static holds — viewer should sense breathing at all times.

=== TYPOGRAPHY HIERARCHY (3 tiers minimum) ===

  Tier    Size ratio  Count  Examples
  HERO    1.0x        1-2    DANCE / main keyword (800-1200 pt)
  SUB     0.3-0.5x    2-4    "LET'S DANCE RIGHT NOW" / supporting phrase
  MICRO   0.08-0.15x  1-3    VOL.01 / 00:00:00 / SECTION 02-B

Color rule: same hue for all three tiers = stiff. Hero = accent color; Sub = contrast; Micro = muted 50% gray.

=== BPM BEAT-SYNC vs MUSICAL PHRASE ===

Beat-sync (every beat = 1 action):
  BPM 123 = 12.2 f/beat. Entrances snap to beat edge.
  Risk: mechanical fatigue after 30 s. Reserve for climax / dancebreak pulse.

Musical phrase (every 4/8/16 beats = 1 action):
  4 beats @ 120 BPM = 2 s = 48 f. Entrances snap to phrase boundary.
  Feels like breathing. Use for verses / keyword reveals / lyric cuts.

Mixed (recommended):
  Hero text reveal -> phrase boundary.
  Secondary motion (lines / brackets / strip) -> beat.
  Hero is stable; decoration tracks rhythm.

Beat-sync workflow: set AE Project markers at BPM intervals -> snap all keyframes to markers.
  ae_exec: comp.markerProperty.addProperty(); set marker at time = beatIndex * (60/bpm).

=== STAGGER LAYER TIMING ===

Three-tier stagger for multi-element scenes:
  Hero text    -> t = 0
  Sub text     -> t + 3 f   (at 120 BPM: ~0.10 s)
  Decorations  -> t + 9 f   (at 120 BPM: ~0.14 s gap from sub)
  BG elements  -> t + 18 f

Gap values by BPM:
  BPM 90  : Hero-Sub 0.12-0.18 s / Sub-Deco 0.15-0.25 s
  BPM 120 : Hero-Sub 0.08-0.12 s / Sub-Deco 0.10-0.18 s
  BPM 140 : Hero-Sub 0.06-0.10 s / Sub-Deco 0.08-0.14 s
  BPM 174 : Hero-Sub 0.04-0.08 s / Sub-Deco 0.06-0.10 s

Intervals are intentionally uneven — increasing gap by layer tier avoids mechanical feel.

=== DENSITY CURVE — 30 s segment blueprint ===

Active element count should arc, not stay flat:
  Start     0-15%    1-2 elements  (black / minimal — one element reveals)
  Buildup   15-30%   3-4 elements  (secondary + idle kick in)
  Peak      30-80%   5-7 elements  (all active, beat punches, transitions)
  Wind-down 80-95%   4->2 elements (decorations fade, hero remains)
  End hold  95-100%  1 element     (hero holds >= 18 f, still with micro-motion)

Flat density = amateur. Peak element count: aim for 5-7 simultaneously active layers.

=== TRANSITION VERBS (not just cut or crossfade) ===

  mask reveal   shape/rect mask wipes off to expose next element (Linear Wipe effect or shape layer matte)
  push          outgoing element moves off while incoming slides in behind it (Position keyframes, staggered)
  type morph    old word exits: Pos Y -80 px + Blur 0->18 + Opacity 0, 8 f easeInQuint;
                new word enters: Scale 80->105->100 + Blur 24->0 + Tracking +30->0, 14 f easeOutBack;
                overlap the two by 4 f; hold >= 50 f after settle
  shape morph   shape layer Path keyframes between states
  grid swap     shape array with per-cell time offset stagger
  scale-explode element Scale 100->200% + Opacity 100->0 + radial blur
  glitch cut    CC Force Motion Blur horizontal displacement 0.2 s; black frames <= 2 f only

Hard cut is legal only as a dramatic accent (beat drop). Use 1-3 times maximum in 30 s.

=== IDLE MICRO-MOTION EXPRESSIONS ===

Apply to hold-phase layers. Paste via ae_exec, then validate with ae_validateExpressions.

Position gentle float (apply to text layer Position):
  wiggle(0.3, 1.5)
  // 0.3 Hz = drifts every ~3.3 s; amplitude 1.5 px — sub-pixel breathing

Rotation micro-wobble (apply to decoration Rotation):
  wiggle(0.6, 4)
  // every ~1.7 s, +-4 deg

Scale breath sine (apply to frame/bracket layer Scale):
  s = 1 + Math.sin(time * Math.PI / 0.8) * 0.005;
  [s * 100, s * 100]
  // period 1.6 s, +-0.5% — nearly invisible but not dead

Master null camera drift (parent all layers to null, apply to null Rotation):
  0.4 * Math.sin(time * Math.PI / 2)
  // period 4 s, +-0.4 deg — simulates handheld parallax

All four expressions have near-zero CPU cost. Always add them.

=== SPRING OVERSHOOT EXPRESSION ===

Apply to Scale property instead of manual 4-keyframe overshoot.
Validate first: ae_validateExpressions([expressionString]).

  n = 0;
  if (numKeys > 0) {
    n = nearestKey(time).index;
    if (key(n).time > time) n--;
  }
  if (n == 0) {
    t = 0;
  } else {
    t = time - key(n).time;
  }
  amp = 0.08;
  freq = 3.5;
  decay = 6.0;
  if (n > 0 && t < 1) {
    target = key(n).value;
    [target[0] + target[0] * amp * Math.sin(freq*2*Math.PI*t) / Math.exp(decay*t),
     target[1] + target[1] * amp * Math.sin(freq*2*Math.PI*t) / Math.exp(decay*t)]
  } else {
    value;
  }

Parameters: amp=0.08 (8% overshoot), freq=3.5 oscillations/s, decay=6 (damps fast).
Tune amp 0.04-0.12 for subtler or stronger spring.

=== BEAT-PULSE EXPRESSION ===

Apply to Scale when you want text to pulse on every beat (climax / dancebreak sections only).

  bpm = 123;
  beat = 60 / bpm;
  amp = 0.05;
  pulse = Math.exp(-((time % beat) / beat) * 5);
  [100 + 100 * amp * pulse, 100 + 100 * amp * pulse]

Change bpm to match the track. amp=0.05 = 5% scale pulse per beat.

=== FOUR-PROPERTY KINETIC TEXT SYNC ===

Single-attribute fade is amateur. Sync all four:

  Property    From        To              Ease              Duration
  Position Y  -80 px      0               easeOutQuint      14 f
  Scale       80%         100% (via 105)  easeOutBack       16 f
  Blur        24 px       0               easeOutExpo       12 f
  Tracking    +30         0               easeOutQuint      18 f

In ae_exec: set via Text Animator + Range Selector for per-character offset, or set each
property keyframe explicitly on the TextLayer. Motion blur must be enabled on all moving layers.

Per-character stagger:
  Text Layer -> Animator -> Add Position + Scale + Tracking
  Range Selector -> Advanced -> Offset: 0% -> -100% over animation duration

=== MOTION BLUR — always on ===

Comp Settings -> Enable Motion Blur. Shutter Angle: 180 deg (default, near-real shutter).
Toggle motion blur switch on every moving layer in ae_exec:
  layer.motionBlur = true;

No motion blur = toy. Motion blur on = broadcast opener feel immediately.

=== ROCK / CONCERT 7-PIECE EFFECT STACK ===

  Effect              matchName              Params               When active
  Grain               ADBE Add Noise2        Amount 8-12%         always (verse+)
  Chromatic aberr.    ADBE CHANNEL BLUR      RGB split 1-3 px     always (verse+)
  Glitch RGB split    3 shape copies R/G/B   X offset +-2 px      intermittent 1-2 f/2 s
  Camera shake        wiggle(2,8) on Pos     freq 2 amp 8 px      chorus+
  Light leak          Screen-blend PNG OL    opacity 25-40%       chorus+
  Vignette            black solid SUBTRACT   mask feather, 50-70% always
  Strobe flash        white solid kf 0/100/0 2 f                  climax hit frames

Trigger map:
  Verse    : grain + chromatic + vignette only
  Chorus   : add camera shake + light leak
  Climax   : add glitch RGB split + strobe flash

Vignette warning: opacity > 50% can crush darks — exported PNGs may appear near-black.
Verify with ae_previewFrame and a test ae_exec saveFrameToPng at reduced opacity first.

=== DELIVERY CHECKLIST (run before marking done) ===

1. Hero text has anticipation pose (reverse offset 0.1-0.2 s before impact)?
2. Hero settle has overshoot then spring back (not a hard stop)?
3. At least 2 secondary motion types active (line / bracket / tag / particle / grain)?
4. Typography has 3 size tiers (hero / sub / micro)?
5. BPM locked — entrances snap to beat or phrase markers, not arbitrary times?
6. No hold frame is a static PNG (idle micro-motion expressions on all hold layers)?
7. Stagger: hero enters first, sub +3 f, decorations +9 f (exact values scale with BPM)?
8. Motion blur enabled on all moving layers, Shutter 180 deg?
9. At least 3 different ease styles used in the composition?
10. Rock/concert scenes: >= 4 of 7 effect pieces active at peak (grain + chromatic + shake + light leak minimum)?

If any answer is No — fix before delivering. Anything that fails items 1-3 will read as amateur on first view.
