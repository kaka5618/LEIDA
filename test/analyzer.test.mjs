import test from "node:test";
import assert from "node:assert/strict";
import { clusterSignals, heuristicAnalyze } from "../src/analyzer.mjs";

const config = {
  audiences: [{ id: "merchants", topics: ["inventory sync"] }]
};

function item(id, text, platform = "reddit", authorHash = id) {
  return {
    id,
    platform,
    audienceId: "merchants",
    query: "inventory sync",
    title: "Inventory sync",
    text,
    authorHash,
    sourceUrl: `https://example.com/${id}`,
    publishedAt: new Date().toISOString(),
    engagement: { likes: 0, comments: 0 }
  };
}

test("accepts a concrete repeated manual problem", () => {
  const result = heuristicAnalyze(item("1", "I manually export a CSV every week and it takes two hours. Is there a tool that costs less than $50?"), config);
  assert.equal(result.isRealProblem, true);
  assert.equal(result.frequency, "weekly");
  assert.equal(result.paymentSignal, "explicit");
  assert.ok(result.evidenceQuote);
});

test("rejects vague trend discussion even with engagement", () => {
  const result = heuristicAnalyze(item("2", "I think ecommerce is the future and Shopify is cool. What does everyone think about this trend?"), config);
  assert.equal(result.isRealProblem, false);
});

test("accepts a recurring workaround when existing tools are too expensive", () => {
  const result = heuristicAnalyze(item("4", "We still use Google Sheets to reconcile stock twice a week. Existing inventory platforms are too expensive for our tiny store. What do other shops use?"), config);
  assert.equal(result.isRealProblem, true);
  assert.equal(result.frequency, "weekly");
  assert.equal(result.paymentSignal, "explicit");
});

test("accepts a domain-specific integration failure", () => {
  const result = heuristicAnalyze(item("5", "The Shopify product has inventory but mismatching data feeds show it as sold out when it should be available."), config);
  assert.equal(result.isRealProblem, true);
});

test("accepts a confusing integration question", () => {
  const result = heuristicAnalyze(item("6", "The Xero subscription model is really confusing. Does it work without the Shopify plugin? Can you clarify how to connect it?"), config);
  assert.equal(result.isRealProblem, true);
});

test("rejects vendor self-promotion framed as pain", () => {
  const result = heuristicAnalyze(item("7", "Inventory was my real pain for years, so I built StockSmart to solve this problem. This powerful tool helps your business avoid stockouts."), config);
  assert.equal(result.isRealProblem, false);
  assert.match(result.rejectionReason, /promotional/);
});

test("rejects contact spam even when it mentions a problem", () => {
  const result = heuristicAnalyze(item("8", "I had an inventory problem every day. Contact him on WhatsApp for guaranteed profit and recovery."), config);
  assert.equal(result.isRealProblem, false);
  assert.match(result.rejectionReason, /spam/);
});

test("does not treat a YouTube video title as comment evidence", () => {
  const youtubeItem = item("9", "Thanks, this was a useful explanation with several good examples.", "youtube");
  youtubeItem.title = "Comment on: Shopify inventory sync problem and manual spreadsheet workaround";
  const result = heuristicAnalyze(youtubeItem, config);
  assert.equal(result.isRealProblem, false);
  assert.equal(result.evidenceQuote, null);
});

test("rejects comments written by the YouTube publisher", () => {
  const youtubeItem = item("10", "We reconcile Shopify payouts every month and the clearing account keeps breaking, so we use QuickBooks manually.", "youtube");
  youtubeItem.authorIsCreator = true;
  const result = heuristicAnalyze(youtubeItem, config);
  assert.equal(result.isRealProblem, false);
  assert.match(result.rejectionReason, /video publisher/);
});

test("rejects long educational replies posing as demand", () => {
  const youtubeItem = item("11", "The clearing account is where most setups quietly break. Orders post as revenue, but payouts land later minus fees, so the balance should swing and return to zero. When it does not, a fee category is usually missing because the integration moved data but did not reconcile it. What is hiding in the balance?", "youtube");
  const result = heuristicAnalyze(youtubeItem, config);
  assert.equal(result.isRealProblem, false);
  assert.match(result.rejectionReason, /educational/);
});

test("cluster score rewards independent authors and platforms", () => {
  const signals = [
    heuristicAnalyze(item("1", "I manually export a CSV every week and it takes two hours. Is there a tool under $50?", "reddit", "a"), config),
    heuristicAnalyze(item("2", "How do you handle this manual process? We use a spreadsheet every week and it is too expensive.", "youtube", "b"), config),
    heuristicAnalyze(item("3", "I manually copy inventory every Friday. It keeps making mistakes and costs $100 a month.", "reddit", "c"), config)
  ];
  const [cluster] = clusterSignals(signals);
  assert.equal(cluster.uniqueAuthors, 3);
  assert.deepEqual(cluster.platforms.sort(), ["reddit", "youtube"]);
  assert.equal(cluster.strength, "strong");
  assert.ok(cluster.score >= 25 && cluster.score <= 100);
  assert.equal(cluster.opportunity.verdict, "candidate");
  assert.equal(cluster.opportunity.soloDifficulty, "high");
  assert.match(cluster.opportunity.mvpHypothesis, /只读库存差异检查器/);
});
