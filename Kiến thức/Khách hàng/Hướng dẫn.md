# Clients — Use when starting a job for a client: per-client rules, and how to collect logo, colours and fonts from earlier deliverables before animating.

Updated 2026-10-23. One Markdown file per client in this folder (`Khách hàng/<Client name>.md`). Client files stay on the owner's machine and are not committed; only this how-to is shared. Read the client's file before starting a job.

## Boundaries
- Brand guidelines belong to the visual team. This workflow only does animation and video: take the exact colours, fonts and logo the visual team delivered and apply them to motion. Never invent new brand colours, never edit a logo.
- The brand kit in the MCP is an animation working copy, updated per job. Until the client has an official brand guide it is based on the colours and design of earlier deliverables; once a guide exists, follow it.
- Only look a client up by name when the owner asks. Do not pull data from other systems.

## Workflow for a job for client X
1. **Read the client file** `Khách hàng/<Client name>.md` if it exists (`ae_guide { topic: "Khách hàng/<Client name>" }`) and `ae_do brand.get { name }` if a brand kit is saved. Use what is there; only add what is new.
2. **Logo**: `ae_do brand.find_logo { client: "X", tone }` (library at `MCP_LOGO_DIR` or `logoDir` in `config.local.json`; read-only). Dark backgrounds use `trắng` (white), light ones `đen` (black) or `màu` (colour), endcards `động` (animated). The scanned list is the `Kho logo khách` note (local only).
3. **Colours**: the owner points to the job folder or earlier deliverables (PSD, AI, PDF, key visual images, social posts). For each representative file: `ae_do brand.colors_from_file { file, count: 5 }` → hex and area share; `neutral: true` marks white/grey/black (usually background, record only if it really is a brand colour). Colours shared by 2–3 deliverables are the main ones. With an `.ase` swatch file use `project.parse_swatch` (more exact than measuring images).
4. **Fonts**: open the PSD with `psd.import { editableText: true }`, then `font.list_used` for PostScript names; `font.list_missing` reports fonts not installed (tell the owner, never substitute silently). AI/PDF have no text layers: ask the owner or the visual team.
5. **Save the brand kit**: `ae_do brand.save { name: "X", colors: { primary, accent, … }, fonts: { heading, body }, logo, notes }`. Apply it to a comp with `brand.apply`; templates (`template.*`) take `brand: "X"`.
6. **Write the client file** `Khách hàng/<Client name>.md` (template below). After the owner approves a delivery, add the approved motion style and any revision requests.
7. Unconfirmed colours or fonts (measured from one image, heavily compressed, graded): mark them "unconfirmed" and ask the owner before using them in a delivery.

## Client file template
```markdown
# <Client name> — colours, fonts, logo, approved motion styles

Updated <date>. Sources: <deliverables measured, paths>. Brand kit: `<brand.save name>`.

## Colours
| Role | Hex | Source | Notes |
|---|---|---|---|
| primary | #RRGGBB | <file> | |
| accent | #RRGGBB | <file> | |

## Fonts
- Headings: <PostScript name>; body: <PostScript name>. Full Vietnamese diacritics? (`text.qa`)

## Logo
- Default / white / black / animated: <paths from brand.find_logo>. Usual placement, safe area.

## Usual delivery formats
- Frame, fps, duration, platforms (`render.export` presets).

## Approved motion styles
- Job <name>, <date>: entrances, transitions, tempo, seed, ops used. Next time vary it, do not repeat it as is.

## Revision requests from this client
- ...
```
