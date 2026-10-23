# Script execution rules — Use when choosing an AE execution route or checking writes, Undo, uncertain results, and visual output. Gives route-specific AE/AEGP verification steps. Needs the target operation and current AE state.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

# AE Execution Guide

## Direct client workflow

Operate the project directly through MCP. Keep the AE panel open because it hosts the service; its internal chat agent is not an intermediary for an external execution session.

1. Use `ae_instances` with `action: "list"` to identify the intended AE and project.
2. Use `ae_workspace` with `action: "bind"` for that instance/project and the access authorized by the task. Carry the returned `context_id` on subsequent calls, including `ae_skillUse`. Different projects need separate bindings; another chat does not supply your project context.
3. Read the relevant state with `ae_read`, make the requested change through `ae_exec` or a matching saved tool, then read back, preview visual changes, and verify Undo when required.

If tools are missing, diagnose client discovery/configuration. If the instance is unavailable, check its actual state; timeout or missing registration does not prove AE exited. If a call is refused as read-only, obtain an authorized write binding. Do not copy ordinary project tasks into panel chat or switch to Computer Use to bypass these errors.

If the user explicitly asks to message the panel agent, explain that the public MCP surface has no chat-message tool. That request is separate from modifying an AE project.

For a saved project whose AE process has exited, offer to reopen it through `ae_instances` with `action: "start"`, `project_path`, and `work_dir`, then bind the new instance. If the user has already requested reopening, execute that workflow. For diagnosis-only requests, offer it without launching. Do not require manual reopening when the connector can do it. A live AE with a closed panel still owns its project; do not start a competing owner.

## Route choice

Use `ae_exec` when maintained AE scripting can do the job; do not seek convenience verbs. Use `ae_nativeExec` only for listed AEGP-only primitives.

## Failure recovery

A dispatched `ae_exec` failure returns a six-character `recoveryId` and an absolute, editable `scriptPath`. Edit that file with normal editing tools, or pass corrected inline `code`, then call `ae_execRecover({recoveryId})`. The default `retryMode: "restore"` restores the checkpoint captured before the failed script; a restore point exists only when `checkpoint_label` successfully created one. Use `retryMode: "continue"` only when the failed state should be preserved. Read `errorLine` together with `errorSource` to locate the failing statement. `touched` is a bounded before/after snapshot diff: `layer_diff` reports added, removed, or changed layers, `item_diff` reports project-item changes without layer changes, and `none` means no captured difference. Inspect `touched.layersChanged[].changes` for fields such as `transform.opacity`, plus `layersAdded`, `layersRemoved`, `itemsAdded`, and `itemsRemoved`. Recovery files live under `~/.ae-mcp/checkpoints/<project>/recovery/`, never beside the After Effects project.

## Program composition

`operations` is bounded. Use `saveAs`/`{"ref":"name"}` for local handles and `returnAs` for JSON values. Reads omit `operationKey`/`undoGroup`; writes require both. Never invent locators: run `project.items.list`, copy its returned locator verbatim, then walk `composition.resolve` → `composition.layers.list` → `layer.resolve` → `layer.properties.list` (groups need `parentProperty`) → `property.resolve` with `locator` and refs. Lists need `offset`/`limit`; keyframe reads use only the `property` ref, while keyframe mutations use both `layer` and `property` refs; times are `{"value","scale"}` rationals. Per-op contracts: below.

Exact rational-time read (`AeNativeExecArgs`):
<!-- AE_NATIVE_EXEC_EXAMPLE -->
```json
{
  "operations": [
    {
      "op": "composition.resolve",
      "args": {
        "locator": {
          "kind": "composition",
          "hostInstanceId": "22222222-2222-4222-8222-222222222222",
          "sessionId": "11111111-1111-4111-8111-111111111111",
          "projectId": "33333333-3333-4333-8333-333333333333",
          "generation": 1,
          "objectId": "44444444-4444-4444-8444-444444444444"
        }
      },
      "saveAs": "composition"
    },
    {
      "op": "composition.time.read",
      "args": {
        "composition": {
          "ref": "composition"
        }
      },
      "returnAs": "time"
    }
  ]
}
```

Exact rational-time write (`AeNativeExecArgs`):
<!-- AE_NATIVE_EXEC_EXAMPLE -->
```json
{
  "operationKey": "native-time-write-0001",
  "undoGroup": "Set exact composition time",
  "operations": [
    {
      "op": "composition.resolve",
      "args": {
        "locator": {
          "kind": "composition",
          "hostInstanceId": "22222222-2222-4222-8222-222222222222",
          "sessionId": "11111111-1111-4111-8111-111111111111",
          "projectId": "33333333-3333-4333-8333-333333333333",
          "generation": 1,
          "objectId": "44444444-4444-4444-8444-444444444444"
        }
      },
      "saveAs": "composition"
    },
    {
      "op": "composition.time.set",
      "args": {
        "composition": {
          "ref": "composition"
        },
        "targetTime": {
          "value": 5,
          "scale": 24
        }
      },
      "returnAs": "time"
    }
  ]
}
```

## Tool Library workflow

For a repeated operation, call `ae_toolSearch` first, then replay a matching artifact by id with `ae_toolUse` instead of rewriting the script. Saved tools are discoverable; candidates can be inspected and replayed directly by id. When a useful script or candidate is worth retaining, call `ae_toolSave` to create or promote it. Use `ae_skillUse` to list, render, or execute skills, including prompt skills saved with `ae_toolSave`. Never auto-save.

## Readback

Read state before and after each write. Re-resolve locators after graph-changing writes or Undo. Treat terminal, returned state, postcondition, and audit evidence as one result.

## Undo

One native write program opens one real AE Undo group; programs are not atomic and never roll back silently. `undo.available=true` means available, not executed or verified. After an explicit Undo, read state again. JSX writes: supply `undo_group_name`.

## Uncertain native write

A timeout or disconnect after dispatch may have changed AE. Freeze the request and run a fresh read-only `ae_nativeExec` reconciliation program. Only after conclusive no-effect reconciliation may you submit a canonical-identical replay with the same `operationKey`, `undoGroup`, operations, and program digest. Otherwise stop. Never invent an outcome.

## Visual verification

State readback proves data, not appearance. Use `ae_previewFrame` after visual changes; use `range` with `layout:"grid"` to inspect motion across an interval. After a write, use `compare` to prove that pixels changed only in the intended region. After writing expressions, run `ae_validateExpressions` before preview.

## ExtendScript essentials

AE uses ECMAScript 3: `var`, `function`, traditional loops. End reads with `JSON.stringify(...)`; guard fallible lookups for structured errors. Prefer `matchName` paths; use effect-property indices when localized names fail; reacquire references after `addProperty`.

Disable and read back a layer (`AeExecArgs`):
<!-- AE_EXEC_EXAMPLE -->
```json
{
  "code": "var comp = AEMCP.activeComp();\nvar layer = comp ? comp.layer(1) : null;\nvar result;\nif (!layer) { result = {ok:false,error:\"layer not found\"}; }\nelse { layer.enabled = false; result = {ok:true,enabled:layer.enabled}; }\nJSON.stringify(result);",
  "undo_group_name": "Disable layer"
}
```

## Native primitive reference

Format: op — mutability; refs (`?` = optional); literals (bounds); suite; result; exportability.

<!-- GENERATED NATIVE REFERENCE -->
- `composition.resolve` — read; literals `locator`; suite `AEGP_CompSuite11`; result CompositionHandle; request-local only.
- `layer.resolve` — read; refs `composition:CompositionHandle`; literals `locator`; suite `AEGP_LayerSuite9`; result LayerHandle; request-local only.
- `property.resolve` — read; refs `layer:LayerHandle`; literals `locator`; suite `AEGP_StreamSuite5`; result PropertyHandle; request-local only.
- `project.items.list` — read; literals `offset(>=0), limit(1..50), projectLocator?`; suite `AEGP_ProjSuite6`; result Json; exportable.
- `composition.layers.list` — read; refs `composition:CompositionHandle`; literals `offset(>=0), limit(1..25)`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.selectedLayers.list` — read; refs `composition:CompositionHandle`; literals `offset(>=0), limit(1..25)`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.time.read` — read; refs `composition:CompositionHandle`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.time.set` — write; refs `composition:CompositionHandle`; literals `targetTime`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.settings.read` — read; refs `composition:CompositionHandle`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.duration.set` — write; refs `composition:CompositionHandle`; literals `duration`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.frameRate.set` — write; refs `composition:CompositionHandle`; literals `frameRate`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.pixelAspectRatio.set` — write; refs `composition:CompositionHandle`; literals `pixelAspectRatio`; suite `AEGP_CompSuite11`; result Json; exportable.
- `composition.displayStartTime.set` — write; refs `composition:CompositionHandle`; literals `displayStartTime`; suite `AEGP_CompSuite11`; result Json; exportable.
- `layer.properties.list` — read; refs `layer:LayerHandle, parentProperty?:PropertyHandle`; literals `offset(>=0), limit(1..25)`; suite `AEGP_LayerSuite9`; result Json; exportable.
- `property.keyframes.list` — read; refs `property:PropertyHandle`; literals `offset(>=0), limit(1..25)`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.value.set` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `value`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.details.read` — read; refs `property:PropertyHandle`; literals `time`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.add` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `time, value`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.value.set` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `time, value`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.interpolation.set` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `time, inInterpolation, outInterpolation`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.temporalEase.set` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `time, dimensions`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.behavior.set` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `time, behavior, enabled`; suite `AEGP_StreamSuite5`; result Json; exportable.
- `property.keyframe.delete` — write; refs `layer:LayerHandle, property:PropertyHandle`; literals `time`; suite `AEGP_StreamSuite5`; result Json; exportable.

