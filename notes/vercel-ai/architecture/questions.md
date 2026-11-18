# architecture · 待解决的问题

格式：`## Q：…` 加「背景 / 我的假设 / 验证方式 / 结论 / 证据 / 相关」六段，照抄下面已有条目即可（不再维护模板文件）。结论确认后，能并入 [`ai-sdk-architecture.md`](./ai-sdk-architecture.md) 的就并进去，这里只保留尚未查清的条目。

## Q：`stopWhen` 与 `prepareStep` 的交互边界在哪

- 背景：`prepareStep` 每步可以改 model / tools / toolChoice / providerOptions，而 `stopWhen` 基于上一步结果判定是否继续。两者都在 step 末尾/开头执行，谁先谁后决定「改过参数的那一步算不算最后一 step」。
- 我的假设：`stopWhen` 只看已完成的 step 结果，`prepareStep` 只在「确定还要继续」之后才执行；因此最后一步不会触发 `prepareStep`。
- 验证方式：读 `packages/ai/src/generate-text/stream-text.ts:2597`（`prepareStep` 调用点）与 `:994`（`stopConditions`）之间的控制流；用 `packages/ai/src/test/mock-language-model-v4.ts` 造 3 步，在 `prepareStep` 里打点。
- 结论：（待补）
- 证据：`packages/ai/src/generate-text/stream-text.ts:2597`、`packages/ai/src/generate-text/stop-condition.ts:27`
- 相关：[`../core/stream-text-walkthrough.md`](../core/stream-text-walkthrough.md) 第 3、8 站

## Q：重试时怎么保证工具不被重复执行

- 背景：`stream-text.ts` 用 `prepareRetries()` 包住 `streamLanguageModelCall`，重试会重发整次模型请求。若上一次流里已经推了 `tool-call` 且 core 已执行工具，重试就会重复执行。
- 我的假设：`StreamRetryAttemptBoundary` 之前的 part 会被缓冲（`bufferedAttemptParts`），重试失败则丢弃缓冲；工具 part 在判定成功前不进入执行队列。
- 验证方式：读 `stream-text.ts:1053`（`isStreamRetryBoundaryPart`）与 `:2838`（`flushBufferedAttemptParts`）；构造一个「首次返回 tool-call 后断开、重试成功」的 mock 流，断言 `executeToolCall` 只调用一次。
- 结论：（待补）
- 证据：`packages/ai/src/generate-text/stream-text.ts:2716`、`:1053`、`:2838`
- 相关：`architecture/stream-text-loop-control.md`

## Q：`as-language-model-v4` 对 v3 做了哪些损失性适配

- 背景：`resolveLanguageModel` 接受 `v2 | v3 | v4`，v3 对象经 `as-language-model-v3.ts` / `as-language-model-v4.ts` 包装成 v4 使用。包装不可能无损，得知道哪些字段会丢。
- 我的假设：v4 新增的能力（如 `model-capabilities` 相关字段、新的 content part 类型）在 v3 来源上一律缺失或退化为默认值。
- 验证方式：逐字段对照 `packages/ai/src/model/as-language-model-v3.ts` 与 `packages/provider/src/language-model/{v3,v4}/` 的类型定义。
- 结论：（待补）
- 证据：`packages/ai/src/model/as-language-model-v4.ts`、`packages/ai/src/model/resolve-model.ts:38`
- 相关：[`ai-sdk-architecture.md`](./ai-sdk-architecture.md) 4.1

## Q：UI 消息流在断线重连与 `consumeStream` 取消时的一致性

- 背景：`toUIMessageStream()` 之后经 SSE 发给浏览器，客户端 `useChat` 自己维护消息状态。断线重连会重放吗？`consumeStream()` 被取消时服务端还会继续推吗？
- 我的假设：`retention.replay` 决定流能否被重复消费；未消费过的流无法重放，重连靠客户端 request body 里回传已有消息重建。
- 验证方式：读 `packages/ai/src/ui-message-stream/read-ui-message-stream.ts`、`packages/react/src/` 里的重连逻辑，以及 `stream-text.ts:3552`（`retention.replay` 触发 `consumeStream`）。
- 结论：（待补）
- 证据：`packages/ai/src/generate-text/stream-text.ts:3552`、`:3786`
- 相关：[`ai-sdk-architecture.md`](./ai-sdk-architecture.md) 4.6
