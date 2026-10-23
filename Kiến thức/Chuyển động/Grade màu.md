# Colour grading — Use when color-grading a comp with a layered adjustment stack, CC Toner 4-tone, LUT, or palette recipe. Gives grade-stack order, naming, and look guidance. Needs source color space, target look, and comp scope.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

AE GRADE STACK — layered adjustment, not a single LUT
Color grading in ae-mcp: build a stack of named adjustment layers with ae_createLayer / ae_applyEffect. Never collapse everything into one LUT or one Looks pass.

=== IRON RULE: grading is a layer stack, not a single LUT ===
A frame typically needs >= 3 independent color operations: glow extension, sharpening, overall hue shift, final contrast. These have different blend modes and scopes — stuffing them into one LUT means they fight each other.

Standard 4-layer stack (bottom to top inside the comp):
  01_glow    — Glow or Deep Glow, blend mode Add
  02_sharpen — Unsharp Mask / Curves for edge contrast, blend mode Normal
  03_color   — CC Toner 4-tone for hue unification, blend mode Normal
  04_final   — final contrast / gamma tuck, blend mode Normal

Create each with ae_createLayer (type "adjustment"), then name it immediately, then apply effects with ae_applyEffect. If the comp looks flat or muddy, check whether Glow and Curves are stacked on the same layer — split them.

=== CC Toner 4-tone beats Curves for hue work ===
CC Toner maps the image to 4 anchor colours (Highlights / Brights / Midtones / Shadows). You think in colour terms ("what colour should the bright areas be?") rather than RGB math. Curves is still useful for contrast and lift/gamma — use them together on separate adj layers.

Apply with ae_applyEffect (matchName "CC Toner"). Sub-properties by index:
  property(1) = Highlights
  property(2) = Brights
  property(3) = Midtones
  property(4) = Shadows
  property(5) = Blend (0-100)

Blend sweet spot: 25–65%
  25–35% — CG + hand-drawn mix, keeps material texture
  50–65% — strong unification, sacrifices some original colour variety
Never use Blend 100% — obliterates original colour information.

=== Apply CC Toner per-precomp, NOT across the whole film ===
Wrong:  one CC Toner adj over the entire Final Comp
Right:  each precomp (character, BG, particles, text) gets its own CC Toner adj inside it
Different precomps may use different Toner recipes as long as the palette is coherent; visual unity comes from a shared colour palette, not a single blunt pass.

=== PALETTE RECIPES ===

--- A. Moonlit Cold (night / sci-fi / snow) ---
  Highlights: #E0E4F8  (near-white, blue-shifted — moonlight highs)
  Brights:    #A3AEFA  (cool lavender-blue — mid-high atmosphere)
  Midtones:   #4F51A0  (deep violet-blue — shadow dominant)
  Shadows:    #10122A  (near-black with purple — deepest darks)
  Blend: 62%
Pair with: Deep Glow threshold 0.5+, colour #D9DBFF (cold white); volume light warm #A98A80 for cold/warm contrast.

--- B. Amber Warm / Teal-Orange (interiors, lanterns, tavern) ---
  Highlights: #F0E1B8  (cream)
  Brights:    #BFA878  (amber — dominant warm)
  Midtones:   #454553  (cool teal-grey — the teal in teal-orange)
  Shadows:    #1A1820  (near-black, slightly cold)
  Blend: 25–35%  (keeps original material colour; sources vary greatly)
Pair with: Optical Flares multi-point, 3200 K; physically motivated key light positions.

--- C. Ritual Low-Sat (MV / narrative / ceremonial) ---
  Highlights: #F2EEE2  (near-white warm cream)
  Brights:    #E8E4D8  (pale warm — dominant)
  Midtones:   #7A766B  (neutral grey, faint warm cast)
  Shadows:    #1C1A18  (near-black, subtly warm)
  Blend: 60–70%  (high unification — "same skin tone across the whole film")
Pair with: CROSSPHERE Bokeh radius pulse; white flash ease-in for beat sync.

--- Variant tweaks ---
  teal-orange stronger:       B Midtones -> #3A4045 (deeper teal)
  cyberpunk neon pink-purple: A Highlights -> #FF8FF0, Brights -> #9F4FFA, Blend 80%
  minimal / high-white:       C Highlights -> #FBF8F0, Blend 70%+

=== LAYER ORDER in the comp (bottom → top) ===
  Main footage / BG renders
  Particle layers (Particular / CC Particle World)
  Grain layer (Add Grain or fast-grain)
  Adj stack: 01_glow / 02_sharpen / 03_color / 04_final
  Text / UI / borders / cinema bars  (topmost)
Grain must sit BELOW the adj stack so the grade processes the grain as if it were recorded by the camera — not a digital afterthought.

=== NEVER DO ===
  - One LUT / Looks pass as the only grade
  - CC Toner Blend 100% (destroys original colour)
  - Different precomps with wildly different palettes (visual tear)
  - Grading before setting project to 32 bpc — EXR data will be clipped
  - Picking colours with an eyedropper from a reference still (gives mixed composite colour, not per-channel values)

=== QUICK DECISION: which palette? ===
  User says: cold / night / moon / sci-fi   -> Recipe A, Blend ~62%
  User says: warm / interior / lantern       -> Recipe B, Blend 25-35%
  User says: vestige / ritual / low-sat      -> Recipe C, Blend 60-70%
  User says: teal-orange explicitly           -> Recipe B, deepen Midtones
  User says: cyberpunk / neon                -> Recipe A variant, Blend 80%

