# `ai/packages/provider-utils` 简述

> `@ai-sdk/provider-utils` v5.0.82 ｜ 171 个 `.ts` / 12428 行 ｜ 98 个测试 + 15 个类型测试 ｜ dist 5 个 `.js` / 3.4M

## 1. 一句话

**照 `@ai-sdk/provider` 的契约干活的工具箱**：把「发请求、解响应、认文件类型、防 SSRF、攒工具调用参数」这些每个 provider 都要重写一遍的脏活收拢到一处。和 `provider` 的分工见 [`provider-package.md`](./provider-package.md)。

## 2. 目录构成

```
src/
├── 93 个顶层 .ts                ← 按功能散落，无二级归组
├── types/          29 文件 2018 行   Tool / ToolSet / ModelMessage / ContentPart / provider reference
├── to-json-schema/ 38 文件 1899 行   内嵌第三方库（见下）
├── test/            8 文件   96 行   测试工具，走 `@ai-sdk/provider-utils/test` 子路径
└── experimental-*/          3 文件   实验性子路径入口
```

`package.json` 的 `exports` 有 5 个子路径：`.`、`./test`、`./experimental-decision`、`./experimental-evaluation`、`./experimental-extraction`。后三个是**实验 API 的独立入口**，避免污染主入口的类型面。

## 3. 十个功能块

### 3.1 HTTP 出口：所有请求的唯一收敛点

| 导出                                  |      行数 | 作用                                                   |
| ------------------------------------- | --------: | ------------------------------------------------------ |
| `postToApi`                           |       166 | 通用 POST：注入 UA、转发 `abortSignal`、失败走 handler |
| `postJsonToApi` / `postFormDataToApi` |           | 薄包装，只决定 `Content-Type` 与 body 形态             |
| `postMultipartStreamToApi`            |       268 | 流式 multipart（上传大文件用）                         |
| `getFromApi` / `deleteFromApi`        | 154 / 102 | 同构的 GET / DELETE                                    |

实现要点（`post-to-api.ts`）：

- `fetch` **默认可注入**（`fetch = getOriginalFetch()`），这是测试里能拦截网络的原因。
- 请求头统一经过 `withUserAgentSuffix(headers, 'ai-sdk-provider-utils/' + VERSION, getRuntimeEnvironmentUserAgent())`——所以抓包看到的 UA 里既有 SDK 版本，也有当前运行时信息。
- `!response.ok` 时执行 `failedResponseHandler`，并把 `url` / `requestBodyValues` / `statusCode` / `responseBody` 塞进 `APICallError`；`isAbortError` 与已包装的 `APICallError` 直接透传，不二次包装。

### 3.2 响应解析：7 个 `create*ResponseHandler`

`response-handler.ts`（467 行）里全是工厂函数，签名统一为：

```ts
type ResponseHandler<T> = (o: {
  url;
  requestBodyValues;
  response: Response;
}) => PromiseLike<{
  value: T;
  rawValue?: unknown;
  responseHeaders?: Record<string, string>;
}>;
```

| 工厂                                                                | 产出                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------ |
| `createJsonResponseHandler`                                         | 解析 JSON 并按 schema 校验                             |
| `createEventSourceResponseHandler`                                  | SSE → `ReadableStream<ParseResult<T>>`（**流式主力**） |
| `createJsonLinesResponseHandler`                                    | NDJSON / JSON Lines，单行上限 64 MiB                   |
| `createJsonErrorResponseHandler`                                    | 失败响应体 + `isRetryable` 判定                        |
| `createStatusCodeErrorResponseHandler`                              | 只看状态码的兜底                                       |
| `createBinaryResponseHandler` / `createBinaryStreamResponseHandler` | 音频、图像等二进制                                     |

返回 `ParseResult<T>`（`{success:true,value} | {success:false,error}`）而不是抛异常——单条 chunk 解析失败不会中断整条流。

### 3.3 Schema 适配：同时吃下 zod3 / zod4 / standard-schema

`schema.ts`（312 行）：

- `FlexibleSchema<T>` = `Zod3Schema | Zod4Schema | StandardSchema | Schema`，`asSchema()` 统一归一化。
- 自定义 schema 用 `Symbol.for('vercel.ai.schema')` 打标（和 `errors` 里的 `Symbol.for` 同一套跨副本技巧），`jsonSchema()` 造出来的对象只是**携带 JSON Schema 文本**，`validate` 是可选的——**这个包不内置 JSON Schema 校验器**，校验靠调用方传进来的 `validate`。
- 直接 `import { safeParseAsync } from 'zod/v4'` 与 `zod/v4/core` 的 `toJSONSchema`，所以 zod 是 peer 依赖且是**静态**引入。
- `to-json-schema/zod3-to-json-schema/` 是**内嵌的第三方库**（ISC，来自 `StefanTerdell/zod-to-json-schema`），README 写明理由：上游 peer 锁 `zod ^3.24.1`，而 AI SDK 要让装了 zod4 的用户不被迫多一份 zod3，于是把源码挖进来自己维护。

### 3.4 媒体识别：靠魔数，不靠扩展名

`detect-media-type.ts`（391 行）识别 **20 种**媒体类型：

- 图像：png / jpeg / gif / webp / avif / bmp / tiff / heic
- 音频：mpeg / wav / ogg / flac / aac / mp4 / webm
- 视频：mp4 / webm / quicktime / x-msvideo
- 文档：pdf

两个真实世界的坑写在注释里：**MP4 容器无法只凭 `ftyp` 区分音视频**（保留为 `video/mp4`），以及 **ID3 标签最长 128 KiB** 需要先跳过再找帧头。配套还有 `media-type-to-extension.ts`、`resolve-full-media-type.ts`、`convert-image-model-file-to-data-uri.ts`。

### 3.5 安全：SSRF 与解析器投毒

| 文件                                                                                                       | 行数 | 防什么                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------- | ---: | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `validate-download-url.ts`                                                                                 |  241 | 拦 `localhost`、`127.0.0.0/8`、`169.254.0.0/16`（云 metadata）、`.localhost`、IPv6 映射地址（`::ffff:127.0.0.1`）、`64:ff9b::169.254.169.254` |
| `fetch-with-validated-redirects.ts`                                                                        |  228 | 逐跳校验重定向链，防止 302 到内网                                                                                                             |
| `fetch-untrusted-url.ts`                                                                                   |   86 | 供「用户给的 URL」直连下载用                                                                                                                  |
| `secure-json-parse.ts`                                                                                     |   96 | 挡 `__proto__` / `constructor.prototype` 投毒                                                                                                 |
| `read-response-with-size-limit.ts`                                                                         |  120 | 默认上限 2 GiB，把不可恢复的 OOM 变成可 catch 的错误                                                                                          |
| `validate-base-url.ts` / `is-valid-hostname-part.ts` / `is-same-origin.ts` / `sanitize-request-headers.ts` |      | 同向的输入校验                                                                                                                                |

### 3.6 流式与长任务

- `streaming-tool-call-tracker.ts`（**534 行，全包最大**）：把 `tool-input-start/delta/end` 的碎片攒成完整 JSON 实参，`StreamingToolCallTracker` + `StreamingToolCallArgumentState` 两层。
- `speech-stream-envelope.ts`（418）/ `transcription-stream-envelope.ts`（339）：**自定义线协议**，不是 SSE。注释写明「客户端（如 `@ai-sdk/gateway`）编码、服务端（AI Gateway）解码，两头不能漂移」——协议定义放在 SDK 里是为了让两端共用同一份实现。
- `retry-with-exponential-backoff.ts`（143）：`shouldRetry` / `retryDelay` / `RetryError` 三段可定制。
- 其余基建：`delayed-promise.ts`、`cancel-response-body.ts`、`convert-async-iterator-to-readable-stream.ts`、`connect-to-websocket.ts`（132）+ `websocket.ts`。

### 3.7 大 JSON 的流式抽取

`json-binary-field-scanner.ts`（457 行）解决一个具体的内存问题：带图片的响应体基本就是一条超长 base64。常规管线（拼 chunk → 解码 text → `JSON.parse` → 解码 base64）**同时持有约四份**该字符串。扫描器改成边流边解：指定路径上的字符串即时转字节，交给 `JSON.parse` 的「骨架」里只留短占位符。

### 3.8 模型桥：用普通 LM 模拟专用模型

`extraction-language-model.ts`（356）/ `decision-language-model.ts`（278）不是纯工具，而是**适配器实现**：

```ts
export class ExtractionLanguageModel implements ExtractionModelV4 {
  private readonly model: LanguageModelV4;   // 拿普通 LM 当后端
```

自己拼 prompt、要求 JSON 输出、再解析回结构化字段，从而把任意 `LanguageModelV4` 变成一个「抽取模型」/「决策模型」。这也解释了为什么它们要挂在 `./experimental-extraction` 等子路径上。

### 3.9 工具与消息类型（`types/`，2018 行）

用户和 provider 共同使用的词汇表：`Tool` / `ToolSet` / `ExecutableTool` / `executeTool`、`ModelMessage`（system / user / assistant / tool）、`ContentPart`（text / file / image / reasoning / reasoning-file / custom / tool-call / tool-result）、`ToolApprovalRequest` / `ToolApprovalResponse`、`ProviderReference`、`Sandbox`。

`ai/packages/ai/src/index.ts:38` 直接从 `@ai-sdk/provider-utils` 再导出 `ToolSet` 等——**这层类型已经不归 `ai` 独有了**。配套的 `provider-defined-tool-factory.ts` / `provider-executed-tool-factory.ts` 提供 `createProviderDefinedToolFactory*` 这类工厂。

### 3.10 零碎但常用

`delay`、`asArray`、`combineHeaders`、`withoutTrailingSlash`、`withUserAgentSuffix`、`generateId`、`loadApiKey` / `loadSetting` / `loadOptionalSetting`、`parseJson` / `parseJsonEventStream` / `extractLines`、`stringifyWithBigIntAndCycles`、`mapReasoningToProvider`、`resolveProviderOptions` / `parseProviderOptions`、`injectJsonInstruction`、`normalizeHeaders`、`telemetryRedaction`、`VERSION`。

## 4. 三个可复用的写法

1. **`Symbol.for('vercel.ai.*')` 打标**：`schema.ts` 用 `vercel.ai.schema`、`errors` 用 `vercel.ai.error`。判断「是不是我们的对象」时不受多份副本影响。
2. **把 fetch 做成参数**：`fetch = getOriginalFetch()`（`post-to-api.ts:12`）。所有请求都能在测试里被替身接管，不必 mock 全局。
3. **vendored 依赖 + 自带 LICENSE**：`to-json-schema/zod3-to-json-schema/` 是唯一一处，用 ISC 原文保留，避免 zod 双版本进用户依赖树。

## 5. 测试与产物

|          | provider                            | provider-utils                            |
| -------- | ----------------------------------- | ----------------------------------------- |
| 测试文件 | 1 个 `.test.ts` + 2 个 `.test-d.ts` | **98 个 `.test.ts` + 15 个 `.test-d.ts`** |
| dist     | 277 `.d.ts` + 1 `.js`               | 5 `.js`                                   |

差异合理：纯类型包的正确性由下游类型检查兜底；有真实行为就得自己测。`./test` 子路径还对外提供 `convertReadableStreamToArray`、`mockId`、`isNodeVersion` 等测试工具，供 71 个 provider 包复用。

## 6. 怎么读它

1. `post-to-api.ts`（166 行）——请求怎么出去、失败怎么变成 `APICallError`。
2. `response-handler.ts` 的 `createEventSourceResponseHandler`（183 行起）——流式响应的入口，配 `parse-json-event-stream.ts` + `extract-lines.ts` 一起看。
3. `schema.ts` 的 `asSchema` / `jsonSchema`——理解「schema 只是携带 JSON Schema 文本」这件常被误解的事。
4. `streaming-tool-call-tracker.ts`——工具调用参数怎么攒，和 [`../core/stream-text-walkthrough.md`](../core/stream-text-walkthrough.md) 第 7 站对读。
5. 排障时再加：`detect-media-type.ts`、`validate-download-url.ts`。
