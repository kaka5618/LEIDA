import { authorHash, daysAgoIso, queryBank, sleep, stableId } from "./lib.mjs";

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function redditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const result = await fetchJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": process.env.REDDIT_USER_AGENT || "demand-radar/0.1"
    },
    body
  });
  return result.access_token;
}

export async function collectReddit(config, onProgress = () => {}) {
  const token = await redditToken();
  if (!token) {
    onProgress("跳过 Reddit：没有 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET");
    return [];
  }

  const rows = [];
  const headers = {
    authorization: `Bearer ${token}`,
    "user-agent": process.env.REDDIT_USER_AGENT || "demand-radar/0.1"
  };

  for (const audience of config.audiences || []) {
    const subreddits = audience.reddit?.subreddits || [];
    for (const subreddit of subreddits) {
      for (const query of queryBank(audience)) {
        const params = new URLSearchParams({
          q: query,
          restrict_sr: "1",
          sort: "new",
          t: config.days <= 7 ? "week" : config.days <= 31 ? "month" : "year",
          limit: String(config.maxItemsPerQuery || 25),
          raw_json: "1"
        });
        const url = `https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/search?${params}`;
        const payload = await fetchJson(url, { headers });
        for (const child of payload.data?.children || []) {
          const post = child.data;
          rows.push({
            id: `reddit-${post.id}`,
            platform: "reddit",
            audienceId: audience.id,
            topic: audience.topics?.find((topic) => query.includes(topic)) || "Unclassified",
            query,
            community: `r/${post.subreddit}`,
            publishedAt: new Date(post.created_utc * 1000).toISOString(),
            sourceUrl: `https://www.reddit.com${post.permalink}`,
            title: post.title || "",
            text: [post.title, post.selftext].filter(Boolean).join("\n\n"),
            authorHash: authorHash(post.author),
            engagement: { likes: post.score || 0, comments: post.num_comments || 0 }
          });
        }
        onProgress(`Reddit r/${subreddit}: ${query}`);
        await sleep(150);
      }
    }
  }
  return rows;
}

export async function collectYouTube(config, onProgress = () => {}) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    onProgress("跳过 YouTube：没有 YOUTUBE_API_KEY");
    return [];
  }
  const rows = [];
  const seenVideoIds = new Set();
  let skippedNoise = 0;
  const cutoff = new Date(daysAgoIso(config.days || 30)).getTime();
  const containsAny = (text, terms = []) => terms.some((term) => text.includes(String(term).toLowerCase()));
  for (const audience of config.audiences || []) {
    if (audience.youtube?.enabled === false) continue;
    for (const topic of audience.topics || []) {
      const explicitQueries = audience.youtube?.topicSearchQueries?.[topic];
      const queries = explicitQueries || (audience.youtube?.searchModifiers || [""]).map((modifier) => [topic, modifier].filter(Boolean).join(" "));
      for (const query of queries) {
      const search = new URLSearchParams({
        key,
        part: "snippet",
        type: "video",
        order: "relevance",
        q: query,
        maxResults: String(Math.min(audience.youtube?.maxVideosPerQuery || 10, 50)),
        relevanceLanguage: config.language || "en",
        regionCode: config.region || "US",
        videoDuration: "medium"
      });
      const videos = await fetchJson(`https://www.googleapis.com/youtube/v3/search?${search}`);
      for (const video of videos.items || []) {
        const videoId = video.id?.videoId;
        if (!videoId || seenVideoIds.has(videoId)) continue;
        const videoContext = `${video.snippet?.title || ""} ${video.snippet?.description || ""}`;
        const normalizedContext = videoContext.toLowerCase();
        const contextTerms = audience.requiredContextTerms || ["shopify", "etsy", "ecommerce", "online store"];
        const topicTerms = audience.topicKeywords?.[topic] || [topic];
        const relevant = containsAny(normalizedContext, contextTerms) && containsAny(normalizedContext, topicTerms);
        if (!relevant) continue;
        seenVideoIds.add(videoId);
        const comments = new URLSearchParams({
          key,
          part: "snippet",
          videoId,
          order: "time",
          textFormat: "plainText",
          maxResults: "50"
        });
        try {
          const threads = await fetchJson(`https://www.googleapis.com/youtube/v3/commentThreads?${comments}`);
          for (const item of threads.items || []) {
            const comment = item.snippet?.topLevelComment?.snippet;
            if (!comment) continue;
            if (new Date(comment.publishedAt).getTime() < cutoff) continue;
            const commentText = (comment.textDisplay || "").replace(/\s+/g, " ").trim();
            const normalizedAuthor = String(comment.authorDisplayName || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "");
            const normalizedChannel = String(video.snippet?.channelTitle || "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9]+/g, "");
            const obviousNoise = commentText.length < 20
              || /^(?:great|nice|awesome|amazing|helpful) (?:video|content|tutorial)[.! ]*(?:thanks?)?[.! ]*$/i.test(commentText)
              || /(?:whats?app|telegram|guaranteed profit|contact (?:him|her|me)|crypto recovery)/i.test(commentText);
            if (obviousNoise) {
              skippedNoise += 1;
              continue;
            }
            rows.push({
              id: `youtube-${item.id}`,
              platform: "youtube",
              audienceId: audience.id,
              topic,
              query,
              community: video.snippet?.channelTitle || "YouTube",
              publishedAt: comment.publishedAt,
              sourceUrl: `https://www.youtube.com/watch?v=${videoId}&lc=${item.id}`,
              title: `Comment on: ${video.snippet?.title || topic}`,
              text: commentText,
              videoId,
              videoTitle: video.snippet?.title || topic,
              channelTitle: video.snippet?.channelTitle || "YouTube",
              authorIsCreator: Boolean((comment.authorChannelId?.value && video.snippet?.channelId
                && comment.authorChannelId.value === video.snippet.channelId)
                || (normalizedAuthor && normalizedChannel && normalizedAuthor === normalizedChannel)),
              authorHash: authorHash(comment.authorChannelId?.value || comment.authorDisplayName),
              engagement: { likes: comment.likeCount || 0, comments: item.snippet?.totalReplyCount || 0 }
            });
          }
        } catch (error) {
          if (!String(error).includes("commentsDisabled")) throw error;
        }
      }
      onProgress(`YouTube: ${query}`);
      await sleep(150);
      }
    }
  }
  onProgress(`YouTube 去噪：跳过 ${skippedNoise} 条明显低信息或垃圾评论，保留 ${rows.length} 条候选评论`);
  return rows;
}

export function normalizeImported(item, audienceId = "imported") {
  const text = item.text || item.body || item.content || "";
  return {
    id: item.id || `imported-${stableId(item.sourceUrl || item.url || "", text)}`,
    platform: item.platform || "imported",
    audienceId: item.audienceId || audienceId,
    topic: item.topic,
    query: item.query || "manual import",
    community: item.community || "",
    publishedAt: item.publishedAt || new Date().toISOString(),
    sourceUrl: item.sourceUrl || item.url || "",
    title: item.title || "",
    text,
    authorHash: item.authorHash || authorHash(item.author),
    engagement: item.engagement || { likes: 0, comments: 0 }
  };
}
