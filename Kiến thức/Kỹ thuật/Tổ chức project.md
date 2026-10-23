# Project organisation — Use when tidying AE project organization or preparing a clean deliverable AEP. Gives Project-panel layout, board-dependency prune, and move-not-delete steps. Needs confirmed master comps, dependencies, and a checkpoint.

> Written for a generic After Effects MCP: read `ae_exec` as `ae_do` with the matching operation (or `eval.run` when enabled), `ae_validateExpressions` as `expression.validate`, `ae_previewFrame` as `ae_render_frame`; `AEMCP.*` helpers do not exist here — use the `AE.*` helpers listed by `ae_context`.

AE PROJECT ORGANIZATION — panel structure, board-protection cleanup, disk archive
Use ae_overview / ae_searchProject to map the current state before touching anything. Run ae_checkpoint before any destructive step.

=== Project-Panel Folder Layout ===
00_Comps/
  Precomps/   <- precomps depended on by master comps; never mixed with masters
  Tmp/        <- exploratory, rejected, test, and versioned-draft comps
01_Assets/
  Frames/
  Solids/
02_Source/
  Blender_Renders/
  Dance_Footage/
  External_Footage/

Placement rules:
- Master / final board comps -> 00_Comps (root, not Precomps).
- Any comp nested inside a master -> 00_Comps/Precomps.
- Try variants, v01/v02 drafts, test comps -> 00_Comps/Tmp. Never leave TRY/test/old-version comps in the root.
- AE solids / generated solids -> 01_Assets/Solids.
- Reusable design assets, frames, graphic elements -> 01_Assets (or 01_Assets/Frames).
- Blender renders, /renders/ or /Bld.part/ paths -> 02_Source/Blender_Renders.
- Dance PNG sequences or /Source/ footage -> 02_Source/Dance_Footage.
- External stock, smoke/noise loops, stock video -> 02_Source/External_Footage.

=== Board-Protection Cleanup Workflow ===
STEP 1 — Confirm scope
  Ask the user for the exact master comp name(s) that constitute the final board.
  Do NOT assume the currently active comp is the only master.
  Use ae_searchProject or ae_overview to list all comps and identify candidates.

STEP 2 — Save-As a clean copy first
  ae_checkpoint, then Save As a *_CLEAN_BOARD_ONLY.aep (or similar).
  All subsequent destructive steps happen inside the copy; the original AEP is untouched.

STEP 3 — Recursively collect the dependency graph
  From each master comp, walk enabled layers only:
    - nested precomp layers -> recurse into that comp
    - footage layers -> mark that FootageItem as needed
  Build the full set: {needed_comps, needed_footage}.
  Use ae_exec to run this traversal as ExtendScript if the project is large.

STEP 4 — Move non-board comps to Tmp (do not delete yet)
  Any CompItem not in needed_comps and not a master -> move to 00_Comps/Tmp.
  This is reversible. Confirm with ae_previewFrame on each master after the move.

STEP 5 — Prune unused footage sources
  Any FootageItem not in needed_footage -> move to a holding folder or flag for review.
  Same rule: only items provably outside the dependency graph.

STEP 6 — Handle disabled layers
  In a delivery cleanup it is safe to remove disabled (shy / video-switch-off) layers,
  but after removing them you MUST re-run the dependency traversal (Step 3) and prune again,
  because a newly enabled layer might have depended on something you kept only for a disabled comp.

STEP 7 — Preview and verify
  ae_previewFrame on every master comp. Confirm no missing-footage warnings.
  If anything looks wrong, revert to the pre-step ae_checkpoint before proceeding.

STEP 8 — Report
  Output: remaining comp count, footage count, disabled-layer count removed, file saved path.

=== Classification Shorthand ===
- path contains /Assets/              -> 01_Assets
- AE Solid (generated)               -> 01_Assets/Solids
- path contains /renders/ or /Bld.part/ -> 02_Source/Blender_Renders
- dance PNG seq or /Source/ footage  -> 02_Source/Dance_Footage
- stock/external (smoke, noise, etc.) -> 02_Source/External_Footage

=== Safety Rule ===
Only cut items that are provably outside the dependency graph of all master comps.
Never guess by name or date. Save and preview before AND after every pruning pass.
When in doubt, move to Tmp — do not delete.

=== Disk / On-Disk Archive Structure ===
<project_root>/
  00_Project/
    AE/
    Blender/
  01_Assets/
  02_Source/
  03_Output/
  04_Tmp/
  99_Archive/
    YYYYMMDD/
      AE/
      Blender/
      AutoSave/
      Tmp/

Archive rules:
- Current board/clean AEP stays in the workspace. Old full AEPs, autosaves,
  and agent checkpoints go to 99_Archive/YYYYMMDD/AE|AutoSave.
- Current Blender main file: keep only the latest continuable .blend.
  .blend1 auto-backups and old-version .blend files go to 99_Archive/YYYYMMDD/Blender.
- Nested old archives can be collapsed into 99_Archive/YYYYMMDD/... to keep the top level clean.
- DEFAULT: move, do not delete. Only 0-byte temp files may be deleted, and only with explicit user approval.
- Before any move, verify both source and target paths are inside the project root. Never cross project boundaries.

