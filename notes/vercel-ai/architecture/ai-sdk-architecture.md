# AI SDK 项目架构

本文是阅读本仓库源码时的架构地图：分层、目录职责、核心调用链、关键机制，以及推荐的阅读顺序。路径从项目目录名写起（`ai/...`），不写 `projects/`，也不相对该仓库根省略项目名。

## 1. 一句话总览

AI SDK 是一个 **适配器（adapter）架构** 的三层结构：面向用户的 AI 函数只依赖「模型规范接口」，各 provider 只实现这个接口，中间由共享工具库支撑。

```
AI 函数层   ai/packages/ai                  generateText / streamText / generateObject / useChat 服务端部分
    │  依赖（只依赖接口，不依赖具体 provider）
模型规范层   ai/packages/provider            LanguageModelV4、ImageModelV4、EmbeddingModelV4 ...
    │  被依赖
工具层      ai/packages/provider-utils       HTTP 调用、schema、provider options、重试、错误处理
    │  被依赖
实现层      ai/packages/<provider>           例如 ai/packages/openai：把 OpenAI API 映射成 LanguageModelV4
```

依赖方向严格单向：

```
ai ─────────────┬──▶ provider-utils ──▶ provider
@ai-sdk/<provider> ──▶ provider-utils ──▶ provider
```

`ai` 永远不 import 具体 provider 的包；它通过「模型对象」或「字符串 id + 全局 provider」拿到一个符合规范的实例（见 4.2）。唯一的编译期例外是 `@ai-sdk/gateway`（`ai/packages/ai/src/model/resolve-model.ts` 用它作为字符串模型的默认解析入口）。

## 2. 仓库布局

Monorepo：pnpm workspaces + Turborepo。workspace 划分见 `ai/pnpm-workspace.yaml`，文件里写的是 `apps/*`、`packages/*`、`tools/*`、`examples/*`。

| 目录               | 职责                                                                           |
| ------------------ | ------------------------------------------------------------------------------ |
| `ai/packages/`     | 所有发布到 npm 的包（`ai`、`@ai-sdk/*`）                                       |
| `ai/apps/docs`     | 文档站点（消费 `ai/content/`）                                                 |
| `ai/content/`      | 文档 Markdown/MDX 源文件（`docs/`、`providers/`、`cookbook/`）                 |
| `ai/examples/`     | 可运行示例（`ai-functions` 是按函数×provider 组织的示例集合）                  |
| `ai/tools/`        | 内部工程化：tsdown 配置、oxlint 插件、konsistent provider、verifiers、抓包工具 |
| `ai/architecture/` | **官方架构说明**（provider 抽象、stream-text 循环控制、harness、sandbox 等）   |
| `ai/contributing/` | 贡献指南与 ADR（`ai/contributing/decisions/`）                                 |

`ai/packages/` 内部按角色分组：

| 分组          | 包                                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| 核心          | `ai`                                                                                                       |
| 规范与工具    | `provider`、`provider-utils`、`test-server`                                                                |
| provider 实现 | `openai`、`anthropic`、`google`、`azure`、`amazon-bedrock`、`groq`…（数十个，含 `openai-compatible` 基座） |
| 框架集成      | `react`、`vue`、`svelte`、`angular`、`rsc`                                                                 |
| Agent harness | `harness`、`harness-*`（claude-code、codex、cursor、opencode、pi…）                                        |
| 工具与运行时  | `mcp`、`code-mode`、`otel`、`devtools`、`policy-opa`、`sandbox-*`、`tool-bash`、`tool-web-fetch`、`tui`    |
| 生态适配      | `langchain`、`llamaindex`、`gateway`                                                                       |
| 迁移          | `codemod`                                                                                                  |

## 3. 分层详解

### 3.1 模型规范层：`ai/packages/provider`

按模型能力拆目录，每个目录里是「接口 + 类型 + 版本适配」：

```
ai/packages/provider/src/
├── language-model/{v2,v3,v4}/   语言模型（文本、工具调用、推理）
├── embedding-model/             向量
├── image-model/                 图像生成
├── speech-model/                语音合成
├── transcription-model/         转写
├── speech-translation-model/    语音翻译
├── video-model/                 视频生成
├── reranking-model/             重排
├── decision-model/              实验性分类/决策
├── extraction-model/            实验性抽取
├── batch/                       批处理
├── files/                       文件上传
├── skills/                      技能定义
├── *-middleware/                各模型类型的中间件接口
├── provider/                    ProviderV4（languageModel() / imageModel() …）
├── model-capabilities.ts        模型能力元数据契约
├── errors/                      ProviderError、APICallError、NoSuchModelError…
└── shared/                      共享基础类型
```

`LanguageModelV4`（`ai/packages/provider/src/language-model/v4/language-model-v4.ts`）是最重要的接口，只有四个属性 + 两个方法：

```ts
readonly specificationVersion: 'v4';
readonly provider: string;
readonly modelId: string;
readonly supportedUrls: Record<string, RegExp[]> | PromiseLike<...>;
doGenerate(options): Promise<LanguageModelV4GenerateResult>;
doStream(options): Promise<LanguageModelV4StreamResult>;
```

**关键设计**：provider 实现不需要知道 `generateText` 的存在，只需要把自家 API 的请求/响应/流翻译成这些类型。这也是为什么新增一个 provider 通常只有 1~2 个类 + 若干转换函数。

### 3.2 共享工具层：`ai/packages/provider-utils`

provider 作者实际会用到的东西都在这（`ai/packages/provider-utils/src/` 下约 170 个非测试 `.ts` 文件，另有 `to-json-schema/`、`types/`、`test/` 等子目录），按用途归类：

| 用途       | 文件                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------- |
| HTTP 调用  | `post-to-api.ts`、`get-from-api.ts`、`post-multipart-stream-to-api.ts`、`response-handler.ts`                  |
| 安全       | `read-response-with-size-limit.ts`、`sanitize-request-headers.ts`、`secure-json-parse.ts`、`is-same-origin.ts` |
| Schema     | `schema.ts`（`asSchema`、`jsonSchema`、`zodSchema`、校验）                                                     |
| 配置解析   | `parse-provider-options.ts`、`load-api-key.ts`、`load-setting.ts`                                              |
| 流解析     | `parse-json-event-stream.ts`、`convert-async-iterator-to-readable-stream.ts`、`eventsource-parser`             |
| 重试与错误 | `retry-with-exponential-backoff.ts`、`handle-fetch-error.ts`、`is-abort-error.ts`                              |
| 结构化输出 | `inject-json-instruction.ts`、`to-json-schema/`                                                                |
| 工具       | `provider-defined-tool-factory.ts`、`provider-executed-tool-factory.ts`、`create-tool-name-mapping.ts`         |

### 3.3 AI 函数层：`ai/packages/ai`

`ai/packages/ai/src` 按「一个 AI 函数一个目录」组织，几乎每个目录都包含：函数实现、类型、结果对象、以及大量 `.test.ts`。

```
ai/packages/ai/src/
├── generate-text/      generateText、streamText、ToolLoopAgent 的公共机制（工具循环、中间件调用、审批）
├── generate-object/    generateObject、streamObject
├── generate-image/     generateImage
├── generate-speech/    generateSpeech
├── generate-video/     generateVideo
├── transcribe/         转写
├── embed/              embed、embedMany
├── rerank/             重排
├── extract/ decide/    实验性函数
├── agent/              ToolLoopAgent、Agent 抽象
├── model/              resolve-model.ts + as-*-v4.ts 版本适配
├── middleware/         wrapLanguageModel 等内置中间件
├── registry/           provider registry / customProvider
├── prompt/             system、message、tool、file part 的归一化
├── text-stream/        把 TextStream 转成 Response
├── ui-message-stream/  UIMessageChunk 协议（SSE 传输层）
├── types/              公开类型
├── telemetry/          telemetry dispatcher、tracing channel
├── tool-search/        工具检索
├── batch/ upload-file/ upload-skill/ realtime/
└── util/ error/ logger/
```

## 4. 核心机制

### 4.1 版本兼容：v2 / v3 / v4 并存

规范有多个版本，接口目录 `language-model/v2|v3|v4` 同时存在。运行时在 `ai/packages/ai/src/model/resolve-model.ts` 里做适配：

- 传入 `string` → 交给全局 provider（默认 `@ai-sdk/gateway`）解析
- 传入模型对象 → 校验 `specificationVersion` 属于 `v2 | v3 | v4`，否则抛 `UnsupportedModelVersionError`
- `v3/v2` → 用 `as-language-model-v4.ts` 包一层，把旧版参数/流片段翻译成 v4

**读码提示**：`ai/packages/ai/src/model/as-*-v4.ts` 是理解「规范如何演进」的最佳材料，它们明确列出每一版之间的字段增删。

### 4.2 模型解析与注册表

- `resolveLanguageModel(model)`：`string | LanguageModel | Provider` → `LanguageModelV4`
- 中间件返回的对象本身就是 `specificationVersion: 'v4'`（`ai/packages/ai/src/middleware/wrap-language-model.ts:75`），所以「包装过的模型」和「真实模型」在 core 看来没有区别
- `ai/packages/ai/src/registry/`：`createProviderRegistry()`、`customProvider()` 提供按 `provider:model` 字符串查表的能力

### 4.3 `generateText` 调用链（一次请求的完整生命周期）

入口 `ai/packages/ai/src/generate-text/generate-text.ts`（约 1900 行），主线如下：

1. **解析与准备**（~665 行起）：`resolveLanguageModel(model)` → 归一化 prompt/instructions/tools/`stopWhen`（默认 `isStepCount(1)`，见 294 行）
2. **step 循环**：每轮先跑 `prepareStep`，它可以覆盖本轮的 `model`、`instructions/system`、`messages`、`tools`、`activeTools`、`toolChoice`、`providerOptions`、`runtimeContext`、`sandbox`（见 1048~1163 行）
3. **调用模型**：`stepModel.doGenerate({...})`（1220 行）→ 返回 content parts、usage、finishReason、warnings
4. **解析内容**：`convert-language-model-content.ts` 转成 core 的 content 类型；工具调用走 `parse-tool-call.ts`（含参数校验与 repair）
5. **执行工具**：`execute-tools-from-stream.ts` / `execute-tool-call.ts`，配合审批（`collect-tool-approvals.ts`、`resolve-tool-approval.ts`）、并发控制（`tool-call-concurrency.ts`）、执行顺序（`tool-order.ts`）
6. **收尾**：`steps.push(currentStepResult)`（1704 行）→ 交给 `stopWhen` 判定（`isStepCount` / `hasToolCall` / `isLoopFinished`，见 `stop-condition.ts`）
7. **组装结果**：`default-generate-text-result.ts` 汇总 `text`、`toolCalls`、`steps`、`usage`、`sources`、`files` 等

`streamText` 是同一套循环的流式版本（`ai/packages/ai/src/generate-text/stream-text.ts`，约 4000 行）：

- 单步调用抽到了 `stream-language-model-call.ts`（367 行 `resolvedModel.doStream(...)`）
- 把 `LanguageModelV4StreamPart` 实时翻译为 `TextStreamPart` 推入 `fullStream`
- 返回的结果对象 **同时是 `PromiseLike` 和 `AsyncIterable`**：`await result` 拿最终聚合值，`for await` 拿增量片段；另有 `consumeStream()`、`toUIMessageStreamResponse()`、`toTextStreamResponse()`（见 `stream-text-result.ts`）

逐站、带行号的走位见 [`../core/stream-text-walkthrough.md`](../core/stream-text-walkthrough.md)。

### 4.4 中间件

接口定义在 `ai/packages/provider/src/language-model-middleware/v4/`：

```ts
type LanguageModelV4Middleware = {
  specificationVersion: 'v4';
  overrideProvider?/overrideModelId?/overrideSupportedUrls?;
  transformParams?;            // 改请求参数
  wrapGenerate?({ doGenerate }); // 包住非流式调用
  wrapStream?({ doStream });     // 包住流式调用
};
```

`wrapLanguageModel` 把若干中间件折叠成一个新的 v4 模型。内置实现都在 `ai/packages/ai/src/middleware/`：

| 文件                                                                                              | 作用                                                                  |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `default-settings-middleware.ts`                                                                  | 给调用方未指定的参数填默认值（`temperature`、`maxTokens` 等）         |
| `default-instructions-middleware.ts`                                                              | 调用方没给 system/instructions 时补上默认值                           |
| `extract-reasoning-middleware.ts`                                                                 | 从 `text` 里剥出 `<reasoning>` 标签转成 reasoning part                |
| `extract-json-middleware.ts`                                                                      | 剥掉 Markdown 代码围栏（` ```json `）取出纯 JSON                      |
| `simulate-streaming-middleware.ts`                                                                | 用 `doGenerate` 的结果拼出 `*-start`/`*-delta`/`*-end` 序列，伪装成流 |
| `add-tool-input-examples-middleware.ts`                                                           | 把工具的 `inputExamples` 写进 schema 的 description，提升参数准确度   |
| `default-embedding-settings-middleware.ts`                                                        | embedding 版本的默认参数填充                                          |
| `wrap-language-model.ts` / `wrap-embedding-model.ts` / `wrap-image-model.ts` / `wrap-provider.ts` | 把多个中间件折叠成一个新模型 / 新 provider                            |

**注意**：核心函数不会自动套中间件——中间件是用户通过 `wrapLanguageModel({ model, middleware })` 显式组装进模型对象的。

### 4.5 工具、审批与 agent

- `tool()` 定义在 `ai/packages/provider-utils/src/types/tool.ts`，只是把 schema + execute 包成 `Tool`，由 `ai` 再导出；真正的调用发生在 core 的工具循环里
- 工具审批：模型可以返回 `tool-approval-request`，core 通过 `validate-tool-approvals.ts`、`collect-tool-approvals.ts` 把关，未获批准的执行变成 `tool-output-denied`
- `ToolLoopAgent`（`ai/packages/ai/src/agent/tool-loop-agent.ts`，约 360 行）把 `generateText/streamText` 的设置固化成类，暴露 `generate()` / `stream()`；它**不是**新引擎，只是同一循环的面向对象封装

### 4.6 三层流

这是最容易混淆的地方，实际有三层数据结构：

| 层                 | 类型                        | 位置                                                        | 用途                                           |
| ------------------ | --------------------------- | ----------------------------------------------------------- | ---------------------------------------------- |
| 1. provider → core | `LanguageModelV4StreamPart` | `ai/packages/provider/src/language-model/v4/`               | `text-delta`、`tool-call`、`finish` 等底层片段 |
| 2. core 内部/公开  | `TextStreamPart`            | `ai/packages/ai/src/generate-text/stream-text-result.ts`    | 加上 step 边界、工具执行、审批等语义           |
| 3. 网络协议        | `UIMessageChunk`            | `ai/packages/ai/src/ui-message-stream/ui-message-chunks.ts` | 以 SSE 发给浏览器，供 `useChat` 消费           |

第 3 层的链路：`to-ui-message-stream.ts` → `pipe-ui-message-stream-to-response.ts` → `create-sse-stream-with-keep-alive.ts`；客户端方向是 `read-ui-message-stream.ts` → `parse-json-event-stream.ts`。框架包（`ai/packages/react` 等）只依赖这层协议，因此新增框架只需要实现「解析 chunk + 维护消息状态」。

### 4.7 结构化输出

`generateObject` / `streamObject`（`ai/packages/ai/src/generate-object/`）复用语言模型，但多了：

- schema 归一化：`ai/packages/provider-utils/src/schema.ts`（`asSchema` 同时支持 JSON Schema 与 Zod）
- 请求侧统一发 `responseFormat: { type: 'json', schema }`（`generate-object.ts:412`），由 provider 映射成自家的原生结构化输出；provider 若不支持，需要自己用 `provider-utils/src/inject-json-instruction.ts` 之类的辅助把 schema 塞进提示词
- 响应的解析与校验在 core 完成：`output-strategy.ts` 调 `safeValidateTypes`，失败可走重试与 `repairText`
- 解析一律用 `parseJSON` / `safeParseJSON`，生产代码禁止直接 `JSON.parse`；流式场景另有 `extractJsonMiddleware`

### 4.8 provider 实现的固定套路（以 `ai/packages/openai` 为例）

几乎每个 provider 都是这几步：

1. `ProviderV4` 子类暴露 `languageModel()` / `imageModel()` …，构造时校验 `loadApiKey()`、`baseURL`
2. 模型类实现 `LanguageModelV4`：`doGenerate` / `doStream`
3. `postToApi()` / `getFromApi()` 发请求（本仓库强制显式传 `validateUrl`，见 `ai/contributing/secure-url-handling.md`）
4. 用 zod 解析响应（响应 schema 一律 `.nullish()`，只取需要的字段）
5. `convert-to-openai-*-messages.ts` 之类的函数做双向映射
6. 失败时抛 `APICallError`（含 `url`、`requestBodyValues`、`statusCode`、`isRetryable`）
7. `supportedUrls` 声明哪些 URL 可以直接透传而不下载

共享能力（模型能力元数据）由 `ai/packages/provider/src/model-capabilities.ts` + `ai/architecture/model-capabilities.md` 定义，用于运行时行为与文档生成。

### 4.9 harness 与 sandbox（较新的两条支线）

- **harness**：`ai/packages/harness*` 把 coding agent 运行时（Claude Code、Codex、Cursor…）适配成 `HarnessV1`，与 `LanguageModelV4` 是平行的抽象。见 `ai/architecture/harness-abstraction.md`
- **sandbox**：文件/命令执行环境抽象，作为 harness 规范的一部分（`HarnessV1NetworkSandboxSession`），实现包为 `ai/packages/sandbox-vercel`、`ai/packages/sandbox-just-bash`。见 `ai/architecture/sandbox-abstraction.md`

## 5. 概念对照表

| 用户看到的 API        | 内部规范                      | 主要文件                                                          |
| --------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `generateText`        | `LanguageModelV4.doGenerate`  | `ai/packages/ai/src/generate-text/generate-text.ts`               |
| `streamText`          | `LanguageModelV4.doStream`    | `ai/packages/ai/src/generate-text/stream-text.ts`                 |
| `generateObject`      | `LanguageModelV4` + schema    | `ai/packages/ai/src/generate-object/generate-object.ts`           |
| `embed` / `embedMany` | `EmbeddingModelV4`            | `ai/packages/ai/src/embed/`                                       |
| `generateImage`       | `ImageModelV4`                | `ai/packages/ai/src/generate-image/`                              |
| `generateSpeech`      | `SpeechModelV4`               | `ai/packages/ai/src/generate-speech/`                             |
| `transcribe`          | `TranscriptionModelV4`        | `ai/packages/ai/src/transcribe/`                                  |
| `rerank`              | `RerankingModelV4`            | `ai/packages/ai/src/rerank/`                                      |
| `tool()`              | `LanguageModelV4FunctionTool` | `ai/packages/provider-utils/src/types/tool.ts`（`ai` 再导出）     |
| `useChat`（客户端）   | `UIMessageChunk`              | `ai/packages/react/src/`、`ai/packages/ai/src/ui-message-stream/` |
| `ToolLoopAgent`       | `generateText` / `streamText` | `ai/packages/ai/src/agent/tool-loop-agent.ts`                     |

## 6. 推荐阅读顺序

1. `ai/architecture/provider-abstraction.md`（1 页看懂三层怎么咬合）
2. `ai/packages/provider/src/language-model/v4/language-model-v4.ts` 及同目录类型：先建立「模型能返回什么」的心智模型
3. `ai/packages/ai/src/model/resolve-model.ts` + `as-language-model-v4.ts`：搞清版本适配
4. `ai/packages/ai/src/generate-text/generate-text.ts`：先读 249~700 的签名与 setup，再读 1040~1260 的 step 循环，最后读结果组装
5. `ai/packages/ai/src/generate-text/stream-text.ts` + `stream-language-model-call.ts`：对比非流式版本的差异
6. `ai/packages/provider-utils/src/post-to-api.ts`、`schema.ts`、`parse-provider-options.ts`：provider 作者视角
7. 拿一个小 provider（`openai-compatible` 最简单）逐行对照上面的套路
8. `ai/packages/ai/src/ui-message-stream/` + `ai/packages/react/src/`：跨网络协议与客户端状态机
9. 需要时再进 `harness`、`sandbox`、`telemetry` 支线

## 7. 影响读码的工程约定

- **konsistent**（`.github/konsistent.json`）强制包目录结构：`package.json`、`CHANGELOG.md`、`src/index.ts`、`tsdown.config.ts`
- **verifiers / guidelines**（`.agents/guidelines`、`.agents/verifiers`）把编码规范变成可执行检查：如 `getFromApi` 必须显式 `validateUrl`、依赖里 zod 必须是 4
- **测试**：Vitest；provider 测试用 `@ai-sdk/test-server` + `__fixtures__` 录制真实响应，`*.test-d.ts` 做类型测试
- **构建**：tsdown 产出，Turborepo 编排；`pnpm build:packages` 只构建发布包
- **变更**：生产代码改动必须带 changeset，默认 `patch`

## 8. 待深入的问题

已确认的结论写进本文对应小节；尚未查清的 4 条（`stopWhen` 与 `prepareStep` 的边界、重试与工具去重、v3→v4 的损失性适配、UI 流断线重连一致性）连同验证方式记录在 [`questions.md`](./questions.md)。
