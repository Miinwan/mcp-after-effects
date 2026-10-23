# Export — Use when delivering a video: presets per platform, file naming, loudness and how to call the export.

Updated 2026-10-23 (settings agreed by the owner). After Effects: `ae_do render.export { comp, presets, client, title }` (+ `render.export_status`). Premiere: `export_deliverables { sequenceName, presets, client, title }` (+ `export_status`); the ProRes 422 HQ master goes through Adobe Media Encoder, so Premiere stays usable while it exports. File names: `<Client> <Title> <Aspect> V<n>` (next free V number), logged in `Kết quả xuất.md` inside the output folder (default `<project folder>/Xuất file`), each line with the bitrate used.

| Preset | Label | Frame | Codec | Loudness | Notes |
|---|---|---|---|---|---|
| youtube_4k | YouTube 4K | 3840x2160 | H.264 VBR 20 Mbps | -14 LUFS | QT Gamma LUT, ≤ 1 GB |
| youtube_1080 | YouTube 1080 | 1920x1080 | H.264 VBR 50 Mbps | -14 LUFS | QT Gamma LUT, ≤ 1 GB |
| reels | Reels / TikTok | 1080x1920 | H.264 VBR 50 Mbps | -14 LUFS | QT Gamma LUT, ≤ 1 GB; text inside the safe area (250 px top, 420 px bottom) |
| feed_4x5 | Feed 4:5 | 1080x1350 | H.264 VBR 50 Mbps | -14 LUFS | QT Gamma LUT, ≤ 1 GB |
| square | Square 1:1 (`Vuông 1:1`) | 1080x1080 | H.264 VBR 50 Mbps | -14 LUFS | QT Gamma LUT, ≤ 1 GB |
| led | LED | screen width/height | H.264 VBR by frame size | no audio | QT Gamma LUT, ≤ 1 GB; exact pixel size of the mall screen |
| review | Review copy (`Bản review`) | 720 high | H.264 5 Mbps | -14 LUFS | QT Gamma LUT; 'BẢN REVIEW' watermark and timecode so the client can comment by the second |
| master | Master ProRes 422 HQ | source frame | ProRes 422 HQ | unchanged | PCM 24-bit 48 kHz, no LUT |
| png_alpha | PNG sequence alpha | source frame | PNG RGBA | no audio | For overlays, no LUT |

## H.264 settings (matching the owner's AME preset)

- H.264 High, `.mp4`, source fps, progressive, square pixels (`setsar=1`), BT.709 tv range, AAC 320k 48 kHz.
- Render at Maximum Depth + Use Maximum Render Quality: ffmpeg processes in 16-bit RGB (`format=gbrp16le`), lanczos scaling with `accurate_rnd+full_chroma_int`, converting to YUV 4:2:0 only once at the end.
- VBR 1 pass (`-b:v`, peak `-maxrate` = 1.5×): Full HD class frames (up to 2560x1440) 50 Mbps; 4K class (larger than 2560x1440) 20 Mbps. The owner set 4K at 20 Mbps (lower than Full HD) on purpose; keep it, do not "fix" it.
- Files ≤ 1 GB (1,000,000,000 bytes): for long videos the bitrate drops automatically to 1 GB × 0.97 ÷ duration − 320k audio. Full HD at 50 Mbps hits the cap around 150 s, 4K at 20 Mbps around 380 s. See `bitrateFor(width, height, durationSec)` in `deliverables.ts`.
- Colour: every H.264 gets the "QT Gamma Compensation" LUT (Adobe, 1D, gamma 2.4 → 1.96) before resizing, so QuickTime, YouTube and browsers show the colours as in Premiere/AE (without it the image looks washed out). The default `.cube` path is set in `deliverables.ts`; override it with the `MCP_QT_GAMMA_LUT` environment variable. A missing file makes the H.264 exports fail clearly rather than export without the LUT. Never applied to the ProRes master or PNG alpha (the master is the source for further work). Do not put this LUT on an adjustment layer in the timeline.

## Why ffmpeg instead of an AME `.epr` preset

- ffmpeg makes every H.264; the ProRes master still goes through AME. Reasons: the 1 GB cap needs a bitrate computed from each video's duration while an `.epr` preset has one fixed bitrate; LUT, frame, -14 LUFS loudness and naming live in one place shared by AE and Premiere; it runs in the background without tying up AME.
- Verified 2026-10-23 on a ProRes 1080x1080 23.976 master: a 10 s excerpt came out at 50.2 Mbps, High, progressive, SAR 1:1, BT.709; the full 272.8 s video dropped to 28.1 Mbps target, measured 28.7 Mbps, 988.7 MB (x264 overshoots about 2 %, the 3 % margin is enough). After the LUT the mean frame luma read by ffmpeg goes from 60 to 49 (of 255), as intended: QuickTime and browsers brighten it back to the Premiere/AE look. To export straight from AME instead, build a preset by hand from the lines above plus the Lumetri Look "QT Gamma Compensation".

## Other

- Vertical/square versions: export from a 9x16/1x1 sequence (`create_aspect_versions`) or a comp of the right aspect; anything else is letterboxed.
- Loudness: measured in a first pass. A finished mix is adjusted linearly to the target; raw or very dynamic sound is lightly compressed then normalised (about -15 LUFS for unmixed field audio), peaks under -1 dBTP.
- LED: pass the screen's exact pixel width/height.
