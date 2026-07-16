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
    /inventory|stockout|overstock|sold out|refund|returns?|payout|chargeback|product images?|background|watermark|resize|crop/i,
    /quickbooks|xero|shopify|etsy|merchant center|ecommerce|listing|catalog|sku|variants?|reviews?|csv|plugin|data feed|clearing account/i
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
  if (item.topic) return item.topic;
  const audience = (config.audiences || []).find((entry) => entry.id === item.audienceId);
  const haystack = `${item.query} ${item.title} ${item.text}`.toLowerCase();
  return (audience?.topics || []).find((topic) => haystack.includes(topic.toLowerCase())) || item.query || "Unclassified";
}

function hasTopicEvidence(item, text, config, topic) {
  if (item.platform !== "youtube") return true;
  const audience = (config.audiences || []).find((entry) => entry.id === item.audienceId);
  const terms = audience?.topicEvidenceKeywords?.[topic] || [];
  const lower = text.toLowerCase();
  return !terms.length || terms.some((term) => lower.includes(String(term).toLowerCase()));
}

export function heuristicAnalyze(item, config) {
  const text = item.platform === "youtube"
    ? String(item.text || "").trim()
    : `${item.title || ""}\n${item.text || ""}`.trim();
  const categories = matchedCategories(text);
  const guards = contentGuards(text);
  const hasConcretePain = categories.includes("need") || categories.includes("friction")
    || (categories.includes("workaround") && categories.includes("money"));
  const hasContext = /\b(?:i|we|my|our|store|shop|business|seller|merchant|customer|orders?|products?|images?|listing|catalog|sku|reviews?|returns?|inventory|shopify|etsy|ecommerce|xero|quickbooks)\b/i.test(text)
    || categories.includes("specificity");
  const expertReply = likelyExpertReply(item, text);
  const isRealProblem = categories.length >= 2 && hasConcretePain && hasContext
    && !item.authorIsCreator && !expertReply && !guards.likelyPromotion && !guards.lowInformation && !guards.suspiciousContactSpam;
  const frequency = /daily|every day/i.test(text) ? "daily"
    : /weekly|every week|twice a week|every friday|every monday/i.test(text) ? "weekly"
      : /monthly|every month/i.test(text) ? "monthly" : "unknown";
  const paymentSignal = categories.includes("money") ? "explicit" : "none";
  const topic = topicFor(item, config);
  const topicEvidence = hasTopicEvidence(item, text, config, topic);
  const acceptedProblem = isRealProblem && topicEvidence;
  const confidence = acceptedProblem ? Math.min(0.55 + categories.length * 0.08, 0.91) : Math.min(0.2 + categories.length * 0.08, 0.55);

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
    isRealProblem: acceptedProblem,
    userType: acceptedProblem ? item.audienceId : null,
    jobToBeDone: acceptedProblem ? topic : null,
    pain: acceptedProblem ? exactEvidence(text) : null,
    trigger: null,
    currentSolution: categories.includes("workaround") ? "A manual or workaround process is mentioned" : null,
    currentSolutionProblem: categories.includes("friction") ? "The current process costs time or causes errors" : null,
    frequency,
    paymentSignal,
    severity: severityFor(text, categories),
    evidenceQuote: acceptedProblem ? exactEvidence(text) : null,
    confidence: Number(confidence.toFixed(2)),
    rejectionReason: acceptedProblem ? null
      : isRealProblem && !topicEvidence ? "Comment does not mention the board task; topic exists only in video context"
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
  const topicEvidence = hasTopicEvidence(item, content, config, topic);
  const categories = matchedCategories(content);
  const guards = contentGuards(content);
  const expertReply = likelyExpertReply(item, content);
  const accepted = Boolean(result.isRealProblem) && topicEvidence && !item.authorIsCreator && !expertReply && !guards.likelyPromotion && !guards.lowInformation && !guards.suspiciousContactSpam;
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
    rejectionReason: accepted ? null : !topicEvidence ? "Comment does not mention the board task; topic exists only in video context" : item.authorIsCreator ? "Comment was written by the video publisher" : expertReply ? "Likely educational or vendor-authored reply, not a first-person problem" : result.rejectionReason || (guards.likelyPromotion ? "Likely promotional or vendor-authored content" : "Failed deterministic quality guard"),
    matchedCategories: categories,
    confidence: Math.max(0, Math.min(1, Number(result.confidence) || 0)),
    analyzer: "llm"
  };
}

const opportunityProfiles = [
  {
    match: /image|photo|background|watermark|resize|crop/,
    soloDifficulty: "medium",
    soloFitBreakdown: { buildTime: 21, dependencies: 17, compliance: 13, operations: 14, acquisition: 12, infrastructure: 9 },
    mvpHypothesis: "商品图批量体检器：上传图片或 ZIP，检查尺寸、比例、文件大小、透明背景和水印风险，输出修改清单；第一版不生成图片。",
    primaryRisk: "通用压缩和抠图工具竞争激烈，必须绑定一个平台规则和一个批处理场景。",
    buildConstraints: ["只做规则检查与批处理，不做通用 AI 生图", "先支持一个平台的一组图片规则", "文件本地处理或短时删除"]
  },
  {
    match: /listing|title|description|attribute|alt text|seo/,
    soloDifficulty: "low",
    soloFitBreakdown: { buildTime: 23, dependencies: 19, compliance: 14, operations: 14, acquisition: 13, infrastructure: 9 },
    mvpHypothesis: "商品 Listing 体检器：粘贴单条商品信息或上传 CSV，按明确规则指出缺失属性、标题冗余和描述结构问题；不承诺排名提升。",
    primaryRisk: "如果只输出通用 AI 文案，差异化和可信度都很弱；必须提供可解释的逐条规则。",
    buildConstraints: ["每条建议必须说明触发规则", "不承诺 SEO 或平台排名", "第一版不自动发布到店铺"]
  },
  {
    match: /catalog|csv|sku|variant|bulk edit|image url/,
    soloDifficulty: "low",
    soloFitBreakdown: { buildTime: 25, dependencies: 19, compliance: 15, operations: 15, acquisition: 13, infrastructure: 10 },
    mvpHypothesis: "商品 CSV 清洗器：上传一种平台导出的 CSV，检查重复 SKU、变体错位、空字段和失效图片 URL，下载修正建议；不写回店铺。",
    primaryRisk: "各平台字段差异大，第一版只能支持一种固定导出格式。",
    buildConstraints: ["只支持一种 CSV 模板", "只读检查，不自动写回", "不保存商家完整商品数据"]
  },
  {
    match: /review|return reason|refund reason|customer question|faq|complaint/,
    soloDifficulty: "medium",
    soloFitBreakdown: { buildTime: 22, dependencies: 18, compliance: 13, operations: 14, acquisition: 13, infrastructure: 9 },
    mvpHypothesis: "评论与退货原因归类器：上传评论或退货 CSV，聚类尺寸、颜色、质量和物流问题，输出问题占比与 FAQ 建议；不抓取平台、不自动回复。",
    primaryRisk: "样本可能包含个人信息，且不同品类的原因体系不同，必须限定输入字段和保留时间。",
    buildConstraints: ["仅处理用户主动上传的数据", "不做平台爬取和自动回复", "删除个人信息并限制数据保留时间"]
  }
];

const fallbackProfile = {
  soloDifficulty: "medium",
  soloFitBreakdown: { buildTime: 15, dependencies: 12, compliance: 10, operations: 10, acquisition: 8, infrastructure: 8 },
  mvpHypothesis: "用一次性 CSV 输入和异常清单输出验证该问题；先人工交付，不做账号体系和自动写回。",
  primaryRisk: "问题描述仍然过宽，容易做成通用工具。",
  buildConstraints: ["只读，不自动写回第三方系统", "只支持一种输入路径", "先用人工服务验证 5 位用户"]
};

function hardExclusionsFor(cluster) {
  const text = [cluster.topic, ...cluster.items.map((item) => item.evidenceQuote || item.pain || "")].join(" ");
  const rules = [
    [/real[- ]?time|two[- ]?way|bidirectional|sync inventory|inventory sync/i, "需要实时或双向库存同步"],
    [/auto(?:matic(?:ally)?)? (?:refund|payment|pricing)|dynamic pricing/i, "涉及自动退款、支付或定价"],
    [/accounting|bookkeep|tax filing|reconciliation/i, "进入会计、税务或对账责任"],
    [/scrap(?:e|ing)|crawl(?:er|ing)|mass download/i, "依赖大规模抓取"],
    [/ad automation|manage ads|auto publish|cross-platform publishing/i, "依赖广告自动化或跨平台发布"]
  ];
  return rules.filter(([pattern]) => pattern.test(text)).map(([, label]) => label);
}

export function buildOpportunityCard(cluster, config = {}) {
  const topic = cluster.topic.toLowerCase();
  const profile = opportunityProfiles.find((entry) => entry.match.test(topic)) || fallbackProfile;
  const soloFitScore = Object.values(profile.soloFitBreakdown).reduce((sum, value) => sum + value, 0);
  const hardExclusions = hardExclusionsFor(cluster);
  const fitMinimum = config.soloFitMinimum ?? 70;
  const candidate = !hardExclusions.length && soloFitScore >= fitMinimum && cluster.score >= 60 && cluster.uniqueAuthors >= 3
    && (cluster.explicitPayments > 0 || cluster.frequent >= 2 || cluster.workarounds >= 2);
  const validate = !hardExclusions.length && soloFitScore >= fitMinimum && cluster.score >= 40 && cluster.uniqueAuthors >= 2;
  const verdict = candidate ? "candidate" : validate ? "validate" : "watch";
  const missingEvidence = [];
  if (cluster.uniqueAuthors < 3) missingEvidence.push("至少 3 个独立用户");
  if (cluster.platforms.length < 2) missingEvidence.push("第二个平台的交叉证据");
  if (!cluster.explicitPayments) missingEvidence.push("明确价格或现有付费信号");
  if (!cluster.frequent) missingEvidence.push("发生频率");
  if (!cluster.recentSignals) missingEvidence.push(`最近 ${config.freshnessDays || 30} 天的新证据`);
  if (soloFitScore < fitMinimum) missingEvidence.push(`个人开发适配度至少 ${fitMinimum} 分`);
  if (hardExclusions.length) missingEvidence.push(`移除超出边界的需求：${hardExclusions.join("、")}`);

  return {
    verdict,
    soloDifficulty: profile.soloDifficulty,
    soloFitScore,
    soloFitBreakdown: profile.soloFitBreakdown,
    hardExclusions,
    mvpHypothesis: profile.mvpHypothesis,
    primaryRisk: profile.primaryRisk,
    buildConstraints: profile.buildConstraints,
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

export function clusterSignals(signalsList, config = {}) {
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
    const freshCutoff = Date.now() - (config.freshnessDays || 30) * 86_400_000;
    const recentSignals = items.filter((item) => new Date(item.publishedAt).getTime() >= freshCutoff).length;
    const freshnessRatio = recentSignals / items.length;
    const scoreBreakdown = {
      independentUsers: Math.min(authors.size * 10, 30),
      crossPlatform: Math.min(platforms.size * 5, 10),
      payment: Math.min(explicitPayments * 8, 15),
      workaround: Math.min(workarounds * 6, 15),
      frequency: Math.min(frequent * 6, 15),
      severity: Math.min(highSeverity * 5, 10),
      evidenceQuality: Math.round(averageConfidence * 3 + freshnessRatio * 2)
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
      recentSignals,
      score,
      scoreBreakdown,
      strength: authors.size >= 3 && platforms.size >= 2 ? "strong" : authors.size >= 2 ? "medium" : "weak",
      items: items.sort((a, b) => b.confidence - a.confidence)
    };
    return { ...cluster, opportunity: buildOpportunityCard(cluster, config) };
  }).sort((a, b) => b.score - a.score);
}
