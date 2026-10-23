# After Effects tips — Use when working with 3D renderers, particles, property paths or timing details.

> Tool names below are generic; map them to `ae_do` operations via `ae_catalog`. Property paths in `ae_do` are arrays, not '/'-separated strings.

---
name: ae-mcp
description: Drive Adobe After Effects through the ae-mcp tools. Use when the user wants to create, edit, animate or render anything in After Effects - compositions, text, shape layers and bezier paths, trim paths and other shape operators, masks, keyframes and easing, expressions, effects and particles (CC Particle World, Particle Systems II, Particle Playground), 3D layers with cameras, lights and extrusion, lower thirds, title cards, transitions, logo reveals, markers, and the render queue or Adobe Media Encoder. Trigger on phrases like "in After Effects", "make a motion graphic", "animate this", "add keyframes", "draw on a line", "mask this", "extrude the text", "render this comp", or AE terms like comp, precomp, expression, trim paths, render queue.
---

# After Effects MCP

These tools send ExtendScript to After Effects through a CEP panel. **The AE-MCP panel must be open** (Window > Extensions > AE-MCP). If every call times out, ask the user to open it.

For worked recipes, read `examples.md` in this skill.

## Before you act

- **Ask before calling tools that change the open project as a whole**: `save_project`, `close_project`, `open_project`, `create_project`, `reduce_project`, `collect_files`, `organize_project_items`, `import_footage`, `import_folder`, `replace_footage`. The user usually has real work open.
- **Look before you edit.** Call `list_compositions`, `list_layers` or `get_layer_info` rather than guessing names.
- **Each tool call runs inside an undo group.** Prefer a few purposeful calls over many tiny ones, so the user can undo cleanly.
- Times are in **seconds**. Colours are **0-1** RGB objects: `{"r": 1, "g": 0.5, "b": 0}`.

## Property paths

Keyframe, expression and effect-property tools take a `property` string.

**1. Prefer the camelCase shortcuts.** They resolve to internal match names, so they also work on non-English installs:

| Shortcut | Property |
|---|---|
| `position`, `anchorPoint`, `scale`, `opacity` | Transform |
| `rotation` | Rotation (Z rotation on 3D layers) |
| `rotationX`, `rotationY`, `rotationZ` | 3D rotation |
| `sourceText` | Text layer Source Text |
| `audioLevels` | Audio levels |
| `pointOfInterest` | Camera point of interest (AE stores it as the camera's anchor point) |
| `zoom`, `focusDistance`, `aperture` | Camera options |
| `lightIntensity`, `lightColor`, `coneAngle`, `coneFeather`, `castsShadows`, `shadowDarkness`, `shadowDiffusion` | Light options |

English display names (`"Position"`, `"Rotation"`, `"Source Text"`) also work on an English install.

**2. For nested properties, separate levels with `/` - never `.`.**

```
Effects/Gaussian Blur/Blurriness
Effects/Gradient Ramp/Start Color
Contents/Group 1/Transform/Position
Contents/Group 1/Contents/Trim Paths 1/End
```

A dotted path such as `Effects.Gaussian Blur.Blurriness` is looked up as one property with that literal name and fails with "Property not found".

**3. Shape groups created by these tools are named `Group 1`**, not `Shape 1` (that name only appears on shapes drawn by hand with the Pen tool). Operators live *inside* the group's `Contents`, so Trim Paths is `Contents/Group 1/Contents/Trim Paths 1/...`.

For camera, light and material properties, use the dedicated `set_*_options` tools instead of paths - they report which properties the current renderer refused.

## Value formats

| Property | Format |
|---|---|
| Position | `[960, 540]`, `[x, y, z]` on 3D layers, or `{"x": 960, "y": 540}` |
| Scale | `[100, 100]` (percent) |
| Rotation | `45` (degrees) |
| Opacity | `100` (0-100) |
| Shape fill / stroke colour | `{"r", "g", "b"}` |
| Effect colour parameter via `set_keyframe` | `[r, g, b, a]`, 0-1 |

**Enum values are After Effects constants, in capitals.** `modify_layer` `blendMode` takes `NORMAL`, `SCREEN`, `MULTIPLY`, `ADD`, `OVERLAY` and so on - `"Screen"` fails with "Value is undefined". Text `justification` is `LEFT` / `CENTER` / `RIGHT`; `apply_easy_ease` `type` is `IN` / `OUT` / `BOTH`.

## Tool map

| Area | Tools |
|---|---|
| Project | `get_project_info`, `list_project_items`, `find_missing_footage`, `set_proxy`, `remove_proxy`, plus the project-wide tools listed under "Before you act" |
| Compositions | `create_composition`, `modify_composition`, `duplicate_composition`, `delete_composition`, `list_compositions`, `get_composition_info`, `get_comp_report`, `set_active_composition`, `set_work_area`, `render_frame` |
| Layers | `add_solid_layer`, `add_text_layer`, `add_text_layer_advanced`, `add_shape_layer`, `add_null_layer`, `add_adjustment_layer`, `add_camera_layer`, `add_light_layer`, `add_av_layer`, `modify_layer`, `delete_layer`, `list_layers`, `get_layer_info`, `precompose_layers` (see Known issues) |
| Shape paths | `create_path`, `get_path`, `set_path_keyframes`, `add_shape_operator` |
| Masks | `add_mask`, `list_masks`, `get_mask_path`, `set_mask_path`, `set_mask_keyframes`, `set_mask_properties`, `delete_mask` |
| 3D | `set_comp_renderer`, `get_3d_info`, `set_3d_layer`, `set_material_options`, `set_geometry_options`, `set_camera_options`, `set_light_options` |
| Keyframes | `set_keyframe`, `set_keyframe_advanced`, `get_keyframes`, `apply_easy_ease`, `set_temporal_ease`, `offset_keyframes`, `scale_keyframe_timing`, `reverse_keyframes`, `copy_keyframes` |
| Expressions | `set_expression`, `get_expression`, `remove_expression`, `enable_expression`, `batch_set_expressions`, `add_expression_control`, `apply_expression_template`, `link_properties` |
| Effects | `apply_effect`, `apply_effect_template`, `modify_effect_properties`, `remove_effect`, `reorder_effects`, `copy_effects`, `list_effects` |
| Templates | `create_lower_third`, `create_title_card`, `create_transition`, `create_logo_reveal`, `create_text_animator` |
| Markers and time | `add_composition_marker`, `add_layer_marker`, `get_markers`, `delete_marker`, `get_current_time`, `set_current_time`, `snap_to_marker`, `get_nearest_marker`, `navigate_markers` |
| Render | `add_to_render_queue`, `list_render_queue`, `list_render_templates`, `set_render_queue_item`, `remove_from_render_queue`, `control_render`, `queue_in_ame` |

**Not available** - say so rather than improvising: duplicating a layer, time remapping, the motion-blur switch, track mattes, layer styles, and setting gradient colours.

## Keyframes

- `set_keyframe` - value at a time. `set_keyframe_advanced` adds `inType` / `outType` (`LINEAR`, `BEZIER`, `HOLD`) and `inEase` / `outEase` as `{"speed": 0, "influence": 33}`.
- `apply_easy_ease` - `keyframeIndex` for one key, omit it for all. Works on Position.
- `set_temporal_ease` - `keyframeIndex`, `inSpeed`, `inInfluence`, `outSpeed`, `outInfluence`.
- `offset_keyframes` - `offset` in seconds. Refuses, changing nothing, if any key would move before 0.
- `scale_keyframe_timing` - **`scale`** (must be > 0; 2 doubles the timing) and optional `anchorTime`. Refuses if keys would move before 0 or merge onto one frame.
- `copy_keyframes` - `sourceLayerName`, `sourceProperty`, `targetLayerName`, `targetProperty`, `timeOffset`.

If one of these refuses with "Nothing was changed", the keyframes are untouched - fix the input and retry.

## Shape layers and paths

- `add_shape_layer` - `shape`: `rectangle` (supports `roundness`), `ellipse`, `polygon`, `star` (`points`, `outerRadius`, `innerRadius`).
- `create_path` - a real editable bezier path. `vertices` are `[x, y]` points relative to the layer, which the tool places at the comp centre. **`inTangents` / `outTangents` are relative to their own vertex**, not absolute. Omit them for corner points. `closed: false` for an open line.
- `set_path_keyframes` - each keyframe carries its own full vertex list. Keep the vertex count the same between keys for clean morphing.
- `add_shape_operator` - `operator` is one of `trimPaths`, `repeater`, `roundCorners`, `zigZag`, `twist`, `puckerBloat`, `offsetPaths`, `wigglePaths`, `wiggleTransform`, `mergePaths`, `gradientFill`, `gradientStroke`. Set values with friendly keys, for example `{"start": 0, "end": 50}` for trim paths or `{"copies": 6}` for a repeater. To animate an operator, keyframe it through its path (see Property paths).
- **Gradient colour stops cannot be set by script.** After Effects exposes them as read-only, so gradients render with default colours. Tell the user to set the colours by hand.

## Masks

- `add_mask` - optional `vertices` / tangents in the layer's own pixel space, where `(0, 0)` is the layer's **top-left** corner. Also `mode` (`none`, `add`, `subtract`, `intersect`, `lighten`, `darken`, `difference`), `inverted`, `feather` (pixels), `opacity`, `expansion`.
- `set_mask_keyframes` animates the path; `set_mask_properties` changes settings and works through a lock.
- Identify masks by `maskName` or 1-based `maskIndex`. With neither, the first mask is used.

## 3D

1. **Check the renderer first** with `get_3d_info`. New comps use the Classic renderer. Its internal name is `ADBE Advanced 3d` - that is *not* Advanced 3D.
2. `set_comp_renderer` takes `classic`, `advanced` or `cinema4d`. Each exposes a **different** set of properties; newer is not simply better:

| Feature | classic | advanced | cinema4d |
|---|---|---|---|
| Extrusion and bevel | no | yes | yes |
| Camera blur level, iris, highlights | yes | no | no |
| Depth of field, focus distance, aperture | yes | yes | no |
| Shadow colour, focus area width | no | yes | no |
| Reflections | no | no | yes |

3. `set_3d_layer` with `enable3D: true` before setting 3D properties.
4. Extrusion (`set_geometry_options` `extrusionDepth`, `bevelDepth`, `bevelStyle`) works on **text and shape layers only**, never solids.
5. The `set_*_options` tools apply what they can and return `applied` and `failed`. Each failure lists `availableUnderRenderers`. Read it and switch renderer, or tell the user the property isn't available - don't assume the call fully succeeded.

## Templates

- `create_lower_third` - `style` (`modern`, `corporate`, `news`, `minimal`, `social`), `position` (`bottomLeft`, `bottomRight`, `bottomCenter`). **`name` is the name of the precomp it builds**; `title` is the main line and `subtitle` the second. It adds one precomp layer to the target comp.
- `create_title_card` - `style`: `cinematic`, `documentary`, `social`, `minimal`.
- `create_transition` - `type`: `wipe_left`, `wipe_right`, `wipe_up`, `wipe_down`, `dissolve`, `push`, `slide`, `zoom`; `easing`: `linear`, `easeIn`, `easeOut`, `easeInOut`.
- `create_logo_reveal` - needs an **already imported** logo (`logoItemName` or `logoItemId`). `style`: `fade`, `scale`, `slide`, `spin`, `glitch`, `particle`. `particle` assembles the logo out of particles with CC Scatterize and fires a soft CC Particle Systems II burst as it lands. For text, put the text in its own comp first and pass that comp as `logoItemName`. The burst goes on its own solid, "Logo Particles", and the result says whether it was added.
- `create_text_animator` - needs a text layer (`layerName`); `animatorType`: `typewriter`, `fadeInChars`, `scaleInChars`, `slideInChars`, `randomize`, `wave`; optional `duration`, `delay`.

## Effects and expressions

- `apply_effect` - `effect` is the effect's English name (`"Gaussian Blur"`, `"Glow"`, `"Gradient Ramp"`, `"Turbulent Displace"`) or its match name (`"ADBE Gaussian Blur 2"`). **Third-party plugins can share a display name** with a built-in effect, and the name resolves to whichever loads first. Check the `matchName` in the result, and pass the match name when it matters.
- `apply_effect_template` - `template`: `gaussianBlur`, `directionalBlur`, `glassBlur`, `curves`, `colorBalance`, `brightnessContrast`, `vibrance`, `glow`, `dropShadow`, `vignette`, `cinematicLook`, `vhsRetro`, `neonGlow`, `filmGrain`, `chromaticAberration`, `duotone`; optional `intensity`.
- `apply_expression_template` - pass settings in `params`. Unknown keys are ignored; numeric settings must be numbers.
  - Wiggle: `wiggle`, `wiggleSmooth`, `wiggleFadeIn`, `wiggleFadeOut` (`frequency`, `amplitude`); `loopingWiggle` repeats seamlessly (`frequency`, `amplitude`, `loopTime`); `wiggleOneAxis` wiggles one axis and leaves the others on their keyframes (`axis`: 0 x, 1 y, 2 z).
  - Loops and time: `loopCycle`, `loopPingpong`, `loopOffset`, `loopContinue`, `time`, `clock`, `countdown`, `frameNumber`.
  - Linking: `matchPosition`, `offsetPosition`, `inverseRotation`, `followPath`.
  - **Physics - these act after every keyframe on the property:**
    - `overshoot` wobbles past each key and settles (`frequency`, `decay`). Higher frequency means a smaller, tighter overshoot.
    - `bounce` retains the original bouncy-overshoot parameters (`amplitude`, `frequency`, `decay`).
    - `bounceBack` rebounds off each key value like a ball off a floor (`elasticity` 0-1, `gravity`, `maxBounces`). For a dropped object, keyframe only the fall and let the template add the rebounds.
    - `inertia` drifts on past each key and eases to a stop (`friction`).
    - `springy` springs past each key (`mass`, `stiffness`, `damping`; damping must stay below 2 x sqrt(mass x stiffness) or nothing happens).
    - All five take their size from how fast the property arrives at the key, so a key with no incoming motion gets no effect - including a key with easy ease on its incoming side.
  - `speedControl` accumulates a keyframed speed slider (units per second) from the layer's `inPoint`. Add the slider first with `add_expression_control(controlType="slider", controlName="Speed")`; `params`: `controlName`, `multiplier`. Exact for linear and HOLD keys, including intervals clipped by trimming. Eased keys use a midpoint approximation; use linear/HOLD keys when accurate integration matters. On array properties such as Scale it adds to every dimension.
- **Effect parameter lists are flat and reuse names.** Particle Playground has a dozen `Position`, `Affects`, `Min` and `Max` entries; CC Particle World has two `Distance`s. A display-name path such as `Effects/Particle Playground/Position` silently hits the first one. Use the parameter's match name as the last path segment instead: `Effects/CC Particle Systems II/CC Particle Systems II-0001`.
- `link_properties` - `offset` is **added** to the linked value. It shifts a layer; it cannot scale motion. For parallax or other multipliers, write the expression with `set_expression`.
- In your own expressions, use `value` for the pre-expression value and `thisComp.layer("Name")` to reference other layers.

## Particles

There is no particle API in ExtendScript. Particles come from the bundled effects, added with `apply_effect` like any other effect: `CC Particle World`, `CC Particle Systems II`, `Particle Playground`, and effects that break a layer apart - `CC Scatterize`, `CC Pixel Polly`, `Shatter`. Emitters (Particle World, Particle Systems II, Playground) replace the layer they sit on, so put them on their own solid, usually with `blendMode: ADD`.

CC Particle Systems II behaves in ways that aren't obvious (match names in brackets):
- **Radius X/Y (`-0005`/`-0006`) and Velocity (`-0010`) are relative, not pixels.** On a 1920-wide layer one radius unit is roughly 10 px, so a radius of 30 surrounds a mid-size logo and 100 fills the frame. Keep velocity well under 1 on a comp-sized solid.
- **Particle Type (`-0018`) is a numbered menu**: 1 lines (the default), 2 stars, 4 shaded spheres, **5 faded spheres (soft dots)**, 7 bubbles, 10-15 polygon shards, 17-19 large bokeh lenses. 3, 8 and 16 are menu separators and render almost nothing.
- Birth Rate (`-0001`) runs 0-1000 and is continuous. For a burst, keyframe it on and off with HOLD keyframes.

**Effects are clipped to their layer's bounds.** Scatterize or a glow on a tight precomp fills that rectangle and stops. To give an effect room:
- **Precomps, solids and vector layers:** `modify_layer` with `collapseTransformation: true` renders the layer's effects in the parent comp's space.
- **Raster footage (PNG, JPG, video)** can't collapse. Add `apply_effect(effect="ADBE GROW BOUNDS")` *before* the effect that needs room, and set its Pixels (`Effects/ADBE GROW BOUNDS/ADBE GROW BOUNDS-0001`). Use the match name: Red Giant's plugin is also called "Grow Bounds", and the display name picks whichever loads first.

`create_logo_reveal` style `particle` does this automatically and reports which method it used in `logoBoundsExpandedBy`.

Check a particle setup with `render_frame` before calling it done - these parameters are hard to judge any other way. For a full preview, **render through the render queue** rather than frame by frame: a single particle frame has to re-simulate from time 0, so 30 frames via `render_frame` took minutes, while a 4-second comp rendered through the queue in 4 seconds.

## Rendering

- Call `list_render_templates` first and use the user's existing presets by name.
- `add_to_render_queue` - `outputPath`, `renderSettingsTemplate`, `outputModuleTemplate`, `timeSpanStart`, `timeSpanDuration`. **The output module decides the file type**: a `.mov` path with an H.264 module produces `.mp4`. Report the returned `outputPath`.
- **`control_render` only supports `start` and `showWindow`.** `start` is synchronous and blocks the CEP bridge until the whole queue finishes: polling and stop/pause/resume are unavailable. **A command timeout does not cancel rendering.** Do not retry or modify the queue after a timeout until AE finishes; use AE's UI to interrupt a native render. Prefer `queue_in_ame` (`renderImmediately: true` to start encoding) for long jobs. `list_render_queue` inspects the native queue before/after rendering, not AME progress.
- `render_frame` saves a single PNG (`time`, optional `outputDir` and `fileName`) and waits until the file is fully written. Use it to check your work.

## Known issues

- **`precompose_layers` is broken.** It moves the layers into the new precomp and then errors. If you must use it, check the result with `list_layers` afterwards.
- `delete_composition` does not delete the solids that comp used. They stay in the project's Solids folder.

## Common errors

| Error | Likely cause |
|---|---|
| Timeout on every call | AE-MCP panel closed, or a modal dialog open in After Effects |
| "Property not found" | Dotted path, wrong group name (`Group 1`, not `Shape 1`), or the property doesn't exist on this layer type |
| "property or a parent property is hidden" | Renderer doesn't support it (see 3D), layer isn't 3D, or you asked for extrusion on a solid |
| "Value is undefined" | Enum written in the wrong case, such as `"Screen"` instead of `SCREEN` |
| "Unknown expression template" | Name not in the template list, such as `randomize`, which is a text animator type |
| "Nothing was changed" | A keyframe tool refused input that would have lost keys; nothing was modified |
| "Composition not found" / "Layer not found" | Check exact names with `list_compositions` / `list_layers` |
| File couldn't be saved | Use a full absolute path with forward slashes, such as `C:/Projects/job.aep` |

## Timing guidelines

- UI elements: 0.3-0.5 s. Text reveals: 0.5-1.5 s. Logo animations: 1-3 s. Title cards: 3-5 s. Transitions: 0.5-1.5 s.
- Natural motion: easy ease both ways. Entrances: ease out. Exits: ease in. Loops: linear.
- Common comp sizes: 1920x1080 landscape, 1080x1920 vertical, at 24, 30 or 60 fps.


# ae-mcp Examples

Worked recipes using the ae-mcp tools. Every call uses named parameters that match the tool schemas. Adjust names, sizes and timings to the job.

Ask before running anything that changes the whole project (see SKILL.md), and check existing names with `list_compositions` / `list_layers` before editing.

---

## 1. Bouncing ball

```
create_composition(name="Ball", width=1920, height=1080, frameRate=30, duration=5)

add_shape_layer(compName="Ball", name="Ball", shape="ellipse",
                size={"width": 100, "height": 100},
                fillColor={"r": 1, "g": 0.3, "b": 0.2},
                position={"x": 960, "y": 200})

# Drop and bounce - one call per key
set_keyframe(compName="Ball", layerName="Ball", property="position", time=0,   value=[960, 200])
set_keyframe(compName="Ball", layerName="Ball", property="position", time=1,   value=[960, 900])
set_keyframe(compName="Ball", layerName="Ball", property="position", time=1.5, value=[960, 700])
set_keyframe(compName="Ball", layerName="Ball", property="position", time=2,   value=[960, 900])

apply_easy_ease(compName="Ball", layerName="Ball", property="position", type="BOTH")

# Squash on impact
set_keyframe(compName="Ball", layerName="Ball", property="scale", time=0.9, value=[100, 100])
set_keyframe(compName="Ball", layerName="Ball", property="scale", time=1,   value=[120, 80])
set_keyframe(compName="Ball", layerName="Ball", property="scale", time=1.1, value=[100, 100])
```

Alternative - keyframe only the fall and let the `bounceBack` template add the rebounds. Each rebound keeps `elasticity` of the speed, and they get shorter as it loses energy:

```
set_keyframe(compName="Ball", layerName="Ball", property="position", time=0, value=[960, 200])
set_keyframe(compName="Ball", layerName="Ball", property="position", time=1, value=[960, 900])
apply_expression_template(compName="Ball", layerName="Ball", property="position",
                          template="bounceBack",
                          params={"elasticity": 0.7, "gravity": 1500, "maxBounces": 9})
```

This linear fall lands at 700 px/s, and gives a first rebound of about 80 px and seven rebounds in all. Rebound height is speed² / (2 × gravity): lower gravity or a faster landing gives bigger bounces. **Don't easy-ease the landing key** - the ball would arrive at zero speed and not bounce at all.

For a settle-and-wobble instead of a bounce, use `template="overshoot"` with `params={"frequency": 3, "decay": 5}`.

---

## 2. Kinetic typography

```
create_composition(name="Kinetic", width=1920, height=1080, frameRate=30, duration=8)

add_text_layer(compName="Kinetic", name="Word1", text="MOTION", fontSize=120,
               justification="CENTER", position={"x": 960, "y": 400})
add_text_layer(compName="Kinetic", name="Word2", text="DESIGN", fontSize=120,
               justification="CENTER", position={"x": 960, "y": 600})
add_text_layer(compName="Kinetic", name="Word3", text="STUDIO", fontSize=120,
               justification="CENTER", position={"x": 960, "y": 800})

# create_text_animator needs a text layer
create_text_animator(compName="Kinetic", layerName="Word1", animatorType="slideInChars", duration=1, delay=0.05)
create_text_animator(compName="Kinetic", layerName="Word2", animatorType="slideInChars", duration=1, delay=0.05)
create_text_animator(compName="Kinetic", layerName="Word3", animatorType="slideInChars", duration=1, delay=0.05)

# Stagger the words by shifting each layer in time
modify_layer(compName="Kinetic", layerName="Word2", startTime=0.5)
modify_layer(compName="Kinetic", layerName="Word3", startTime=1)
```

---

## 3. Logo reveal with an animated mask

The logo must already be in the project - ask before importing.

```
import_footage(path="C:/Assets/logo.png")                 # confirm with the user first

create_composition(name="Logo", width=1920, height=1080, frameRate=30, duration=4)
add_av_layer(compName="Logo", itemName="logo.png")

# Mask vertices are in the layer's own pixels, (0,0) = top-left.
# For a W x H logo, start with a zero-width rectangle on the left edge...
add_mask(compName="Logo", layerName="logo.png", name="Reveal",
         vertices=[[0, 0], [0, 0], [0, H], [0, H]], feather=40)

# ...and widen it to cover the whole logo.
set_mask_keyframes(compName="Logo", layerName="logo.png", maskName="Reveal",
                   keyframes=[
                     {"time": 0,   "vertices": [[0, 0], [0, 0], [0, H], [0, H]]},
                     {"time": 1.5, "vertices": [[0, 0], [W, 0], [W, H], [0, H]]}
                   ])

apply_effect_template(compName="Logo", layerName="logo.png", template="glow", intensity=50)

set_keyframe(compName="Logo", layerName="logo.png", property="rotation", time=0, value=-5)
set_keyframe(compName="Logo", layerName="logo.png", property="rotation", time=2, value=0)
apply_easy_ease(compName="Logo", layerName="logo.png", property="rotation", type="OUT")
```

For a canned animation instead, `create_logo_reveal(compName="Logo", logoItemName="logo.png", style="scale")`. `style="particle"` assembles the logo out of particles and adds a sparkle burst as it lands.

---

## 4. Line draw-on with Trim Paths

```
create_composition(name="DrawOn", width=1920, height=1080, frameRate=30, duration=3)

# An open two-point path, centred on the comp
create_path(compName="DrawOn", name="Line", pathName="Stroke Path",
            vertices=[[-400, 0], [400, 0]], closed=false,
            strokeColor={"r": 1, "g": 1, "b": 1}, strokeWidth=6)

add_shape_operator(compName="DrawOn", layerName="Line",
                   operator="trimPaths", properties={"end": 0})

# The operator lives inside the group's Contents - note the slashes
set_keyframe(compName="DrawOn", layerName="Line",
             property="Contents/Group 1/Contents/Trim Paths 1/End", time=0, value=0)
set_keyframe(compName="DrawOn", layerName="Line",
             property="Contents/Group 1/Contents/Trim Paths 1/End", time=1, value=100)
apply_easy_ease(compName="DrawOn", layerName="Line",
                property="Contents/Group 1/Contents/Trim Paths 1/End", type="BOTH")
```

For a curve, add tangents (relative to each vertex). A circle of radius 100:

```
vertices    = [[0, -100], [100, 0], [0, 100], [-100, 0]]
inTangents  = [[-55, 0], [0, -55], [55, 0], [0, 55]]
outTangents = [[55, 0], [0, 55], [-55, 0], [0, -55]]
```

---

## 5. Extruded 3D title

```
create_composition(name="Title3D", width=1920, height=1080, frameRate=30, duration=5)
add_text_layer(compName="Title3D", name="Title", text="LAUNCH", fontSize=200,
               justification="CENTER", position={"x": 960, "y": 540})

get_3d_info(compName="Title3D")                    # new comps start on the Classic renderer
set_comp_renderer(compName="Title3D", renderer="advanced")

set_3d_layer(compName="Title3D", layerName="Title", enable3D=true, orientation=[0, 20, 0])
set_geometry_options(compName="Title3D", layerName="Title",
                     extrusionDepth=60, bevelStyle=2, bevelDepth=4)
set_material_options(compName="Title3D", layerName="Title",
                     castsShadows=true, ambient=40, diffuse=70, specularIntensity=55)

add_camera_layer(compName="Title3D", name="Cam", type="TWO_NODE")
set_camera_options(compName="Title3D", layerName="Cam",
                   zoom=1200, depthOfField=true, focusDistance=1200, aperture=40)

add_light_layer(compName="Title3D", name="Key", type="SPOT")
set_light_options(compName="Title3D", layerName="Key",
                  intensity=120, color={"r": 1, "g": 0.9, "b": 0.7},
                  coneAngle=70, coneFeather=40, castsShadows=true, shadowDarkness=60)
```

Read the `failed` list in each `set_*_options` result. Under the `advanced` renderer, for example, camera `blurLevel` and the iris controls are refused, and each failure names the renderer that supports it.

---

## 6. Number counter

```
create_composition(name="Counter", width=1920, height=1080, frameRate=30, duration=5)
add_text_layer(compName="Counter", name="Count", text="0", fontSize=200,
               justification="CENTER", position={"x": 960, "y": 540})

set_expression(compName="Counter", layerName="Count", property="sourceText",
               expression="Math.round(linear(time, 0, 3, 0, 1000)).toString()")
```

For a prefix or suffix: `"$" + Math.round(linear(time, 0, 3, 0, 1000)).toString()`.

---

## 7. Parallax with a controller null

`link_properties` can only *add* an offset, so parallax uses an expression with a multiplier.

```
add_null_layer(compName="Scene", name="Camera Control")

# Each layer moves by a fraction of the controller's motion.
# 0.2 = far background, 0.5 = midground, 1.0 = foreground.
set_expression(compName="Scene", layerName="Background", property="position",
  expression='var c = thisComp.layer("Camera Control").transform.position; value + (c - c.valueAtTime(0)) * 0.2')
set_expression(compName="Scene", layerName="Midground", property="position",
  expression='var c = thisComp.layer("Camera Control").transform.position; value + (c - c.valueAtTime(0)) * 0.5')

# Animate only the controller
set_keyframe(compName="Scene", layerName="Camera Control", property="position", time=0,  value=[960, 540])
set_keyframe(compName="Scene", layerName="Camera Control", property="position", time=10, value=[560, 540])
```

---

## 8. Glitch title

There is no duplicate-layer tool, so build the three copies directly.

```
create_composition(name="Glitch", width=1920, height=1080, frameRate=30, duration=4)

add_text_layer(compName="Glitch", name="Red",   text="GLITCH", fontSize=150,
               justification="CENTER", color={"r": 1, "g": 0, "b": 0}, position={"x": 950, "y": 540})
add_text_layer(compName="Glitch", name="Green", text="GLITCH", fontSize=150,
               justification="CENTER", color={"r": 0, "g": 1, "b": 0}, position={"x": 960, "y": 540})
add_text_layer(compName="Glitch", name="Blue",  text="GLITCH", fontSize=150,
               justification="CENTER", color={"r": 0, "g": 0, "b": 1}, position={"x": 970, "y": 540})

# Blend modes are AE constants in capitals
modify_layer(compName="Glitch", layerName="Red",  blendMode="SCREEN")
modify_layer(compName="Glitch", layerName="Blue", blendMode="SCREEN")

apply_effect(compName="Glitch", layerName="Green", effect="Turbulent Displace")

# Flicker
apply_expression_template(compName="Glitch", layerName="Red", property="opacity",
                          template="wiggle", params={"frequency": 12, "amplitude": 40})
```

---

## 9. Render and deliver

```
list_render_templates()        # use the user's existing presets by name

add_to_render_queue(compName="Title3D",
                    outputPath="D:/Deliveries/Title3D.mp4",
                    renderSettingsTemplate="Best Settings",
                    outputModuleTemplate="H.264 - Match Render Settings - 15 Mbps")

list_render_queue()            # confirm status "queued" and the real outputPath

queue_in_ame(renderImmediately=true)     # returns immediately; AME does the encoding
```

Avoid `control_render(action="start")` for anything long: it synchronously blocks the CEP bridge until the queue finishes, so polling and stop/pause/resume are unavailable. A command timeout does not cancel rendering; do not retry or modify the queue until AE finishes. Use AE's UI to interrupt native rendering. `list_render_queue` does not track AME progress.

---

## 10. Particle text reveal

Text assembling out of particles, then a sparkle burst as it lands. The reveal treats a comp as its "logo", so the text goes in its own tight comp first.

```
# 1. The text, in a comp just big enough to hold it
create_composition(name="Particle Text - Source", width=1500, height=340, frameRate=30, duration=4)
add_text_layer(compName="Particle Text - Source", name="Title", text="MOTION", fontSize=240,
               justification="CENTER", color={"r": 1, "g": 1, "b": 1},
               position={"x": 750, "y": 255})

# 2. The main comp and the reveal
create_composition(name="Particle Text Reveal", width=1920, height=1080, frameRate=30, duration=4)
create_logo_reveal(compName="Particle Text Reveal", logoItemName="Particle Text - Source",
                   style="particle", duration=4,
                   backgroundColor={"r": 0.03, "g": 0.035, "b": 0.07})
# -> logoBoundsExpandedBy: "collapseTransformation", particleBurstAdded: true

# 3. A slow push-in so the end frame doesn't sit dead
set_keyframe(compName="Particle Text Reveal", layerName="Particle Text - Source",
             property="scale", time=0, value=[92, 92])
set_keyframe(compName="Particle Text Reveal", layerName="Particle Text - Source",
             property="scale", time=4, value=[100, 100])

set_active_composition(compName="Particle Text Reveal")

# 4. Preview - through the render queue, not frame by frame
add_to_render_queue(compName="Particle Text Reveal",
                    outputPath="D:/Previews/particle_text_reveal.mp4",
                    renderSettingsTemplate="Best Settings",
                    outputModuleTemplate="H.264 - Match Render Settings - 15 Mbps")
queue_in_ame(renderImmediately=true)  # render duration is not predictable; prefer AME
# Monitor completion in AME; list_render_queue is not an AME progress monitor.
```

Timeline: the text fades in as a particle cloud, forms letters by about 1.7 s, lands at 2 s (half the duration) with the burst, and holds from there. The source comp layer gets Collapse Transformations automatically, so the scatter isn't clipped to the 1500x340 box.

---

## 11. Speed ramp without the rewind

Spinning something from a keyframed speed. Multiplying the slider by `time` makes it spin backwards as soon as the speed eases off; `speedControl` accumulates the speed instead.

```
add_null_layer(compName="Scene", name="Wheel")
add_expression_control(compName="Scene", layerName="Wheel",
                       controlType="slider", controlName="Speed")

# Speed in degrees per second: spin up, hold, spin down
set_keyframe(compName="Scene", layerName="Wheel", property="Effects/Speed/Slider", time=0, value=0)
set_keyframe(compName="Scene", layerName="Wheel", property="Effects/Speed/Slider", time=1, value=360)
set_keyframe(compName="Scene", layerName="Wheel", property="Effects/Speed/Slider", time=2, value=360)
set_keyframe(compName="Scene", layerName="Wheel", property="Effects/Speed/Slider", time=3, value=0)

apply_expression_template(compName="Scene", layerName="Wheel", property="rotation",
                          template="speedControl", params={"controlName": "Speed"})
```

Rotation runs 0 → 180° at 1 s → 540° at 2 s → 720° at 3 s, then holds at 720°.

---

## Timing and easing

| Use | Duration | Easing |
|---|---|---|
| UI elements, buttons | 0.3 s | Easy ease both ways |
| Text and image reveals | 0.8-1.2 s | Ease out |
| Logos, call-to-action | 0.4-0.6 s | `overshoot` or `bounce` expression |
| Ambient loops | 2-4 s | Linear, or `loopCycle` |


