# ExtendScript cookbook — Use when writing AE ExtendScript for text, mask, effect, footage, or export work. Gives ExtendScript traps and matchName-safe recipes. Needs the target property and ae_read when names or types are uncertain.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

AE EXTENDSCRIPT COOKBOOK — situational recipes & traps
Hard-won fixes for problems that look like one bug but are another. Run JSX via ae_exec; verify visually via ae_previewFrame. Re-acquire property refs with AEMCP.propByMatchPath after any addProperty.

=== saveFrameToPng goes near-black in 32-bit projects ===
Symptom: in a 32-bit float project, saveFrameToPng writes a PNG that is almost pure black — even a pure white solid (R=1.0) comes out R~0.01. ae_previewFrame looks perfectly fine, so you think it is a grade/vignette problem. It is not.
Cause: saveFrameToPng falls back to an 8bpc capture path that mangles 32-bit float data.
Fix — force 8-bit BEFORE the single-frame PNG:
  if (app.project.bitsPerChannel === 32) { app.project.bitsPerChannel = 8; }
  // now saveFrameToPng(time, file) is correct
For a single PPT/export frame, switching the project to 8-bit is the stable path. To keep a 32-bit working depth, render the single frame through the RenderQueue instead.
General rule: preview fine but saved PNG near-black => first prove it with a white-solid test case (is it project-depth / export pipeline?), do NOT blindly tweak vignette or grade.

=== File.exists() is unreliable right after saveFrameToPng ===
The file IS written to disk, but immediately after saveFrameToPng a fresh File handle often reports f.exists === false and f.length === -1.
Do NOT treat that as a save failure. Verify by reading the PNG on the host (or re-stat it on the next ae_exec run); do not branch on f.exists right after the write.

=== mask vertices are in SOURCE pixel space, not canvas ===
Symptom: after a layer is scaled/moved on the canvas, you set mask vertices using canvas coordinates and the mask lands in the wrong place or vanishes.
Mechanism: AE mask Shape vertices live in the layer's SOURCE pixel space. Position/Scale/Anchor Point do NOT change the vertex numbers — they just move where the (source-space) mask appears on the canvas.
Convert canvas coords -> source coords before building the Shape (default anchor = source center):
  function canvasToSource(canvas_xy, layer) {
    var tg = layer.property("ADBE Transform Group");
    var pos = tg.property("ADBE Position").value;
    var anchor = tg.property("ADBE Anchor Point").value;
    var scl = tg.property("ADBE Scale").value;
    return [
      anchor[0] + (canvas_xy[0] - pos[0]) * 100 / scl[0],
      anchor[1] + (canvas_xy[1] - pos[1]) * 100 / scl[1]
    ];
  }
Example: source 3330x900, anchor (1665,450), position (3330,900), scale 200%. To mask canvas X=[1450,5210]: source_x = 1665 + (1450-3330)*100/200 = 725 and 1665 + (5210-3330)*100/200 = 2605 => vertices [[725,0],[2605,0],[2605,900],[725,900]].

=== vignette = solid + feathered SUBTRACT mask (there is no ADBE Vignette) ===
The matchName "ADBE Vignette" does not exist. Build a vignette by hand: a black solid the size of the comp, plus a SUBTRACT mask with heavy feather.
  var vig = comp.layers.addSolid([0,0,0], "FX_VIGNETTE", W, H, 1.0);
  var mask = vig.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
  mask.maskMode = MaskMode.SUBTRACT;
  var s = new Shape(); s.closed = true;
  var k = 0.5522847498; var rx = W*0.55, ry = H*0.85;
  s.vertices    = [[W/2-rx,H/2],[W/2,H/2-ry],[W/2+rx,H/2],[W/2,H/2+ry]];
  s.inTangents  = [[0,-ry*k],[-rx*k,0],[0,ry*k],[rx*k,0]];
  s.outTangents = [[0,ry*k],[rx*k,0],[0,-ry*k],[-rx*k,0]];
  mask.property("ADBE Mask Shape").setValue(s);
  mask.property("ADBE Mask Feather").setValue([W*0.18, H*0.20]);
  vig.property("ADBE Transform Group").property("ADBE Opacity").setValue(85);
A rectangular crop mask is the same but with all inTangents/outTangents = [0,0].
Export gotcha: a strong vignette (opacity > ~50%) crushes the dark areas — on saveFrameToPng that can read as solid black even though preview looked fine. Start at 20-30% and verify the exported PNG.

=== footage source-replace cache trap ===
Symptom: Blender (or any external tool) re-renders the PNG/sequence — file timestamp and content are both new — but after source.replace(newFile) the saved frame still shows the OLD pixels. The viewport shows old too.
Cause: replace() only re-points the displayed item; it does not re-read pixels, and stale caches persist.
Fix — re-import fresh, then replaceSource, then purge:
  var io = new ImportOptions(newFile); io.importAs = ImportAsType.FOOTAGE;
  var fresh = app.project.importFile(io);
  fresh.name = "fresh_" + new Date().getTime();
  layer.replaceSource(fresh, false);
  app.purge(PurgeTarget.ALL_CACHES);
  app.purge(PurgeTarget.IMAGE_CACHES);
Verify trap: if it still looks old, do NOT immediately blame cache — another layer may be OCCLUDING this one. Temporarily disable every non-BG layer, confirm the hero shows the new source, then re-enable.

=== alpha PNG -> just add ADBE Fill black (no keying) ===
When the silhouette source is a PNG that already has an alpha channel (rendered output or pre-keyed footage), do NOT reach for Linear Color Key / Luma Key / Difference Matte. Any keying on an already-transparent PNG leaves gray anti-alias fringe or chews up the figure edge.
Correct: import (alpha auto-detected), then add a single ADBE Fill effect and set its color to black; alpha is preserved => clean silhouette.
  var fillFx = layer.property("ADBE Effect Parade").addProperty("ADBE Fill");
  AEMCP.propByMatchPath(layer, "ADBE Effect Parade#1/ADBE Fill#1/ADBE Fill-0002#1").setValue([0,0,0]);
  // ADBE Fill sub-props: -0001 fillMask, -0002 color, -0003/04 feather, -0005 opacity, -0006 invert, -0007 all masks
Verify (a black silhouette is invisible on black): temporarily set the BG solid to red [0.85,0.1,0.15], confirm the full figure appears, then set BG back. Keying is only for HARD backgrounds (pure white/green/black, no alpha).

=== default effect params are landmines (Add Noise / Fractal Noise) ===
Some effects ship with extreme defaults that blow out the frame the instant you add them:
  - ADBE Noise2 (Add Noise) defaults to 100% — with an Overlay blend it turns the whole frame to white noise. Drop Amount to ~5-10 (or lower layer opacity) before you look.
  - ADBE Fractal Noise defaults to high contrast — with a Screen blend it floods the frame with white. Set contrast ~30-50 and brightness ~-30.
Add the effect, THEN tame the params, THEN preview.

=== effect sub-property by name returns null -> use index ===
Many effect sub-properties return null when addressed by display name (and even the guessed matchName can be wrong on a given build). Index access is reliable:
  var tritone = layer.property("ADBE Effect Parade").addProperty("ADBE Tritone");
  tritone.property(1).setValue([0,0,0]);        // Black point
  tritone.property(2).setValue([0.6,0.04,0.04]); // Mid point
  tritone.property(3).setValue([0.95,0.15,0.15]); // White point
Strategy: add with defaults, set via property(1/2/3...); if that fails, set it once in the GUI and read the real matchName with ae_exec (scan the property tree).

=== text renders wrong -> suspect layer-order occlusion FIRST, not the font ===
Symptom: a big text layer shows missing glyphs or partial characters (e.g. a radical of a CJK character is gone). Do NOT immediately blame the font, string encoding, or a giant-fontSize bug.
Most common cause: another layer (silhouette / image / panel) sitting ABOVE the text is occluding part of it.
Diagnosis order:
  1. Check layer order — is anything opaque above the text? That is suspect #1.
  2. Temporarily move the text Position to an empty area and preview.
  3. If it renders correctly when moved => 100% an occlusion problem, nothing to do with the font.
  4. Only if it STILL renders wrong after moving do you investigate font / encoding / size.
fontSize hard-caps at 1296 (values >1296 raise "out of range 0.1 ... 1296"). Enumerating CJK fonts via app.fonts.allFonts is unreliable (fontFamily comes back empty) — instead reuse a PostScript name already in the comp: read comp.layer(i).property("ADBE Text Properties").property("ADBE Text Document").value.font.

=== mkv is not supported ===
Importing .mkv fails ("cannot open source file"). Use mp4 or mov. Supported: mp4 / mov / png / jpg / exr / psd. (ExtendScript File handles Unicode/CJK/emoji paths fine; on Windows escape backslashes as \\.)

=== Error object where a number/array/property was expected ===
Symptom: AE reports a type error at setValue or setValueAtTime.
Cause: A failed lookup or addProperty returned null/Error, and its result was passed as a value or property.
Fix: Guard `if (!prop || prop.propertyValueType === PropertyValueType.NO_VALUE) throw new Error("property lookup failed");`. After addProperty, reacquire with AEMCP.propByMatchPath; in try/catch, record e.line and never reuse e as a value.
Verify: Read the property and its value after creation; keep the thrown error separate from data.

=== Text animator skeleton: use match names ===
Symptom: A text animator is created but its properties or selector are missing or addressed by localized names.
Cause: Localized names and references captured before addProperty are unstable across AE builds.
Fix: Start with `layer.property("ADBE Text Properties").property("ADBE Text Animators").addProperty("ADBE Text Animator")`, then add `animator.property("ADBE Text Animator Properties").addProperty("ADBE Text Position 3D" / "ADBE Text Opacity" / "ADBE Text Scale 3D" / "ADBE Text Blur")`.
Fix: Add `animator.property("ADBE Text Selectors").addProperty("ADBE Text Selector")`; for a range selector use `ADBE Text Percent Start`, `ADBE Text Percent End`, `ADBE Text Percent Offset`, and `ADBE Text Range Advanced` -> `ADBE Text Range Type2` for character/word/line ranges.
Verify: Add each group, immediately reacquire its reference before setting values, then read the property tree; verify the range enum with ae_read first.

=== Project bit depth and previews ===
Symptom: A 16 or 32 bpc project produces large frame files or slow previews.
Cause: `app.project.bitsPerChannel` is 16 or 32, so frame data is larger than an 8 bpc capture.
Fix: `ae_previewFrame` automatically converts to 8-bit and shrinks frames to its transfer budget; `path` always points to the full-resolution file.
Verify: Read `path` for pixel-level inspection; use the returned thumbnail/grid for visual checks. The 32 bpc `saveFrameToPng` near-black trap above is separate and must be cross-checked before changing the grade.

=== Measured on After Effects 26.5 (24/10/2026): rules the offline mock enforces ===
Every row below was reproduced in a live AE 26.5; tests/helpers/ae-mock.ts emulates each one, and the full matchName table is `Kỹ thuật/MatchName đã kiểm chứng`.
- An unknown matchName on `addProperty` can CRASH After Effects (the app quits, no error). On shape Contents, `canAddProperty` answers true for ANY name starting "ADBE Vector Filter - ", "ADBE Vector Shape - " or "ADBE Vector Graphic - ", real or not ("ADBE Vector Filter - Wiggle Transform" crashed AE three times; the real Wiggle Transform is "ADBE Vector Filter - Wiggler"). Use `AE.safeAddProperty(group, matchName)`: shape items are checked against `AE.SHAPE_ITEMS`, everything else against `canAddProperty`. Effects and text animators answer `canAddProperty` honestly.
- Apply Color LUT (`ADBE Apply Color LUT2`) opens a "Choose LUT File..." picker when a script adds it; no script runs until it is answered. `effect.add` refuses it. The picker is drawn by the system's Open and Save Panel Service, so only AE's accessibility window list shows it (`instance.dialogs` reports it, `instance.dismiss_dialog` presses its Cancel).
- A script that times out is NOT dropped by AE: it stays queued and runs later, after the dialog that blocked it closes. Never resend a call that timed out with "the request WAS picked up"; find out what is blocking (`instance.dialogs`) first.
- `addProperty` kills handles to the group's OTHER children and everything below them ("Object is invalid"); `moveTo` kills the moved handle too. Transform handles survive an effect add; the 3D switch kills nothing. Re-fetch by name or index after either.
- Hold-only properties (Checkbox, Dropdown, Layer control, Source Text, Marker): `isInterpolationTypeValid` is false for BEZIER and LINEAR; `setInterpolationTypeAtKey(BEZIER)` throws "Invalid interpolation type"; `setTemporalEaseAtKey` throws "BEZIER interpolation required".
- `setTemporalEaseAtKey` wants 1 ease for spatial, 1-D, colour and shape values, otherwise value.length: Scale takes 3 even on a 2D layer (2 throws).
- `new KeyframeEase(speed, 0)` throws: influence must be 0.1–100.
- `setValue` on a property with keys throws; a separated Position leader and the Z follower of a 2D layer are hidden and throw on write.
- Two keys 0.01 s apart (inside one frame) are accepted silently — snap key times to frames yourself.
- ES3: a bare reserved word as an object key (`{ char: 1 }`) or variable name is "Illegal use of reserved word"; a quoted key (`{"class": 1}`) and dot access (`o.default`) run. Trailing commas are lint errors.
- AE's own alerts (disk cache warning, "Script execution time") leave the button title empty and put "OK"/"Cancel" in its accessibility description.

=== Reading ExtendScript errors ===
Symptom: A localized error appears to point at a surprising line.
Cause: The host wraps the submitted script before sending it to ExtendScript.
Fix: `ExtendScript error: …` is already readable localized text. `errorLine` identifies the wrapped script line, while `errorSource` contains the nearby source fragment; locate the statement in errorSource.
Verify: Do not edit the user's script by applying errorLine directly; compare the wrapper context and the original script before changing it.

=== Replay candidates instead of resending scripts ===
Symptom: Context compression or a rejected placeholder leaves the original successful script out of the current prompt.
Cause: The script body is no longer available as reliable prompt context, but the successful candidate remains addressable by id.
Fix: A successful `ae_exec` returns an `artifactId`; replay the same script with `ae_toolUse {"name":"<artifactId>"}`. Use `ae_toolSave` to retain a useful candidate.
Verify: If a placeholder is rejected, follow the response and replay the named candidate; do not resend a long or redacted script.

