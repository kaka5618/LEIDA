import test from "node:test";
import assert from "node:assert/strict";
import { normalizeShopifyTopic } from "../src/collectors.mjs";

test("normalizes only the Shopify Community topic author post", () => {
  const row = normalizeShopifyTopic({
    id: 645056,
    slug: "csv-import-issue",
    title: "CSV Import &amp; Image Issue",
    posts_count: 4,
    category_name: "Technical Q&A",
    post_stream: {
      posts: [
        {
          post_number: 1,
          username: "merchant-one",
          created_at: "2026-07-02T16:35:50Z",
          cooked: "<p>Our CSV import <strong>failed</strong>.</p><p>Can anyone suggest a workaround?</p>",
          actions_summary: [{ id: 2, count: 2 }]
        },
        { post_number: 2, username: "app-vendor", cooked: "Install our app." }
      ]
    }
  }, "product catalog and CSV cleanup", "CSV import");

  assert.equal(row.platform, "shopify-community");
  assert.equal(row.title, "CSV Import & Image Issue");
  assert.match(row.text, /Our CSV import failed/);
  assert.doesNotMatch(row.text, /Install our app/);
  assert.equal(row.engagement.comments, 3);
  assert.equal(row.engagement.likes, 2);
  assert.equal(row.sourceUrl, "https://community.shopify.com/t/csv-import-issue/645056");
});
