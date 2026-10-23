// Common After Effects failure messages → what to do about them. ae_do adds
// the first matching hint to an error that does not already carry one, so the
// model fixes the call instead of retrying it unchanged.

interface ErrorHint {
  pattern: RegExp;
  hint: string;
}

const HINTS: ErrorHint[] = [
  {
    // Camera/light/extrusion properties exist only under some 3D renderers.
    pattern:
      /property[^.]*hidden|hidden property|cannot be (set|modified) .*(3d|renderer)|bevel|extrusion|iris|reflection|focus area/i,
    hint: "This property is gated by the comp's 3D renderer. Classic 3D ('ADBE Advanced 3d') has camera blur level and iris; Advanced 3D ('ADBE Calder') has focus area width, shadow colour, extrusion and bevel; Cinema 4D ('ADBE Ernst') has reflections, extrusion and bevel. Check comp.renderer and switch it (comp.set { renderer }) only if the user agrees — see ae_guide 'Kỹ thuật/3D'.",
  },
  {
    pattern: /null is not an object|undefined is not an object|property\("ADBE Position"\)/i,
    hint: "A property lookup returned null. Go through the group: layer.property('ADBE Transform Group').property('ADBE Position') — on some AE 2026 builds the short path returns null.",
  },
  {
    pattern: /dimensions? (are )?separated|separated dimensions/i,
    hint: "Position has separated dimensions: write X/Y through AE.writeValue / AE.applyKeySpecs (they handle the followers) or address 'ADBE Position_0' / 'ADBE Position_1'.",
  },
  {
    pattern: /expression.*(error|disabled)|ReferenceError|SyntaxError/i,
    hint: "Run expression.validate on the comp to see every failing expression with its property path; layer/effect names in expressions must match exactly (they are case- and accent-sensitive).",
  },
  {
    pattern: /font|glyph/i,
    hint: "Fonts are set by PostScript name (font.list / font.check_glyphs). Run text.qa after changing fonts — many display fonts lack Vietnamese glyphs.",
  },
  {
    pattern: /modal dialog|DIALOG_OPEN/i,
    hint: "After Effects is showing a dialog: instance.dialogs lists it, instance.dismiss_dialog closes it with its cancel action. Tell the user what it said.",
  },
  {
    pattern: /\[redacted\]|redacted/i,
    hint: "The script contains a '[redacted]' placeholder — it was cut from a compressed chat history. Rewrite the code in full instead of reusing that copy.",
  },
];

export function hintForError(message: string): string | undefined {
  for (const h of HINTS) if (h.pattern.test(message)) return h.hint;
  return undefined;
}
