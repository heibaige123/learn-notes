# `examples/` 阅读路线

本文只解决一个问题：**`examples/` 里那一堆 demo，从哪看起、每层该带着什么问题看**。

与另外两篇的分工：[`../architecture/ai-sdk-architecture.md`](../architecture/ai-sdk-architecture.md) 的 §6 是「**源码**阅读顺序」（先读规范层接口，再读 `generate-text.ts` 的 step 循环）；本文是「**示例**阅读顺序」，用来在真正钻源码前把 API 形状和可观测现象先钉死。两篇互补，不重复。

> 路径相对仓库根目录；示例仓库根为 `examples/ai-functions/`。

## 0. 先摆正 `examples/` 的位置

`examples/` 下有 22 个目录，但**只有 `ai-functions` 是函数级示例库**，其余是框架接入样板或产品形态 demo，早期读它们只会被脚手架噪音淹没。

| 目录                                                                                                | 性质                                                                   | 什么时候看     |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------- |
| `ai-functions/`                                                                                     | **函数级示例 + provider e2e 契约测试**，`src/` 下按 API 分 35 个子目录 | 现在，且是主线 |
| `next/`、`next-openai-pages/`、`nuxt-openai/`、`sveltekit-openai/`、`angular/`                      | 框架接入样板（`useChat` + 路由 handler）                               | 想写聊天 UI 时 |
| `hono/`、`express/`、`fastify/`、`node-http-server/`                                                | 非 Next 服务端接入，每个都很薄                                         | 10 分钟可过    |
| `next-agent/`、`next-workflow/`                                                                     | agent / workflow 的产品形态示范                                        | 读完第 5 层后  |
| `next-openai-telemetry/`、`-sentry/`、`-upstash-rate-limits/`、`next-openai-kasada-bot-protection/` | 可观测性、限流、防滥用等生产配套                                       | 按需           |
| `mcp/`、`next-langchain/`、`next-fastapi/`、`xai-tts-demo/`                                         | 单点集成                                                               | 按需           |

`ai-functions` 内部规模（`ls src/generate-text/openai | wc -l`）：`generate-text/` 下 33 个 provider 子目录、`stream-text/` 下 35 个，其中 `openai/` 一个目录就 162 / 134 个文件 —— 所以**必须按层挑，不能顺读**。

## 1. 第 0 层 · 先把壳子读了

不读这三个，后面每个示例都会有个看不懂的 `run()` 和 `print()`。

| 文件                                                 | 看什么                                                 |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `examples/ai-functions/src/lib/run.ts`               | 所有示例的统一入口：try/catch、计时、错误归一打印      |
| `examples/ai-functions/src/lib/print.ts`             | 带颜色的 `print()`，没有魔法                           |
| `examples/ai-functions/src/lib/print-full-stream.ts` | **最有观察价值**：把 `fullStream` 的 part 一条条打出来 |

跑起来（需要 `.env` 里的 `OPENAI_API_KEY`，见 `examples/ai-functions/README.md`）：

```sh
cd examples/ai-functions
pnpm tsx src/generate-text/openai/basic.ts
```

## 2. 第 1 层 · 最小闭环：`generateText` → `streamText`

| 文件                                | 看什么                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/generate-text/openai/basic.ts` | 12 行，一个 result 的**全部可观测字段**：`content` / `usage` / `finishReason` / `rawFinishReason` |
| `src/stream-text/openai/basic.ts`   | 同样的字段，但 `usage`、`finishReason` 是 **Promise** —— 这一处差异就是流式的本质                 |

对照源码：`packages/ai/src/generate-text/generate-text.ts`、`stream-text.ts` 的返回类型定义。

## 3. 第 2 层 · 看清 part 契约（最值回票价的一层）

| 文件                                        | 看什么                                                                 |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `src/stream-text/openai/fullstream.ts`      | 按语义分组的 part（`text-delta` / tool-call 三段式 / `step-finish` …） |
| `src/stream-text/openai/fullstream-raw.ts`  | raw provider chunk 原样透出，与上一份对比着看                          |
| `src/stream-text/openai/on-chunk.ts`        | 不用 `for await`，走回调的等价写法                                     |
| `src/stream-text/openai/on-step-finish.ts`  | 多步之间（step 边界）能拿到什么                                        |
| `src/stream-text/openai/on-finish-steps.ts` | 结束时拿全量 `steps`                                                   |

这一层正好验证 [`stream-text-walkthrough.md`](./stream-text-walkthrough.md) 里写的 part 配对规则与「三层流」分界。**笔记与输出不一致时，以 `fullstream.ts` 的实际输出为准改笔记。**

## 4. 第 3 层 · 工具与多步（AI SDK 最绕的地方）

| 文件                                                     | 看什么                                                         |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `src/tools/weather-tool.ts`                              | `tool()` 的最小定义：`description` / `inputSchema` / `execute` |
| `src/generate-text/openai/multi-step.ts`                 | 多步循环本身                                                   |
| `src/generate-text/openai/prepare-step-call-settings.ts` | 每步改参数的钩子（`maxSteps` 已废弃，这里才是入口）            |
| `src/generate-text/openai/dynamic-tool-call.ts`          | 运行时才知道有哪些工具                                         |
| `src/generate-text/openai/active-tools.ts`               | 只启用部分工具                                                 |
| `src/stream-text/openai/on-chunk-tool-call-streaming.ts` | 工具**参数**是边流边拼的                                       |
| `src/stream-text/openai/refine-tool-input.ts`            | 工具输入校验 / 修正                                            |

对照源码：`packages/ai/src/generate-text/stop-condition.ts`（`stepCountIs` / `hasToolCall`）与 step 循环里 `stopWhen` 的判定点。

## 5. 第 4 层 · 手写一遍底层：`streamLanguageModelCall`

```sh
src/stream-text-custom-loop/openai.ts
```

它用 `experimental_streamLanguageModelCall` 拿 `LanguageModelStreamPart`，手动处理 `model-call-start` / `text-delta` / `model-call-end` —— **这正是 `stream-text-walkthrough.md` 第 4 站那条链路的手动版**。读懂它等于能手写一遍 `streamText`。配套源码：`packages/ai/src/generate-text/stream-language-model-call.ts`。

## 6. 第 5 层 · 高级特性（按兴趣挑，别全读）

| 主题                  | 入口文件                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| 结构化输出            | `src/stream-text/openai/output-object-fullstream.ts`（及同目录 `output-object-*.ts`） |
| agent step / 生命周期 | `src/agent/openai/generate-on-step-finish.ts`                                         |
| 工具审批              | `src/agent/openai/generate-tool-approval.ts`                                          |
| 运行时上下文          | `src/agent/openai/generate-runtime-context.ts`                                        |
| sandbox / shell       | `src/agent/openai/generate-local-sandbox.ts`、`src/tools/sandbox-shell-tool.ts`       |
| 中间件链              | `src/middleware/`（15 个文件：改 body、加 header、剥 Markdown 围栏等）                |
| 可观测性              | `src/telemetry/`                                                                      |
| provider 注册表       | `src/registry/`（16 个文件）                                                          |
| MCP                   | `src/tools/mcp-client-error-handling.ts`、`src/tools/mcp-tool-drift-detection.ts`     |

## 7. 现在还不到看 e2e 的时候

`src/e2e/` 是 24 个 provider 契约测试矩阵（`pnpm run test:e2e:all`，不在 CI 跑）。它回答的是「每个能力在各家 provider 上的通过情况」，**读 provider 实现之前别看** —— 等第 2 层弄清 part 契约后再回来，把 e2e 当「provider 该实现什么」的规格表用。

## 8. 三条读法

1. **别按字母顺读** `openai/` 下那 160+ 个文件。那是按 issue 临时加进去的测试坟场，还混着 `compatible-*`（第三方兼容层）和 `responses-*`（OpenAI Responses API 专有）两类噪音。
2. 示例里的模型名很超前（`gpt-6-astra`、`gpt-5.4-nano`），**跑不通是常态**；跑不通就只读代码，API 形状和调用参数照样能看明白。
3. 每读完一层，结论回写到本 vault 对应的 `core/questions.md` / `architecture/questions.md` 或主题文档，不新开碎文件 —— 遵守 [`../README.md`](../README.md) 里定的文件角色约定。

## 9. 进度

- [ ] 第 0 层 壳子（`lib/run.ts`、`print-full-stream.ts`）
- [ ] 第 1 层 `generate-text/basic` ↔ `stream-text/basic`
- [ ] 第 2 层 fullstream / on-chunk / step-finish
- [ ] 第 3 层 工具与多步
- [ ] 第 4 层 `stream-text-custom-loop`
- [ ] 第 5 层 高级特性（挑读）
- [ ] 回看 `src/e2e/`
