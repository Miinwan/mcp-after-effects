#!/usr/bin/env node
// Scan the plug-ins, extensions, scripts, presets, MOGRTs and transition packs
// installed for Premiere and After Effects, and write them to
// "Kiến thức/Plugin đã cài" so the MCP knows what this machine has. Re-run
// whenever something new is installed:
//
//   node scripts/quet-plugin.mjs                 # Adobe's default locations
//   node scripts/quet-plugin.mjs "/Volumes/Drive/Transitions" "~/Desktop/Pack"
//
// Reads file names and manifests only, changes nothing. No dependencies.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "Kiến thức", "Plugin đã cài");
const expand = (p) => (p.startsWith("~") ? path.join(HOME, p.slice(1)) : p);

function ls(dir) {
  try {
    return readdirSync(dir).filter((n) => !n.startsWith("."));
  } catch {
    return [];
  }
}
const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** Walk `dir` up to `depth`, collecting entries whose name matches `re`. Bundles (.plugin, .bundle) are not entered. */
function find(dir, re, depth = 4, out = []) {
  if (depth < 0) return out;
  for (const name of ls(dir)) {
    const full = path.join(dir, name);
    if (re.test(name)) out.push(full);
    if (isDir(full) && !/\.(plugin|bundle|app|aex|prm)$/i.test(name)) find(full, re, depth - 1, out);
  }
  return out;
}

const adobeApps = ls("/Applications").filter((n) => /^Adobe (After Effects|Premiere Pro)/.test(n));
const report = { scannedAt: new Date().toISOString(), apps: adobeApps, sections: {} };
const add = (section, items) => {
  report.sections[section] = Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
};

// 1. Effect plug-ins inside each app and the shared MediaCore folder (Red Giant, BCC, Sapphire, FilmConvert…)
for (const app of adobeApps) {
  const dir = path.join("/Applications", app, "Plug-ins");
  add(`${app} — Plug-ins`, find(dir, /\.(plugin|bundle|aex|prm)$/i, 4).map((p) => path.relative(dir, p)));
}
const common = "/Library/Application Support/Adobe/Common/Plug-ins";
add(
  "Plug-ins dùng chung (MediaCore)",
  find(common, /\.(plugin|bundle|aex|prm)$/i, 5).map((p) => path.relative(common, p)),
);

// 2. CEP and UXP extensions (panels), with the host apps from their manifests
const extensions = [];
for (const base of [
  "/Library/Application Support/Adobe/CEP/extensions",
  path.join(HOME, "Library/Application Support/Adobe/CEP/extensions"),
]) {
  for (const name of ls(base)) {
    const manifest = path.join(base, name, "CSXS", "manifest.xml");
    let hosts = "";
    let label = name;
    if (existsSync(manifest)) {
      const xml = readFileSync(manifest, "utf8");
      hosts = Array.from(xml.matchAll(/<Host\s+Name="([A-Z]+)"/g), (m) => m[1]).join(", ");
      const menu = /<Menu[^>]*>([^<]+)<\/Menu>/.exec(xml);
      if (menu) label = `${menu[1].trim()} (${name})`;
    }
    extensions.push(`${label}${hosts ? ` — host: ${hosts}` : ""}`);
  }
}
for (const base of [
  "/Library/Application Support/Adobe/UXP/Plugins/External",
  path.join(HOME, "Library/Application Support/Adobe/UXP/Plugins/External"),
]) {
  for (const name of ls(base)) extensions.push(`${name} (UXP)`);
}
add("Extension (panel CEP và UXP)", extensions);

// 3. Scripts and ScriptUI panels for After Effects
for (const app of adobeApps.filter((a) => a.includes("After Effects"))) {
  const dir = path.join("/Applications", app, "Scripts");
  add(`${app} — Scripts`, find(dir, /\.(jsx|jsxbin)$/i, 3).map((p) => path.relative(dir, p)));
}

// 4. Animation presets (.ffx) and Premiere effect presets
const ffx = [];
for (const app of adobeApps.filter((a) => a.includes("After Effects"))) {
  const dir = path.join("/Applications", app, "Presets");
  ffx.push(...find(dir, /\.ffx$/i, 5).map((p) => `[built-in] ${path.relative(dir, p)}`));
}
const docsAdobe = path.join(HOME, "Documents", "Adobe");
for (const ver of ls(docsAdobe).filter((n) => /After Effects/.test(n))) {
  const dir = path.join(docsAdobe, ver, "User Presets");
  ffx.push(...find(dir, /\.ffx$/i, 5).map((p) => `[user] ${path.relative(dir, p)}`));
}
add("Preset After Effects (.ffx)", ffx);
add(
  "Preset Premiere (.prfpset)",
  find(path.join(docsAdobe, "Premiere Pro"), /\.prfpset$/i, 6).map((p) => path.relative(docsAdobe, p)),
);

// 5. Motion Graphics Templates
const mogrtDirs = [
  path.join(HOME, "Library/Application Support/Adobe/Common/Motion Graphics Templates"),
  path.join(HOME, "Library/Application Support/Adobe/Common/Essential Graphics"),
];
add(
  "MOGRT",
  mogrtDirs.flatMap((d) => find(d, /\.mogrt$/i, 5).map((p) => path.relative(d, p))),
);

// 6. Extra folders given on the command line (transition packs, template libraries on W.stu…)
for (const extra of process.argv.slice(2).map(expand)) {
  add(
    `Extra folder: ${extra}`,
    find(extra, /\.(mogrt|aep|ffx|prfpset|prproj|mov|mp4|png)$/i, 6).map((p) => path.relative(extra, p)),
  );
}

// Write: one Markdown per section + the raw JSON
mkdirSync(OUT, { recursive: true });
let index = `# Installed plug-ins — overview\n\nScanned at ${report.scannedAt}. Apps: ${adobeApps.join(", ") || "(none found)"}.\n\n`;
for (const [section, items] of Object.entries(report.sections)) {
  index += `- ${section}: ${items.length}\n`;
  const file = section.replace(/[\\/:*?"<>|—]/g, " ").replace(/\s+/g, " ").trim();
  const body = `# ${section}\n\n${items.length} items. Scanned at ${report.scannedAt}.\n\n${items.map((i) => `- ${i}`).join("\n")}\n`;
  writeFileSync(path.join(OUT, `${file}.md`), body);
}
index +=
  "\nRead each section with ae_guide. The After Effects effect list with matchNames comes from ae_do knowledge.refresh_effects.\n";
writeFileSync(path.join(OUT, "Tổng quan.md"), index);
writeFileSync(path.join(OUT, "inventory.json"), JSON.stringify(report, null, 2));
console.log(index);
