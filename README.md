# Demand Radar（海外真实需求雷达）

面向个人开发者的轻量需求研究工具。当前只研究海外电商卖家的四类小工具需求：商品图合规与批处理、Listing 体检与优化、商品 CSV 清洗、评论与退货原因分析。它从 Shopify Community、Reddit 和 YouTube 收集近期公开讨论，输出带原文链接的可视化周报。

第一版故意不做网页、不使用数据库，也不自动生成产品点子。目标是先验证“这套采集方式能不能持续找到有价值的问题”。

## 1. 先运行演示

环境要求：Node.js 20 或更高版本。

```bash
npm run demo
```

执行后查看 `reports/当天日期.md`。演示数据包含 3 条相互印证的库存同步问题和 1 条应被拒绝的空泛讨论。

## 2. 配置自己的用户群

```bash
cp config.example.json config.json
cp .env.example .env
```

编辑 `config.json`：

- `audiences`：要研究的明确用户群，第一版建议不超过 3 个。
- `topics`：这些人正在完成的具体工作，不要写宽泛行业词。
- `requiredContextTerms`：视频必须出现的电商语境词，避免搜到泛图片、泛 AI 内容。
- `topicKeywords`：每个板块允许命中的具体任务词。
- `topicEvidenceKeywords`：YouTube 评论正文必须出现的任务词，防止借用视频标题制造假需求。
- `youtube.topicSearchQueries`：每个板块的短查询，建议写成“平台 + 具体故障”，不要写成长句。
- `painPhrases`：真实用户可能使用的英文痛点句式。
- `reddit.subreddits`：垂直社区，建议每个用户群 3～10 个。
- `days`：采样窗口，默认 90 天。
- `freshnessDays`：近期证据窗口，默认 30 天。
- `minScore`：进入报告的最低需求分（0～100，默认 15，让单用户弱信号可见但仍只观察）。
- `soloFitMinimum`：个人开发适配门槛，默认 70。
- `maxEvidencePerCluster`：每个问题最多展示多少条原始证据。

一个查询由 `topic × painPhrase` 组成。查询数会直接影响 Reddit 请求量，所以每个用户群建议从 3 个 topic、6～8 个 pain phrase 开始。

## 3. 配置数据源

### Shopify Community

默认启用，不需要 API Key。程序使用社区公开搜索接口，只检索最近 90 天的主题首帖，再读取发帖者的完整原文；不会把回复中的服务商推广当作用户需求。每个查询默认最多读取 8 个主题，并按主题 ID 去重。

相关配置位于 `audiences[].shopifyCommunity`。四个板块分别使用 3 条短查询，建议保持“具体对象 + 故障/任务”的形式。

### YouTube

在 Google Cloud 项目中启用 YouTube Data API v3，把 API Key 写入 `.env`：

```dotenv
YOUTUBE_API_KEY=your_key
```

程序会查找主题相关的视频，并只保留采样窗口内发布的顶层评论；报告同时单列最近 30 天的新证据。明显的赞美短句、联系方式垃圾内容和金融诈骗话术会在采集阶段先被剔除，评论关闭的视频会自动跳过。

### Reddit

创建获得许可的 Reddit OAuth 应用，把凭据写入 `.env`：

```dotenv
REDDIT_CLIENT_ID=your_client_id
REDDIT_CLIENT_SECRET=your_client_secret
REDDIT_USER_AGENT=demand-radar/0.1 by your-reddit-username
```

使用 Reddit 数据前请确认你的用途符合 Reddit Data API 条款。不要把抓取到的用户内容公开转售，也不要用于训练模型。原始内容只应短期保存，并保留原帖 URL 供人工核验。

## 4. 运行完整流程

先检查哪些数据源已经可以使用：

```bash
npm run doctor
```

再运行完整流程：

```bash
npm run run
```

也可以分步执行：

```bash
npm run collect
npm run analyze
npm run report
```

产生的文件：

- `data/raw.jsonl`：标准化后的原始帖子和评论。
- `data/signals.jsonl`：需求判断、证据和评分字段。
- `reports/YYYY-MM-DD.md`：按分数排序的需求报告。

报告里的机会卡分为：

- `watch`：证据太少，只观察。
- `validate`：已有至少 2 位独立用户，先访谈。
- `candidate`：证据较完整，可以做人工服务或极窄只读原型。

报告包含两套互不替代的分数：

- `需求强度`：独立用户、跨平台、付费、临时方案、频率、严重度和新鲜度。
- `个人开发适配`：开发周期、外部依赖、合规、运营负担、获客可达性和基础设施。

只有需求分至少 60、个人适配至少 70、至少 3 位独立用户，并且没有硬性排除项，才会显示为 🟢。实时或双向同步、自动退款/支付/定价、会计税务、大规模抓取、广告自动化和跨平台自动发布会被强制降为观察。

机会卡中的 MVP 是“待验证假设”，默认约束为只读、单一输入路径、先服务 5 位用户，不等于已经证明应该开发。

报告采用“先结论、再排名、最后看证据”的结构：顶部直接告诉你本周要不要行动，榜单使用 🟢/🟡/⚪ 状态、100 分需求强度和开发难度，原始证据默认折叠，需要时再展开。

重复运行时会按平台内容 ID 去重。

## 5. 可选接入大模型

默认使用保守的规则分析器，因此不需要模型 Key。它适合验证采集链路，但理解复杂语义的能力有限。

如需使用兼容 OpenAI Chat Completions 请求格式的服务，配置：

```dotenv
LLM_API_KEY=your_key
LLM_API_URL=https://your-provider.example/v1/chat/completions
LLM_MODEL=your-model
```

模型必须返回 `prompts/extract-demand.txt` 指定的 JSON。系统还会进行二次校验：如果模型给出的 `evidenceQuote` 不是原文的精确子串，该次结果会被丢弃并回退到规则分析器。这可以显著减少“AI 自己补充需求”的情况。

## 6. 推荐的日常节奏

- 每天：定时运行一次 `npm run run`。
- 每周：人工阅读排名前 10 的原帖，标记误报。
- 连续两周：只调整关键词和社区，不急着开发产品。
- 某个问题达到 3 个独立用户后：找 5～10 个用户访谈。
- 出现明确付费、现有替代方案和高频场景后：再做落地页或极窄 MVP。

仓库已经包含 `.github/workflows/weekly-demand-radar.yml`。推送到 GitHub 并把 API 凭据配置成 Actions Secrets 后，它会在每周一北京时间上午运行，并自动创建当天的 `需求雷达周报｜YYYY-MM-DD` GitHub Issue；同一天重复运行会更新原 Issue，不会重复创建。报告也会作为 Artifact 保存 30 天。

日常只需要打开仓库的 **Issues** 页面阅读周报。可以直接在周报下面留言：`需求 1：值得验证`、`需求 2：误报` 或 `下周继续观察库存问题`。

## 当前边界

- Shopify Community 只分析主题作者的首帖，不分析回复。
- Reddit 第一版只分析帖子正文，尚未展开抓取帖子评论。
- YouTube 第一版只分析顶层评论。
- 聚类依据配置中的 topic，而不是语义向量；因此 topic 必须足够具体。
- X 尚未接入。建议先连续运行 Reddit + YouTube 两周，确认信息质量，再决定是否承担 X 的接口成本。
- 当前报告是研究线索，不是市场规模证明，也不能代替用户访谈；两套 100 分制只用于筛选和同批比较。

## 测试

```bash
npm test
```
