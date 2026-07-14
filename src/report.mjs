import fs from "node:fs/promises";
import path from "node:path";
import { ensureDir, ROOT } from "./lib.mjs";

function escapeMarkdown(value = "") {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function verdictMeta(verdict) {
  if (verdict === "candidate") return { icon: "🟢", label: "候选机会", action: "可以做人工原型" };
  if (verdict === "validate") return { icon: "🟡", label: "需要验证", action: "先访谈，不开发" };
  return { icon: "⚪", label: "继续观察", action: "证据不足，不开发" };
}

function difficultyLabel(value) {
  return value === "high" ? "🔴 高" : value === "low" ? "🟢 低" : "🟡 中";
}

function scoreBar(score) {
  const filled = Math.max(0, Math.min(10, Math.round(score / 10)));
  return `${"█".repeat(filled)}${"░".repeat(10 - filled)} ${score}/100`;
}

export function renderReport(clusters, config, quality = {}) {
  const now = new Date().toISOString();
  const accepted = clusters.filter((cluster) => cluster.score >= (config.minScore || 0));
  const verdictCounts = accepted.reduce((counts, cluster) => {
    counts[cluster.opportunity.verdict] = (counts[cluster.opportunity.verdict] || 0) + 1;
    return counts;
  }, {});
  const top = accepted[0];
  const topMeta = top ? verdictMeta(top.opportunity.verdict) : null;
  const weeklyConclusion = !top
    ? "本周没有达到最低分的需求。不要开发，先扩大样本。"
    : top.opportunity.verdict === "candidate"
      ? `本周最值得关注的是「${top.topic}」。先找 5 位用户做人工验证，再决定是否开发。`
      : top.opportunity.verdict === "validate"
        ? `本周信号最高的是「${top.topic}」，但证据仍不够。先打开原文并补足用户访谈。`
        : `本周只有弱信号。最高项是「${top.topic}」，暂时不要进入开发。`;
  const lines = [
    `# 📡 ${config.projectName || "Demand Radar"}`,
    "",
    `> **本周结论：${weeklyConclusion}**`,
    "",
    `生成时间：${now.slice(0, 10)} · 观察窗口：最近 ${config.days || 30} 天`,
    "",
    "## 👀 一眼看懂",
    "",
    "| 原始评论 | 有效问题 | 进入榜单 | 🟢 候选机会 | 🟡 需要验证 | ⚪ 继续观察 |",
    "|---:|---:|---:|---:|---:|---:|",
    `| ${quality.total ?? "-"} | ${quality.accepted ?? "-"} | ${accepted.length} | ${verdictCounts.candidate || 0} | ${verdictCounts.validate || 0} | ${verdictCounts.watch || 0} |`,
    "",
    "### 你现在该做什么",
    "",
    ...(top ? [
      `1. 打开排名第一的「${top.topic}」原始证据，确认它是不是目标用户本人遇到的问题。`,
      `2. 补齐：${top.opportunity.missingEvidence.length ? top.opportunity.missingEvidence.join("、") : "5 次用户访谈"}。`,
      `3. 当前动作：**${topMeta.icon} ${topMeta.action}**。`
    ] : ["1. 不开发。", "2. 调整关键词或增加数据源后再观察一周。"]),
    "",
    "## 🏆 需求排名",
    "",
    "| 排名 | 状态 | 问题主题 | 需求强度 | 用户数 | 付费信号 | 开发难度 |",
    "|---:|---|---|---:|---:|---|---|"
  ];
  accepted.forEach((cluster, index) => {
    const meta = verdictMeta(cluster.opportunity.verdict);
    lines.push(`| ${index + 1} | ${meta.icon} ${meta.label} | ${escapeMarkdown(cluster.topic)} | ${cluster.score}/100 | ${cluster.uniqueAuthors} | ${cluster.explicitPayments ? `✅ ${cluster.explicitPayments}` : "❌ 0"} | ${difficultyLabel(cluster.opportunity.soloDifficulty)} |`);
  });

  for (const [index, cluster] of accepted.entries()) {
    const meta = verdictMeta(cluster.opportunity.verdict);
    lines.push("", `## ${index + 1}. ${meta.icon} ${cluster.topic}`, "");
    lines.push(`> **${meta.label}：${meta.action}**`);
    lines.push("", `**需求强度**　\`${scoreBar(cluster.score)}\``, "");
    lines.push("| 关键信号 | 结果 |", "|---|---|");
    lines.push(`| 目标用户 | ${escapeMarkdown(cluster.audienceId)} |`);
    lines.push(`| 独立用户 | ${cluster.uniqueAuthors} 位 |`);
    lines.push(`| 数据来源 | ${cluster.platforms.join(", ")} |`);
    lines.push(`| 明确付费 | ${cluster.explicitPayments ? `✅ ${cluster.explicitPayments} 条` : "❌ 暂无"} |`);
    lines.push(`| 高频发生 | ${cluster.frequent ? `✅ ${cluster.frequent} 条` : "❌ 暂无"} |`);
    lines.push(`| 临时方案 | ${cluster.workarounds ? `✅ ${cluster.workarounds} 条` : "❌ 暂无"} |`);
    lines.push(`| 个人开发难度 | ${difficultyLabel(cluster.opportunity.soloDifficulty)} |`);

    lines.push("", "### 💡 最窄实现方案", "");
    lines.push(`**MVP 假设：** ${cluster.opportunity.mvpHypothesis}`);
    lines.push("", `**最大风险：** ${cluster.opportunity.primaryRisk}`);
    lines.push("", `**必须遵守：** ${cluster.opportunity.buildConstraints.join("；")}`);
    lines.push("", `**开发前还缺：** ${cluster.opportunity.missingEvidence.length ? cluster.opportunity.missingEvidence.join("；") : "核心信号已齐，仍需完成用户访谈"}`);

    lines.push("", `<details><summary><strong>🔎 查看 ${Math.min(cluster.items.length, config.maxEvidencePerCluster || 10)} 条原始证据</strong></summary>`, "");
    for (const item of cluster.items.slice(0, config.maxEvidencePerCluster || 10)) {
      const quote = escapeMarkdown(item.evidenceQuote || item.pain || "");
      const date = item.publishedAt ? item.publishedAt.slice(0, 10) : "日期未知";
      const engagement = item.engagement || {};
      lines.push(`- **${date} · ${item.platform}**：&ldquo;${quote}&rdquo; [打开原文 ↗](${item.sourceUrl}) · 👍 ${engagement.likes || 0} · 回复 ${engagement.comments || 0}`);
    }
    lines.push("", "</details>");
    if (cluster.uniqueAuthors < 3) {
      lines.push("", "> ⚠️ 当前证据不足 3 个独立用户，只适合继续观察或访谈，不建议直接开发。");
    } else if (cluster.platforms.length < 2) {
      lines.push("", "> ⚠️ 信号只来自一个平台，建议去第二个平台交叉验证。 ");
    }
  }

  lines.push("", "<details><summary><strong>🧹 查看过滤统计与评分说明</strong></summary>", "");
  lines.push("**过滤结果**");
  lines.push("", ...(quality.rejectionReasons ? Object.entries(quality.rejectionReasons).sort((a, b) => b[1] - a[1]).map(([reason, count]) => `- ${reason}：${count}`) : ["- 本次未提供过滤统计。"]));
  lines.push("", "**阅读规则**");
  lines.push("", "- 需求分只用于同一批线索排序，不代表市场规模。", "- 🟢 才值得做人工原型；🟡 先访谈；⚪ 只观察。", "- 没有原文链接的结论不进入开发决策。", "- 至少 3 个独立用户并完成 5 次访谈后，再决定是否开发。", "", "</details>");
  lines.push("", "---", "", "### 💬 给雷达反馈", "", "在 Issue 下留言即可，例如：`需求 1：值得验证`、`需求 2：误报`、`下周继续观察库存问题`。");
  return lines.join("\n") + "\n";
}

export async function saveReport(clusters, config, output, quality) {
  const file = output || path.join(ROOT, "reports", `${new Date().toISOString().slice(0, 10)}.md`);
  await ensureDir(file);
  await fs.writeFile(file, renderReport(clusters, config, quality));
  return file;
}
