# Animation Composer (Mister Horse) — Use when a look comes from Animation Composer: it is applied through its panel, the MCP handles the rest.

Updated 2026-10-23. Animation Composer 4's preset library lives in the cloud and is applied through the plug-in's encrypted effect; there is no stable script command the MCP can call. How to combine them:
- The owner applies presets from the panel (Window → Extensions → Animation Composer); the MCP reads the result (`ae_layer_info`), retimes it with `anim.adjust`, and adds the MCP's loops, light sweeps and transitions.
- Equivalent looks built into the MCP: entrances/exits `anim.apply` (push, whip, flip, swing, zoom_blur, pop, stretch…), text `text.animate`, transitions `anim.scene_transition`, `template.transition`, logos `template.logo_reveal`.
- `.ffx` presets (1242 files, `Preset After Effects (.ffx).md`) can be applied with `layer.apply_preset`.
