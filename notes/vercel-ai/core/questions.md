# core · 待解决的问题

格式：`## Q：…` 加「背景 / 我的假设 / 验证方式 / 结论 / 证据 / 相关」六段，照抄下面已有条目即可（不再维护模板文件）。属于 `ai/packages/ai` 的、已确认的机制写进主题文档（如 [`stream-text-walkthrough.md`](./stream-text-walkthrough.md)），这里只放还没查清的。

## Q：`model-call-end` 到工具执行之间，part 缓冲与重试边界的精确时序

- 背景：`stream-text.ts` 的读循环里同时存在两种「暂缓推送」机制——`bufferedAttemptParts`（重试用）和 `openTextParts` / `openReasoningParts`（`*-start`/`*-end` 配对）。工具 part 在 `model-call-end` 之前就开始累积，但执行要等整轮结束。
- 我的假设：`model-call-end` 一到就 `flushBufferedAttemptParts()` 并清定时器（`2897` 起），此后到达的 part 不再被缓冲；工具执行由 `executeToolCall`（`2373`）在读循环之外串行进行。
- 验证方式：用 mock model 造「两个 tool-call + 中间夹一个 text-delta」的流，在 `onChunk` 里记录 part 到达顺序，对比 `fullStream` 的输出顺序。
- 结论：（待补）
- 证据：`ai/packages/ai/src/generate-text/stream-text.ts:2837`、`:2897`、`:2373`
- 相关：[`stream-text-walkthrough.md`](./stream-text-walkthrough.md) 第 7 站

## Q：`streamTextLowMemory` 到底省掉了什么，"low memory" 在什么条件下成立

- 背景：`streamTextLowMemory` 与 `streamText` 共用 `startStreamText`，差别只有两处——返回 `StreamTextSingleConsumerResult` 门面，以及 `retention: { replay: false, collectContent }`。而 `collectContent` 是由「是否用了 tools / toolChoice / output / prepareStep / stopWhen / 各类回调 / telemetry」推出来的（`stream-text.ts:413`），不是一个固定值。
- 我的假设：省掉的不是 token 内容本身，而是①可重放的 part 缓存（`replay: false`）②不暴露给调用方的聚合 getter（`text`、`steps`、`toolCalls`、`request`/`response` 等）。因此**只要用了 tools 或任一回调，`collectContent` 就是 `true`，内存优势显著缩小**，只剩「不可重放」这一项。
- 验证方式：读 `createSingleConsumerStreamTextResult`（`stream-text-single-consumer-result.ts:30`）的 `Pick` 列表确认丢了哪些成员；再看 `stream-text.ts:1722` / `:1732` 处 `collectContent` 对 `recordedContent` 的写入。
- 结论：（待补）
- 证据：`ai/packages/ai/src/generate-text/stream-text.ts:402`、`:436`、`:1722`、`stream-text-single-consumer-result.ts:8`
- 相关：[`stream-text-walkthrough.md`](./stream-text-walkthrough.md) 第 1 站
