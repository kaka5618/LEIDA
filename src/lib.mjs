import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "..");

export async function loadEnv(file = path.join(ROOT, ".env")) {
  try {
    const body = await fs.readFile(file, "utf8");
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 1) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export async function loadConfig(file = path.join(ROOT, "config.json")) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error("找不到 config.json。请先执行：cp config.example.json config.json");
    }
    throw error;
  }
}

export function stableId(...parts) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 20);
}

export function authorHash(value = "unknown") {
  return stableId("author", value);
}

export async function ensureDir(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
}

export async function readJsonl(file) {
  try {
    const body = await fs.readFile(file, "utf8");
    return body.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeJsonl(file, rows) {
  await ensureDir(file);
  const unique = [...new Map(rows.map((row) => [row.id, row])).values()];
  await fs.writeFile(file, unique.map((row) => JSON.stringify(row)).join("\n") + "\n");
}

export function daysAgoIso(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function queryBank(audience) {
  const queries = [];
  for (const topic of audience.topics || []) {
    for (const pain of audience.painPhrases || []) {
      queries.push(`\"${topic}\" \"${pain}\"`);
    }
  }
  return queries;
}
