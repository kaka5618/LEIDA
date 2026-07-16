#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeItems, clusterSignals } from "./analyzer.mjs";
import { collectReddit, collectYouTube, normalizeImported } from "./collectors.mjs";
import { loadConfig, loadEnv, readJsonl, ROOT, writeJsonl } from "./lib.mjs";
import { saveReport } from "./report.mjs";

const RAW_FILE = path.join(ROOT, "data/raw.jsonl");
const SIGNAL_FILE = path.join(ROOT, "data/signals.jsonl");

function log(message) {
  console.log(`[radar] ${message}`);
}

async function collect(config) {
  // Keep explicit manual imports, but refresh platform data so stale and demo
  // records never leak into the current 30-day report.
  const existing = (await readJsonl(RAW_FILE)).filter((item) => item.platform === "imported" && !item.id.startsWith("demo-"));
  const [reddit, youtube] = await Promise.all([
    collectReddit(config, log),
    collectYouTube(config, log)
  ]);
  const fresh = [...reddit, ...youtube];
  await writeJsonl(RAW_FILE, [...existing, ...fresh]);
  log(`采集完成：新增/更新 ${fresh.length} 条，当前共 ${[...new Map([...existing, ...fresh].map((item) => [item.id, item])).values()].length} 条`);
}

async function analyze(config) {
  const raw = await readJsonl(RAW_FILE);
  if (!raw.length) throw new Error("data/raw.jsonl 为空，请先运行 collect 或 demo");
  const signals = await analyzeItems(raw, config, log);
  await writeJsonl(SIGNAL_FILE, signals);
  log(`分析完成：${signals.filter((item) => item.isRealProblem).length}/${signals.length} 条被识别为真实问题`);
}

async function report(config) {
  const signals = await readJsonl(SIGNAL_FILE);
  if (!signals.length) throw new Error("data/signals.jsonl 为空，请先运行 analyze 或 demo");
  const clusters = clusterSignals(signals, config);
  const rejected = signals.filter((signal) => !signal.isRealProblem);
  const quality = {
    total: signals.length,
    accepted: signals.length - rejected.length,
    rejected: rejected.length,
    rejectionReasons: rejected.reduce((counts, signal) => {
      const reason = signal.rejectionReason || "Unknown rejection reason";
      counts[reason] = (counts[reason] || 0) + 1;
      return counts;
    }, {})
  };
  const file = await saveReport(clusters, config, undefined, quality);
  log(`报告已生成：${file}`);
}

async function demo() {
  const sample = JSON.parse(await fs.readFile(path.join(ROOT, "fixtures/sample-raw.json"), "utf8"));
  const config = JSON.parse(await fs.readFile(path.join(ROOT, "config.example.json"), "utf8"));
  await writeJsonl(RAW_FILE, sample.map((item) => normalizeImported(item)));
  await analyze(config);
  await report(config);
}

async function doctor() {
  const checks = [
    ["config.json", true, "真实研究配置"],
    ["YOUTUBE_API_KEY", Boolean(process.env.YOUTUBE_API_KEY), "YouTube 视频与评论采集"],
    ["REDDIT_CLIENT_ID", Boolean(process.env.REDDIT_CLIENT_ID), "Reddit OAuth client id"],
    ["REDDIT_CLIENT_SECRET", Boolean(process.env.REDDIT_CLIENT_SECRET), "Reddit OAuth client secret"],
    ["REDDIT_USER_AGENT", Boolean(process.env.REDDIT_USER_AGENT && !process.env.REDDIT_USER_AGENT.includes("your-reddit-username")), "Reddit 要求的真实 User-Agent"],
    ["LLM", Boolean(process.env.LLM_API_KEY && process.env.LLM_API_URL && process.env.LLM_MODEL), "可选；复杂语义分析"]
  ];
  console.log("Demand Radar 配置检查\n");
  for (const [name, ok, purpose] of checks) {
    console.log(`${ok ? "✓" : "○"} ${name.padEnd(22)} ${purpose}`);
  }
  const redditReady = checks.slice(2, 5).every((entry) => entry[1]);
  const youtubeReady = checks[1][1];
  console.log("\n结论：");
  if (redditReady || youtubeReady) {
    console.log(`可以运行 npm run run。可用数据源：${[redditReady && "Reddit", youtubeReady && "YouTube"].filter(Boolean).join(" + ")}`);
  } else {
    console.log("尚无可用的真实数据源。至少配置 YouTube，或完整配置 Reddit 的三个字段。");
  }
  if (!checks[5][1]) console.log("未配置 LLM，将使用保守的本地规则分析器，不影响采集。");
}

async function main() {
  await loadEnv();
  const command = process.argv[2] || "help";
  if (command === "demo") return demo();
  if (command === "doctor") return doctor();
  if (command === "help" || command === "--help" || command === "-h") {
    console.log(`Demand Radar\n\n命令：\n  npm run doctor   检查配置和可用数据源\n  npm run demo     使用测试数据生成报告\n  npm run collect  从已配置平台采集\n  npm run analyze  提取和评分需求\n  npm run report   生成 Markdown 报告\n  npm run run      完整运行 collect -> analyze -> report`);
    return;
  }
  const config = await loadConfig();
  if (command === "collect") return collect(config);
  if (command === "analyze") return analyze(config);
  if (command === "report") return report(config);
  if (command === "run") {
    await collect(config);
    await analyze(config);
    await report(config);
    return;
  }
  throw new Error(`未知命令：${command}`);
}

main().catch((error) => {
  console.error(`[radar] 失败：${error.message}`);
  process.exitCode = 1;
});
