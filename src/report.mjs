import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, ROOT } from "./lib.mjs";

function escapeMarkdown(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export function renderReport(clusters, config, quality = {}) {
  const now = new Date().toISOString();
  const accepted = clusters.filter((cluster) => cluster.score >= (config.minScore || 0));
  const lines = [
    `# ${config.projectName || "Demand Radar"}`,
    "",
    `生成时间：${now}`,
    `观察窗口：最近 ${config.days || 30} 天`,
    `候选需求：${accepted.length} 个（共 ${clusters.length} 个聚类）`,
    `原始候选：${quality.total ?? "未知"} 条；通过严格过滤：${quality.accepted ?? "未知"} 条；拒绝：${quality.rejected ?? "未知"} 条`,
    "",
    "## 过滤结果",
    "",
    ...(quality.rejectionReasons ? Object.entries(quality.rejectionReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `- ${reason}：${count}`) : ["- 本次未提供过滤统计。"]),
    "",
    "## 排名",
    "",
    "| 排名 | 用户群 | 问题主题 | 需求分 | 独立用户 | 平台 | 付费信号 | 建议 |",
    "|---:|---|---|---:|---:|---|---:|---|"
  ];
  accepted.forEach((cluster, index) => {
    lines.push(`| ${index + 1} | ${escapeMarkdown(cluster.audienceId)} | ${escapeMarkdown(cluster.topic)} | ${cluster.score}/100 | ${cluster.uniqueAuthors} | ${cluster.platforms.join(", ")} | ${cluster.explicitPayments} | ${cluster.opportunity.verdict} |`);
  });

  for (const [index, cluster] of accepted.entries()) {
    lines.push("", `## ${index + 1}. ${cluster.topic}`, "");
    lines.push(`- 用户群：${cluster.audienceId}`);
    lines.push(`- 需求评分：${cluster.score}/100`);
    lines.push(`- 独立用户：${cluster.uniqueAuthors}`);
    lines.push(`- 平台：${cluster.platforms.join(", ")}`);
    lines.push(`- 明确价格/付费信号：${cluster.explicitPayments}`);
    lines.push(`- 临时方案信号：${cluster.workarounds}`);
    lines.push(`- 高频发生信号：${cluster.frequent}`);
    lines.push(`- 高严重度信号：${cluster.highSeverity}`);
    lines.push(`- 评分拆分：独立用户 ${cluster.scoreBreakdown.independentUsers}/30，跨平台 ${cluster.scoreBreakdown.crossPlatform}/10，付费 ${cluster.scoreBreakdown.payment}/15，临时方案 ${cluster.scoreBreakdown.workaround}/15，频率 ${cluster.scoreBreakdown.frequency}/15，严重度 ${cluster.scoreBreakdown.severity}/10，证据质量 ${cluster.scoreBreakdown.evidenceQuality}/5`);

    lines.push("", "### 产品机会卡（待验证假设）", "");
    lines.push(`- 当前建议：${cluster.opportunity.verdict}`);
    lines.push(`- 个人开发难度：${cluster.opportunity.soloDifficulty}`);
    lines.push(`- 最窄 MVP 假设：${cluster.opportunity.mvpHypothesis}`);
    lines.push(`- 最大实现风险：${cluster.opportunity.primaryRisk}`);
    lines.push(`- 实现约束：${cluster.opportunity.buildConstraints.join("；")}`);
    lines.push(`- 仍缺证据：${cluster.opportunity.missingEvidence.length ? cluster.opportunity.missingEvidence.join("；") : "核心信号已齐，仍需访谈验证"}`);

    lines.push("", "### 原始证据", "");
    for (const item of cluster.items.slice(0, config.maxEvidencePerCluster || 10)) {
      const quote = escapeMarkdown(item.evidenceQuote || item.pain || "");
      const date = item.publishedAt ? item.publishedAt.slice(0, 10) : "日期未知";
      const engagement = item.engagement || {};
      lines.push(`- ${date} · ${item.severity || "unknown"} · 👍 ${engagement.likes || 0} / 回复 ${engagement.comments || 0}：“${quote}” — [${item.platform} 原文](${item.sourceUrl})（置信度 ${item.confidence}）`);
    }
    if (cluster.uniqueAuthors < 3) {
      lines.push("", "> 当前证据不足 3 个独立用户，只适合继续观察或访谈，不建议直接开发。");
    } else if (cluster.platforms.length < 2) {
      lines.push("", "> 信号只来自一个平台，建议去第二个平台交叉验证。 ");
    }
  }

  lines.push("", "## 阅读规则", "");
  lines.push("- 需求分用于排序，不代表市场规模；机会卡也只是待验证假设。");
  lines.push("- `watch` 只观察，`validate` 先访谈，`candidate` 才值得做人工原型。");
  lines.push("- 没有原文链接的结论不应进入开发决策。");
  lines.push("- 至少 3 个独立用户，并完成 5 次访谈或落地页验证后，再决定是否开发。");
  return lines.join("\n") + "\n";
}

export async function saveReport(clusters, config, output, quality) {
  const file = output || path.join(ROOT, "reports", `${new Date().toISOString().slice(0, 10)}.md`);
  await ensureDir(file);
  await fs.writeFile(file, renderReport(clusters, config, quality));
  return file;
}
