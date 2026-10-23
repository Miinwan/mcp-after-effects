# Project clean-up — Use when a job has been delivered: remove unused footage from the project and move surplus files to the Trash, after the owner confirms.

Updated 2026-10-23 at the owner's request. Goal: after delivery the project keeps only the footage in use (in case the client asks for changes), and surplus files on disk go to the Trash to free space. Original files are already backed up to cloud storage. Do not use Collect Files / Reduce Project (they make copies and are error-prone).

## Two steps

1. `ae_do project.review_unused { keepComps? }`: read-only, changes nothing.
   - `keepComps`: the delivered comps (name, id or array). Empty: every comp not nested in another comp (root comps).
   - Writes the report `~/Library/Application Support/MCP Adobe/Don dep/<project> <yyyy-mm-dd HHMMSS>.json` and returns a summary: item count, space freed, 20 largest files, warnings.
   - **Show the owner the summary first**; only go to step 2 after they agree.
2. `ae_do project.clean_unused { report, confirm: true, removeFromProject?, trashFiles? }`.
   - Without `confirm: true` it does nothing and repeats the report.
   - Saves a checkpoint `<project> <date time> trước dọn.aep` next to the project.
   - Re-checks usage at run time: items/files now in use or gone are skipped, with the reason.
   - Removes items from the project in one undo group (Cmd+Z reverts it) and saves the project.
   - Moves files to the Trash through Finder (`osascript`, batches of 40). Never `rm`, never permanent deletion. The owner checks the Trash and empties it.

## What counts as "unused"

- Computed recursively from the delivered comps through precomps. Footage that only sits in comps outside the delivered set (old versions, drafts) is unused too; those comps are kept but lose the matching layers (with a warning).
- Unused solids and placeholders are removed from the project as well (`path: null`).
- Data files `.json/.csv/.mgjson/.txt` are never removed: expressions read them through `footage()`, so `usedIn` is always empty.
- Image sequences in use: every frame with the same prefix and extension in that folder counts as used.

## Job folder (owner's rule, 2026-10-23)

- Only files inside the job folder may go to the Trash. Job folder = the folder holding the project; if that folder is named like Project/Projects/Premiere/PR/AE/After Effects/Dự án, its parent. Override with `jobFolder`.
- Unused footage outside the job folder (SFX from a sound library, music libraries on the Mac, shared assets) is only removed from the project, with reason "unused; file outside the job folder, removed from the project only, kept on the Mac". Folders outside the job are not scanned.
- The report has a `thu_muc_job` key; `clean_unused` re-applies this rule before trashing (files outside the job are skipped even if listed).

## Proxies follow their source

- The proxy of unused footage (attached through `proxySource`, or a `Proxies/<name>_Proxy.*` file next to the source, Premiere's pattern) goes to the Trash with reason "proxy of an unused file".
- The proxy of footage in use is always kept, even when not attached in AE (matched by the `<source name>_Proxy` name).
- Orphan proxies in `Proxies` (matching no source file): "unused proxy in the source folder".

## Which files are proposed for the Trash

- Only the folders holding imported footage are scanned (not recursive), plus their `Proxies` sub-folder.
- Picked: media files (video, audio, stills, PSD/PSB, AI/EPS/SVG, RAW) never imported, or belonging to unused items (including their proxy files).
- Never picked:
  - files in use
  - project files `.aep/.prproj`, hidden files, non-media files
  - files inside a folder one level named like Edited, Export, Xuất file, Render, Output, Deliver(ables), Final, Thành phẩm, Bàn giao (compared without accents, case-insensitive)
  - files outside the source folders
- Shared folders of the machine (home, Desktop, Downloads, Documents, Movies, Pictures, Music, the root of an external drive `/Volumes/<drive>`): un-imported files are not scanned, only files of unused items are picked. Footage imported straight from the Desktop does not mean every image on the Desktop belongs to the job.
- A warning is raised when another project (`.aep/.prproj`) sits in a source folder or its parent: files may be used there, check before emptying the Trash.

## Report (same format as the Premiere server)

```json
{ "phien_ban": 1, "app": "ae", "project": "<path>", "tao_luc": "ISO",
  "thu_muc_job": "<path>", "giu": ["<comp>"], "dang_dung": [{ "path", "size" }],
  "xoa_khoi_project": [{ "id", "name", "path|null", "ly_do" }],
  "dua_vao_trash": [{ "path", "size", "ly_do" }],
  "tong_dung_luong": 0, "canh_bao": [] }
```

`clean_unused` refuses a report made for a project other than the open one.

## Notes

- The first time Finder is controlled, macOS asks for the Automation permission. If it is blocked (-1743) the op says so: System Settings > Privacy & Security > Automation, allow Claude to control Finder. No file is deleted in that case; the project items are already removed, open the checkpoint to go back.
- `~/.Trash` cannot be listed with `ls` (needs Full Disk Access). Check it with `osascript -e 'tell application "Finder" to get name of every item of trash'`.
- Test run 2026-10-23 on a scratch project (delivered comp Main): removed 3 items (footage only used in an "old version" comp, unused audio, an old render in `Xuất file`), moved 5 files to the Trash (2.1 MB), kept the footage in use, a notes file and `Xuất file/Main V1.mp4`.
- Second run (after the job-folder and proxy rules): `Proxies/A001_Proxy.mov` of footage in use (not attached) was kept, the orphan `Proxies/Z009_Proxy.mov` went to the Trash.
- The logic is in `src/cleanup.ts` (pure functions, tested in `tests/cleanup.test.ts`); the ops are in `src/operations/cleanup.ts`.
