import test from "node:test";
import assert from "node:assert/strict";
import { clusterSignals, heuristicAnalyze } from "../src/analyzer.mjs";
import { renderReport } from "../src/report.mjs";

const config = {
  projectName: "Test Radar",
  days: 30,
  minScore: 25,
  maxEvidencePerCluster: 5,
  audiences: [{ id: "merchants", topics: ["inventory sync"] }]
};

function source(id, text, platform, authorHash) {
  return {
    id,
    platform,
    audienceId: "merchants",
    query: "inventory sync",
    title: "Inventory sync",
    text,
    authorHash,
    sourceUrl: `https://example.com/${id}`,
    publishedAt: "2026-07-01T00:00:00Z",
    engagement: { likes: 2, comments: 1 }
  };
}

test("renders a visual summary, action guidance and collapsible evidence", () => {
  const signals = [
    heuristicAnalyze(source("1", "I manually export inventory every week and it takes two hours. Is there a tool under $50?", "reddit", "a"), config),
    heuristicAnalyze(source("2", "We use a spreadsheet every week because inventory sync keeps failing and costs $80.", "youtube", "b"), config),
    heuristicAnalyze(source("3", "I copy inventory by hand every Friday and it keeps making mistakes.", "reddit", "c"), config)
  ];
  const report = renderReport(clusterSignals(signals), config, {
    total: 8,
    accepted: 3,
    rejected: 5,
    rejectionReasons: { "Too little concrete information": 5 }
  });

  assert.match(report, /本周结论/);
  assert.match(report, /👀 一眼看懂/);
  assert.match(report, /🟢 候选机会/);
  assert.match(report, /你现在该做什么/);
  assert.match(report, /个人开发适配/);
  assert.match(report, /近30天证据/);
  assert.match(report, /超出能力边界/);
  assert.match(report, /<details><summary><strong>🔎 查看 3 条原始证据/);
  assert.match(report, /给雷达反馈/);
});

test("renders an explicit do-not-build conclusion when nothing qualifies", () => {
  const report = renderReport([], config, { total: 4, accepted: 0, rejected: 4 });
  assert.match(report, /不要开发，先扩大样本/);
  assert.match(report, /进入榜单/);
});
