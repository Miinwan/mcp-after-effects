import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import { PACKAGE_ROOT } from "../config.js";
import { errorResult } from "../errors.js";
import { defineTool, jsonResult } from "./define-tool.js";

// The MCP's knowledge base: plain Markdown / JSON files in "<package>/Kiến thức"
// (override with AE_MCP_KNOWLEDGE_DIR). Adding knowledge = dropping a file in
// that folder; nothing to rebuild. Sub-folders are allowed and become part of
// the topic name ("Plugin/Red Giant").

export const KNOWLEDGE_DIR =
  process.env.AE_MCP_KNOWLEDGE_DIR ?? path.join(PACKAGE_ROOT, "Kiến thức");

interface Topic {
  topic: string;
  file: string;
  summary: string;
}

function walk(dir: string, prefix = ""): Topic[] {
  if (!existsSync(dir)) return [];
  const out: Topic[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full, `${prefix}${name}/`));
      continue;
    }
    if (!/\.(md|json|txt)$/i.test(name)) continue;
    // Data that sits next to its note (Kho logo khách.json beside .md) is read through the note.
    if (/\.json$/i.test(name) && existsSync(full.replace(/\.json$/i, ".md"))) continue;
    const text = readFileSync(full, "utf8");
    const firstLine =
      text
        .split(/\r?\n/)
        .map((l) => l.replace(/^#+\s*/, "").trim())
        .find((l) => l.length > 0) ?? "";
    out.push({
      topic: `${prefix}${name.replace(/\.(md|json|txt)$/i, "")}`,
      file: full,
      summary: firstLine.slice(0, 200),
    });
  }
  return out;
}

const norm = (s: string) => s.normalize("NFC").toLowerCase();

export const guideTool = defineTool({
  name: "ae_guide",
  title: "Knowledge base",
  description:
    "The motion-design and studio knowledge this MCP carries: workflow rules, easing and timing, kinetic typography, " +
    "PSD-to-animation recipes, the user's installed plugins / transitions / presets / MOGRTs and when to use them, " +
    "client brand rules. Call with no arguments to list topics, `topic` to read one, `query` to search all of them. " +
    "Read the relevant topic BEFORE planning a non-trivial animation or choosing an effect, so the plan uses what " +
    "is actually installed.",
  group: "inspect",
  blockedInReadOnly: false,
  effect: "read",
  inputShape: {
    topic: z.string().optional().describe("Topic name as listed (case-insensitive)."),
    query: z.string().optional().describe("Words to search for across every topic."),
  },
  handler: async (args) => {
    const topics = walk(KNOWLEDGE_DIR);
    if (args.topic) {
      const t = topics.find((x) => norm(x.topic) === norm(args.topic!));
      if (!t) {
        return errorResult("INVALID_ARGS", `no topic '${args.topic}'`, {
          details: { topics: topics.map((x) => x.topic) },
        });
      }
      return jsonResult({ topic: t.topic, content: readFileSync(t.file, "utf8") });
    }
    if (args.query) {
      const words = norm(args.query).split(/\s+/).filter(Boolean);
      const hits: Array<{ topic: string; line: number; text: string }> = [];
      for (const t of topics) {
        const lines = readFileSync(t.file, "utf8").split(/\r?\n/);
        lines.forEach((l, i) => {
          const n = norm(l);
          if (words.every((w) => n.includes(w)))
            hits.push({ topic: t.topic, line: i + 1, text: l.trim().slice(0, 300) });
        });
        if (hits.length > 200) break;
      }
      return jsonResult({ query: args.query, hits: hits.slice(0, 200) });
    }
    return jsonResult({
      folder: KNOWLEDGE_DIR,
      topics: topics.map(({ topic, summary }) => ({ topic, summary })),
    });
  },
});
