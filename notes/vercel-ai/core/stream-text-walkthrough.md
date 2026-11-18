# `streamText` 调用链逐站拆解

本文只追一条链路：**`streamText()` 入参 → 发出去的 HTTP 请求体字节 → 流式 part 回到 `fullStream` → 下一步/停止**。

与 [`../architecture/ai-sdk-architecture.md`](../architecture/ai-sdk-architecture.md) 的分工：那篇是「静态地图」（谁在哪、有哪些机制），这篇是「动态走位」（一次调用按什么顺序穿过哪些文件、哪些行）。行号会随源码演进漂移，失效时按函数名搜索。

> 路径从项目目录名写起（`ai/...`）。

## 0. 全局速览

```
调用方
  │ streamText({ model, messages, tools, stopWhen })
  ▼
ai/packages/ai/src/generate-text/stream-text.ts          streamText → streamTextInternal
  │  standardizePrompt / convertToLanguageModelPrompt / prepareTools
  ▼
ai/packages/ai/src/generate-text/stream-language-model-call.ts
  │  resolvedModel.doStream({...})                    ← 唯一收敛点
  ▼
ai/packages/<provider>/.../xxx-language-model.ts          doStream：构 body、发请求、翻译 chunk
  │  postJsonToApi
  ▼
ai/packages/provider-utils/src/post-to-api.ts             fetch()
  │  SSE → createEventSourceResponseHandler → ParseResult<chunk>
  ▲
  │ provider TransformStream → LanguageModelV4StreamPart
  │ ai 侧 TransformStream  → LanguageModelStreamPart
  │ stream-text.ts 主读循环 → TextStreamPart（fullStream）
  │ stopWhen 判定 → 继续下一步 / 结束
```

---

## 1. 入口与分流

`ai/packages/ai/src/generate-text/stream-text.ts`

| 行   | 内容                                                                |
| ---- | ------------------------------------------------------------------- |
| 388  | `streamText()` 公开签名                                             |
| 402  | `streamTextLowMemory()`：不保留 step 状态的变体，先跳过             |
| 442  | `startStreamText()`：分流两个实现                                   |
| 463  | `streamTextInternal()`：真正的主体，后面每一站都还在这函数里        |
| 958  | `model: resolveLanguageModel(model)`                                |
| 994  | `stopConditions: asArray(stopWhen)`                                 |
| 2201 | `prepareRetries()` 取 `maxRetries`                                  |
| 3552 | `retention.replay` 时自动 `consumeStream()`（结果被消费过才可重放） |

两个和 `generateText` 不同的地方：

- `482` 行已经把 `stopWhen` 默认值定为 `isStepCount(1)`，`421` 行校验用户传的值，所以**大量错误在 `streamText()` 返回前就同步抛出**，不会等到 `await`。
- `resolveLanguageModel` 在 958 行就做了，早于建流。字符串模型名的解析结果在这一刻就固定，后面 `prepareStep` 换模型是另一次解析（`2620`）。

## 2. 输入归一化（你的 `messages` 变成什么）

| 位置                                                               | 作用                                                                                                     |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `stream-text.ts:2219`                                              | `await standardizePrompt({ prompt, instructions, messages, allowSystemInMessages })`                     |
| `ai/packages/ai/src/prompt/standardize-prompt.ts:27`               | 三种入参（`prompt` / `system+prompt` / `messages`）混用与冲突的裁决，产出 `{ instructions, messages }`   |
| `ai/packages/ai/src/prompt/convert-to-language-model-prompt.ts:36` | `ModelMessage[]` → `LanguageModelV4Prompt`（user/assistant/tool 消息、图片、文件、cache 标记的实际形态） |

这是「UI message 层」与「model message 层」之间的边界，配合 `ai/architecture/message-layers.md` 阅读。

**注意**：`convertToLanguageModelPrompt` 每个 step 只能调用一次——`stream-language-model-call.ts:275` 有注释解释原因（它会做一次性内容转换，重复调用会得到不一致结果）。

## 3. 单步调用的组装

仍在 `streamText.ts`，位于 `while` 之内的每步开头：

```
2597  prepareStep?.(...)            → 每步可覆盖 model / toolChoice / providerOptions / instructions / tools
2716  prepareRetries({ maxRetries, abortSignal })   → 重试包装
2719  const callLanguageModel = () => runInStepTracingChannelContext(() => retry(...))
2722  streamLanguageModelCall({ ... })              → 跨文件进入下一站
```

重试边界不是简单 catch：`1053` 的 `isStreamRetryBoundaryPart` + `StreamRetryAttemptBoundary` part 保证**已经在用户侧产生的 part 不会被重复推送**，同时工具调用不会被重复执行。这是 `ai/architecture/stream-text-loop-control.md` 关心的问题之一。

## 4. 核心枢纽 `stream-language-model-call.ts`（1018 行，最值得精读）

`ai/packages/ai/src/generate-text/stream-language-model-call.ts`

| 行      | 内容                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 275     | 注释：为什么 `convertToLanguageModelPrompt` 只能调一次                                                                               |
| 305     | `standardizePrompt`（steering / 中途插话场景会再走一次）                                                                             |
| 313     | `convertToLanguageModelPrompt`                                                                                                       |
| 324     | `prepareTools`：`tool()` 定义 → provider 能接受的 tools schema                                                                       |
| 331     | `prepareToolChoice`                                                                                                                  |
| **367** | **`resolvedModel.doStream({ tools, toolChoice, responseFormat, prompt, providerOptions, abortSignal, headers, includeRawChunks })`** |
| 417     | `createLanguageModelV4StreamPartToLanguageModelStreamPartTransform`                                                                  |

**367 行是整个 SDK 的唯一收敛点**：所有函数、所有 provider、所有模型，最终都变成这一次方法调用。看懂这处入参的每一个字段，就懂了 `LanguageModelV4` 契约的全部内容。

外层还套了 `executeLanguageModelCallInTelemetryContext`（`367` 之前），`onLanguageModelCallStart/End` 回调与 telemetry span 都在这一层；`result.request` 会经 `sanitizeRequestMetadata` 脱敏后才进入结果对象。

## 5. 进入 provider（标本：DeepSeek，764 行，足够简单）

`ai/packages/deepseek/src/chat/deepseek-chat-language-model.ts`

| 行      | 内容                                                                                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 514     | `async doStream(options)`                                                                                                                                         |
| 517     | `this.getArgs(options)` → `convert-to-deepseek-chat-messages.ts`（同目录独立文件，单测齐全）                                                                      |
| 519     | 组装 `body`：`stream: true`、`stream_options: { include_usage: true }`                                                                                            |
| **525** | **`postJsonToApi({ url, headers: combineHeaders(...), body, failedResponseHandler, successfulResponseHandler: createEventSourceResponseHandler(chunkSchema) })`** |
| 564     | `response.pipeThrough(new TransformStream<ParseResult<chunk>, LanguageModelV4StreamPart>(...))`                                                                   |
| 566     | `start()`：先 `enqueue({ type: 'stream-start', warnings })`                                                                                                       |
| 578     | `transform()`：先吐 `{ type: 'raw' }`（若 `includeRawChunks`），再逐 chunk 翻译                                                                                   |
| 761     | 返回前把 `response.headers` 放进结果对象                                                                                                                          |

**关键取舍**：provider **不做流控、不做工具执行、不管多步、不重试**。职责只有三件——构 body、发请求、把自家 chunk 翻译成 part。重试、工具循环、part 缓冲全在 core。中间件（`ai/packages/ai/src/middleware/wrap-language-model.ts:75`）就是在这层外面再包一个同样 `specificationVersion: 'v4'` 的对象，所以 core 无法区分真假模型。

## 6. 真正的字节出口

`ai/packages/provider-utils/src/post-to-api.ts`

| 行     | 内容                          |
| ------ | ----------------------------- |
| 14     | `postJsonToApi`               |
| **98** | **`await fetch(url, {...})`** |

相邻必看：

- `ai/packages/provider-utils/src/fetch-with-validated-redirects.ts:72 / 174 / 183` —— URL 校验与重定向时的逐跳鉴权（`ai-sdk/require-validate-url` oxlint 规则管的就是这里；规则要求每次 `getFromApi` 显式传 `validateUrl`）
- `ai/packages/provider-utils/src/get-from-api.ts` —— 下载类请求
- `ai/packages/provider-utils/src/combine-headers.ts`、`resolve.ts` —— `Resolvable` 的合并语义（provider 默认 header 与用户 header 谁覆盖谁）
- `ai/contributing/secure-url-handling.md`

## 7. 流回到 core

1. `postJsonToApi` 用 `createEventSourceResponseHandler(schema)` 把 SSE 解成 `ParseResult<chunk>` 流（失败不抛错，而是作为带 `success: false` 的项往下游传，由 provider 决定抬成 `error` part）
2. provider `TransformStream`（第 5 站 564 行）→ `LanguageModelV4StreamPart`
3. `stream-language-model-call.ts:417` 的 transform → core 的 `LanguageModelStreamPart`，这一层补上：
   - `model-call-start` / `model-call-end` 边界（`generate-text/language-model-events.ts`）
   - `tool-input-delta` 累积成完整 `tool-call`
   - `repairToolCall`、`refineToolInput`、文件下载（`resolve-generated-file-data.ts`）
   - `callId`、`provider`、`modelId` 注入
4. `stream-text.ts:2861` 的主读循环 `while (true) { await languageModelStreamReader.read() }`（循环从 `2856` 开始）：
   - `model-call-end` → `clearModelOutputTimeouts()` + `flushBufferedAttemptParts()`（`2897`）
   - 文本/推理 part 用 `openTextParts` / `openReasoningParts` 做 `*-start` / `*-end` 配对（`2818`–`2833` 的 `enqueueAttemptPart`）
   - 工具 part 交给 `executeToolCall`（`2373` 调用，实现在 `execute-tool-call.ts`）
   - 出错时 `languageModelStreamReader.cancel(error)`（`2966`），重连时重建 reader（`2985`）

## 8. 停止与下一步

- `ai/packages/ai/src/generate-text/stop-condition.ts`
  - `isStepCount`（27）、`isLoopFinished`（37）、`hasToolCall`（47）
- `stream-text.ts:994` 把 `stopWhen` 拍平成数组，每步结束后逐条判定
- 判定继续 → 回到第 3 站，带上工具结果再跑一轮

## 9. 对外的两套流

| 输出                         | 类型             | 位置                                                                                   |
| ---------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `result.fullStream`          | `TextStreamPart` | `ai/packages/ai/src/generate-text/stream-text-result.ts`                               |
| `result.toUIMessageStream()` | `UIMessageChunk` | `stream-text.ts:3872` → `ai/packages/ai/src/ui-message-stream/to-ui-message-stream.ts` |

`toUIMessageStream` 之后接 `pipe-ui-message-stream-to-response.ts` → `create-sse-stream-with-keep-alive.ts`，再往上是 `ai/packages/react` 的 `useChat`。`consumeStream()` 在 `3786`。

结果对象**同时是 `PromiseLike` 和 `AsyncIterable`**：`await result` 拿聚合值，`for await` 拿增量；两者的取舍在 `retention.replay`（3552 附近）上——没被消费过的流无法重放。

---

## 10. 提速技巧

**1. 快照里有真实请求体**（比读代码快十倍）

```bash
sed -n '/^  "request"/,/^  }/p' \
  ai/packages/deepseek/src/chat/__snapshots__/deepseek-chat-language-model.test.ts.snap | head -30
```

`request.body` 就是实际发出去的 JSON。alternatively 用 `pnpm test:watch` 加 `-u` 看 diff。

**2. 用 mock model 跑通整条链路，不花钱**

```bash
rg -n "class MockLanguageModelV4" ai/packages/ai/src/test/
```

`ai/packages/ai/src/test/mock-language-model-v4.ts` 可以指定任意 part 序列，是理解「part 如何变成 `fullStream`」的最佳实验台。

**3. 打印 part 类型，对照着看**

```bash
cd examples/ai-functions && pnpm tsx src/stream-text/deepseek/basic.ts
```

在 `for await` 里 `console.log(part.type)`，然后对照 `stream-language-model-call.ts:417` 的 transform，区分「provider 给的」与「core 造的」part。

## 11. 速查表

| 想知道                          | 读                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| provider 必须实现什么           | `ai/packages/provider/src/language-model/v4/language-model-v4.ts`                       |
| 模型名字符串怎么变对象          | `ai/packages/ai/src/model/resolve-model.ts:38`                                          |
| messages 怎么变成 provider 参数 | `ai/packages/ai/src/prompt/convert-to-language-model-prompt.ts:36`                      |
| 工具 schema 怎么被序列化        | `ai/packages/ai/src/prompt/prepare-tools.ts:15`                                         |
| 工具怎么被执行                  | `ai/packages/ai/src/generate-text/execute-tool-call.ts`                                 |
| 多步循环何时停                  | `ai/packages/ai/src/generate-text/stop-condition.ts`                                    |
| 重试在哪一层                    | `stream-text.ts:2716` 的 `prepareRetries`                                               |
| 中间件怎么写                    | `ai/packages/ai/src/middleware/wrap-language-model.ts`、`extract-json-middleware.ts`    |
| HTTP 与 URL 安全                | `ai/packages/provider-utils/src/post-to-api.ts:98`、`fetch-with-validated-redirects.ts` |
| v3/v4 兼容怎么做的              | `ai/packages/ai/src/model/as-language-model-v3.ts`                                      |
| 为什么这样设计                  | `ai/architecture/*.md`、`ai/contributing/decisions/`                                    |

## 12. 遗留疑问

→ [`./questions.md`](./questions.md)，已提成正式条目（含验证方式）：

- `Q：model-call-end 到工具执行之间，part 缓冲与重试边界的精确时序`（对应第 7 站）
- `Q：streamTextLowMemory 到底省掉了什么`（对应第 1 站）

架构层面的 4 条开放问题在 [`../architecture/questions.md`](../architecture/questions.md)。
