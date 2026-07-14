import fs from "node:fs/promises";
import path from "node:path";
import { ROOT, stableId } from "./lib.mjs";

const signals = {
  need: [
    /is there (?:a|any) (?:tool|app|way)/i,
    /looking for (?:a|an) (?:tool|app|way)/i,
    /need (?:a|an) (?:tool|app|way)/i,
    /how do you/i,
    /what do .{0,40} use/i,
    /i wish there was/i,
    /can you (?:clarify|explain|help)/i,
    /need help/i,
    /does (?:it|this) work/i,
    /do you have (?:another|any other)/i
  ],
  friction: [
    /takes? (?:me )?(?:too long|\d+ (?:hours?|minutes?))/i,
    /frustrat(?:ing|ed)/i,
    /waste of time/i,
    /keep(?:s)? (?:breaking|failing|making mistakes)/i,
    /error[- ]prone/i,
    /doesn['’]?t|didn['’]?t|not working|not proper/i,
    /confus(?:ing|ed)/i,
    /mismatch|not match|double counted|missing/i,
    /struggl(?:e|ing|ed)|stubborn balance|quietly break/i,
    /cannot|can['’]?t|need help|problem with/i,
    /by hand/i,
    /manually/i
  ],
  workaround: [
    /spreadsheet|google sheets|excel/i,
    /export (?:a )?csv/i,
    /built (?:a|my) script/i,
    /workaround/i,
    /copy .+ (?:by hand|manually)/i,
    /using zapier/i,
    /quickbooks|xero|plugin|integration|data feed|clearing account/i
  ],
  money: [
    /too expensive/i,
    /costs? (?:more|\$|£|€)/i,
    /\$\s?\d+/i,
    /budget|subscription|paid for|paying for|cancelled|canceled/i
  ],
  repetition: [
    /every (?:day|week|month|friday|monday)/i,
    /daily|weekly|monthly|twice a week|each time/i
  ],
  specificity: [
    /inventory|stockout|overstock|sold out|refund|returns?|payout|chargeback/i,
    /quickbooks|xero|shopify|accounting|bookkeeping|csv|plugin|data feed|clearing account/i
  ]
};

function matchedCategories(text) {
  return Object.entries(signals).filter(([, patterns]) => patterns.some((pattern) => pattern.test(text))).map(([key]) => key);
}

function contentGuards(text) {
  const compact = text.replace(/\s+/g, " ").trim();
  const likelyPromotion = /(?:i|we) (?:built|made|launched|created)|our (?:app|tool|platform|service)|(?:install|download|subscribe|sign up|affiliate|promo code|dm me|check out my)/i.test(compact)
    && /(?:solve|tool|app|product|platform|service|business|link)/i.test(compact);
  const lowInformation = compact.length < 45
    || /^(?:great|good|nice|awesome|amazing|helpful) (?:video|content|tutorial)[.! ]*(?:thanks?|thank you)?[.! ]*$/i.test(compact)
    || /^(?:thanks?|thank you|first|love this|very helpful)[.! ]*$/i.test(compact);
  const suspiciousContactSpam = /(?:whats?app|telegram|contact (?:him|her|me)|guaranteed profit|earn \$?\d+|crypto recovery)/i.test(compact);
  return { likelyPromotion, lowInformation, suspiciousContactSpam };
}

function severityFor(text, categories) {
  if (/lost (?:money|sales|orders)|chargeback|double counted|sold out|stockout|keeps? (?:breaking|failing)|\d+ hours?|every day/i.test(text)) return "high";
  if (categories.includes("friction") && (categories.includes("workaround") || categories.includes("repetition"))) return "medium";
  return categories.includes("friction") ? "medium" : "low";
}

function likelyExpertReply(item, text) {
  if (item.platform !== "youtube" || text.length < 260 || /\b(?:i|we|my|our)\b/i.test(text)) return false;
  const sentences = text.split(/[.!?]+/).filter((part) => part.trim().length > 20);
  return sentences.length >= 3 && /\?\s*$/.test(text) && /\b(?:should|usually|most|when|where|means|because)\b/i.test(text);
}

function exactEvidence(text) {
  const sentence = text.split(/(?<=[.!?])\s+|\n+/)
    .map((part) => ({ part, weight: matchedCategories(part).length * 100 + Math.min(part.length, 99) }))
    .filter((entry) => entry.weight >= 100)
    .sort((a, b) => b.weight - a.weight)[0]?.part;
  return (sentence || text).trim().slice(0, 280);
}

function topicFor(item, config) {
  const audience = (config.audiences || []).find((entry) => entry.id === item.audienceId);
  const haystack = `${item.query} ${item.title} ${item.text}`.toLowerCase();
  return (audience?.topics || []).find((topic) => haystack.includes(topic.toLowerCase())) || item.query || "Unclassified";
}

export function heuristicAnalyze(item, config) {
  const text = item.platform === "youtube"
    ? String(item.text || "").trim()
    : `${item.title || ""}\n${item.text || ""}`.trim();
  const categories = matchedCategories(text);
  const guards = contentGuards(text);
  const hasConcretePain = categories.includes("need") || categories.includes("friction")
    || (categories.includes("workaround") && categories.includes("money"));
  const hasContext = /\b(?:i|we|my|our|store|shop|business|customer|orders?|inventory|shopify|xero|quickbooks)\b/i.test(text)
    || categories.includes("specificity");
  const expertReply = likelyExpertReply(item, text);
  const isRealProblem = categories.length >= 2 && hasConcretePain && hasContext
    && !item.authorIsCreator && !expertReply && !guards.likelyPromotion && !guards.lowInformation && !guards.suspiciousContactSpam;
  const frequency = /daily|every day/i.test(text) ? "daily"
    : /weekly|every week|twice a week|every friday|every monday/i.test(text) ? "weekly"
      : /monthly|every month/i.test(text) ? "monthly" : "unknown";
  const paymentSignal = categories.includes("money") ? "explicit" : "none";
  const topic = topicFor(item, config);
  const confidence = isRealProblem ? Math.min(0.55 + categories.length * 0.08, 0.91) : Math.min(0.2 + categories.length * 0.08, 0.55);

  return {
    id: `signal-${item.id}`,
    sourceId: item.id,
    platform: item.platform,
    audienceId: item.audienceId,
    topic,
    clusterKey: `${item.audienceId}:${topic}`.toLowerCase(),
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    authorHash: item.authorHash,
    engagement: item.engagement,
    isRealProblem,
    userType: isRealProblem ? item.audienceId : null,
    jobToBeDone: isRealProblem ? topic : null,
    pain: isRealProblem ? exactEvidence(text) : null,
    trigger: null,
    currentSolution: categories.includes("workaround") ? "A manual or workaround process is mentioned" : null,
    currentSolutionProblem: categories.includes("friction") ? "The current process costs time or causes errors" : null,
    frequency,
    paymentSignal,
    severity: severityFor(text, categories),
    evidenceQuote: isRealProblem ? exactEvidence(text) : null,
    confidence: Number(confidence.toFixed(2)),
    rejectionReason: isRealProblem ? null
      : item.authorIsCreator ? "Comment was written by the video publisher"
        : expertReply ? "Likely educational or vendor-authored reply, not a first-person problem"
        : guards.likelyPromotion ? "Likely promotional or vendor-authored content"
        : guards.suspiciousContactSpam ? "Likely contact or financial spam"
          : guards.lowInformation ? "Too little concrete information"
            : !hasContext ? "No concrete user or operating context"
              : "Missing enough concrete problem signals",
    matchedCategories: categories,
    analyzer: "rules"
  };
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

async function llmAnalyze(item, config) {
  const apiUrl = process.env.LLM_API_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL;
  if (!apiUrl || !apiKey || !model) return null;

  const template = await fs.readFile(path.join(ROOT, "prompts/extract-demand.txt"), "utf8");
  const content = item.platform === "youtube"
    ? String(item.text || "").trim()
    : `${item.title || ""}\n\n${item.text || ""}`.trim();
  const sourceContext = [item.query, item.title].filter(Boolean).join(" | ");
  const prompt = template.replace("{{SOURCE_CONTEXT}}", sourceContext).replace("{{CONTENT}}", content);
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }] })
  });
  if (!response.ok) throw new Error(`LLM ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const payload = await response.json();
  const output = payload.choices?.[0]?.message?.content;
  if (!output) throw new Error("LLM response does not contain choices[0].message.content");
  const result = extractJson(output);
  if (result.evidenceQuote && !content.includes(result.evidenceQuote)) {
    throw new Error("LLM evidenceQuote is not an exact substring of the source");
  }
  const topic = topicFor(item, config);
  const categories = matchedCategories(content);
  const guards = contentGuards(content);
  const expertReply = likelyExpertReply(item, content);
  const accepted = Boolean(result.isRealProblem) && !item.authorIsCreator && !expertReply && !guards.likelyPromotion && !guards.lowInformation && !guards.suspiciousContactSpam;
  return {
    id: `signal-${item.id}`,
    sourceId: item.id,
    platform: item.platform,
    audienceId: item.audienceId,
    topic,
    clusterKey: `${item.audienceId}:${topic}`.toLowerCase(),
    sourceUrl: item.sourceUrl,
    publishedAt: item.publishedAt,
    authorHash: item.authorHash,
    engagement: item.engagement,
    ...result,
    isRealProblem: accepted,
    severity: severityFor(content, categories),
    rejectionReason: accepted ? null : item.authorIsCreator ? "Comment was written by the video publisher" : expertReply ? "Likely educational or vendor-authored reply, not a first-person problem" : result.rejectionReason || (guards.likelyPromotion ? "Likely promotional or vendor-authored content" : "Failed deterministic quality guard"),
    matchedCategories: categories,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    analyzer: "llm"
  };
}

export function buildOpportunityCard(cluster) {
  const topic = cluster.topic.toLowerCase();
  let mvpHypothesis = "用一次性 CSV 输入和异常清单输出验证该问题；先人工交付，不做账号体系和自动写回。";
  let soloDifficulty = "medium";
  let primaryRisk = "问题描述仍然过宽，容易做成通用工具。";

  if (/inventory|stock/.test(topic)) {
    mvpHypothesis = "只读库存差异检查器：导入 Shopify 与一个渠道的库存 CSV，输出差异清单；不自动修改库存。";
    soloDifficulty = "high";
    primaryRisk = "真正的实时同步涉及多渠道 API、冲突处理和库存责任，个人开发成本很高。";
  } else if (/return|refund/.test(topic)) {
    mvpHypothesis = "退货状态核对表：导入订单与退货 CSV，标出超过时限但尚未退款的订单；不自动退款。";
    primaryRisk = "不同退货流程差异大，必须先限定一个商家类型和一个退货流程。";
  } else if (/reconcil|account|bookkeep|order/.test(topic)) {
    mvpHypothesis = "只读对账检查器：导入 Shopify 打款/订单 CSV 与一种会计导出，输出未匹配和重复记录；不写回账本。";
    primaryRisk = "税务和会计口径容易扩大范围，第一版必须只做异常定位而不是记账。";
  }

  const verdict = cluster.uniqueAuthors >= 3 && (cluster.explicitPayments > 0 || cluster.frequent >= 2 || cluster.workarounds >= 2)
    ? "candidate" : cluster.uniqueAuthors >= 2 ? "validate" : "watch";
  const missingEvidence = [];
  if (cluster.uniqueAuthors < 3) missingEvidence.push("至少 3 个独立用户");
  if (cluster.platforms.length < 2) missingEvidence.push("第二个平台的交叉证据");
  if (!cluster.explicitPayments) missingEvidence.push("明确价格或现有付费信号");
  if (!cluster.frequent) missingEvidence.push("发生频率");

  return {
    verdict,
    soloDifficulty,
    mvpHypothesis,
    primaryRisk,
    buildConstraints: ["只读，不自动写回第三方系统", "只支持一种输入路径", "先用人工服务验证 5 位用户"],
    missingEvidence
  };
}

export async function analyzeItems(items, config, onProgress = () => {}) {
  const results = [];
  for (const [index, item] of items.entries()) {
    let result;
    try {
      result = await llmAnalyze(item, config);
    } catch (error) {
      onProgress(`LLM 分析失败，回退规则分析：${item.id} (${error.message})`);
    }
    results.push(result || heuristicAnalyze(item, config));
    if ((index + 1) % 20 === 0) onProgress(`已分析 ${index + 1}/${items.length}`);
  }
  return results;
}

export function clusterSignals(signalsList) {
  const valid = signalsList.filter((signal) => signal.isRealProblem);
  const groups = new Map();
  for (const signal of valid) {
    const key = signal.clusterKey || stableId(signal.audienceId, signal.topic);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(signal);
  }
  return [...groups.entries()].map(([key, items]) => {
    const authors = new Set(items.map((item) => item.authorHash));
    const platforms = new Set(items.map((item) => item.platform));
    const explicitPayments = items.filter((item) => item.paymentSignal === "explicit").length;
    const workarounds = items.filter((item) => item.currentSolution).length;
    const frequent = items.filter((item) => ["daily", "weekly"].includes(item.frequency)).length;
    const highSeverity = items.filter((item) => item.severity === "high").length;
    const averageConfidence = items.reduce((sum, item) => sum + item.confidence, 0) / items.length;
    const scoreBreakdown = {
      independentUsers: Math.min(authors.size * 10, 30),
      crossPlatform: Math.min(platforms.size * 5, 10),
      payment: Math.min(explicitPayments * 8, 15),
      workaround: Math.min(workarounds * 6, 15),
      frequency: Math.min(frequent * 6, 15),
      severity: Math.min(highSeverity * 5, 10),
      evidenceQuality: Math.round(averageConfidence * 5)
    };
    const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
    const cluster = {
      id: `cluster-${stableId(key)}`,
      key,
      topic: items[0].topic,
      audienceId: items[0].audienceId,
      uniqueAuthors: authors.size,
      platforms: [...platforms],
      explicitPayments,
      workarounds,
      frequent,
      highSeverity,
      score,
      scoreBreakdown,
      strength: authors.size >= 3 && platforms.size >= 2 ? "strong" : authors.size >= 2 ? "medium" : "weak",
      items: items.sort((a, b) => b.confidence - a.confidence)
    };
    return { ...cluster, opportunity: buildOpportunityCard(cluster) };
  }).sort((a, b) => b.score - a.score);
}
