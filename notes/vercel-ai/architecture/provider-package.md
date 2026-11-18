# `packages/provider` 简述

> `@ai-sdk/provider` v4.0.39 ｜ 274 个 `.ts` / 12234 行 ｜ 仓库内 88 个包里 71 个依赖它

## 1. 一句话

**这个包只有「声明」，没有「实现」**：它定义 AI SDK 认为一个模型应该长什么样，各家 provider 包按这些类型把自己的 API 翻译过来。98% 的代码是 TypeScript 类型，运行时只有错误类和几个断言函数。

包自己的 README 也说得很直白：

> Defines the interfaces and specifications that provider adapters implement to work with AI SDK Core (`ai`). It is primarily an internal dependency of AI SDK Core and provider adapter packages; applications rarely need to depend on it directly.

## 2. 在依赖图里的位置

```
应用  →  ai (AI SDK Core)  →  @ai-sdk/provider        ← 本包（叶子）
                          →  @ai-sdk/provider-utils
应用  →  @ai-sdk/deepseek  →  @ai-sdk/provider
                          →  @ai-sdk/provider-utils
```

- 它**不依赖 `ai`**，方向是单向的。所以 `provider` 包里找不到 `generateText`、`streamText` 这些名字，只有 `doGenerate` / `doStream`。
- 唯一的运行时依赖是 `json-schema@^0.4.0`，而且只为一件事：`src/index.ts:31` 重新导出 `JSONSchema7` 类型。该包本身不带类型定义，类型来自 devDependency `@types/json-schema`。

> 顺带一提：`json-schema` 正是 [`notes/json-schema/`](../../json-schema/README.md) 里那个冻结在 2010 年的老包。2025 年的 AI SDK 仍通过它在类型层面引用 draft-07 的 schema 结构。

## 3. 为什么它是两个包（vs `provider-utils`）

同一条依赖链的上下两层：**`provider` 是契约，`provider-utils` 是照着契约干活的工具箱**（真代码 + 真依赖）。

|                  | `@ai-sdk/provider`                    | `@ai-sdk/provider-utils`                                                        |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------------------- |
| 版本             | 4.0.39                                | 5.0.82                                                                          |
| dependencies     | `json-schema`（仅类型）               | `provider` + `eventsource-parser` + `@standard-schema/spec` + `@workflow/serde` |
| peerDependencies | 无                                    | `zod@^3.25.76 \|\| ^4.1.8`                                                      |
| 源码             | 274 文件 / 12234 行（98% 是类型）     | 171 文件 / 12428 行（基本全是运行时）                                           |
| dist             | 277 个 `.d.ts` + **1** 个 `.js`，2.3M | **5** 个 `.js`，3.4M                                                            |
| 依赖它的包       | 71                                    | 79                                                                              |

依赖方向严格单向：`provider-utils → provider`，从不反向。所以 `provider` 是其依赖图里真正的叶子。

### 3.1 历史：它是从 `ai` 里抽出来的，不是从 `provider` 里乱的

2024-04-11 的 `d544886d4f` _Move AI providers to separate packages (#1326)_ 把 provider 拆成独立 npm 包，同时把原先住在 **`packages/core/spec/util/`**（也就是 `ai` 包内部）的一组工具新建到 `provider-utils`：

`post-to-api.ts`、`parse-json.ts`、`response-handler.ts`、`load-api-key.ts`、`generate-id.ts`、`scale.ts`、`validate-types.ts`、`uint8-utils.ts`……

动机直接写在依赖边界上：**provider 适配器不能依赖 `ai`**——否则既成环（`ai` 反过来要调度 provider），又把适配器的版本牢牢绑在主包上。所以“公共实现”得有个第三处落脚点。

### 3.2 今天的划分规则

| 内容                                   | 放哪里           | 理由                                                     |
| -------------------------------------- | ---------------- | -------------------------------------------------------- |
| 形状、枚举、错误类                     | `provider`       | 契约本身；错误类虽是运行时，但零外部依赖                 |
| I/O、网络、解析、编码、校验、websocket | `provider-utils` | 需要 `fetch` / `EventSourceParserStream` / `zod` / serde |
| 编排、状态机、重试、流生命周期         | `ai`             | 需要知道 `streamText` 的存在                             |

### 3.3 不能合并的四个理由

1. **依赖传染是最硬的理由**。`provider` 被 71 个包依赖，其中大量是第三方/社区 provider。一旦它 `import eventsource-parser` 或 `zod`，所有下游都被迫安装。
2. **peer 依赖不可能**。`zod` 必须由宿主定版本、且 v3/v4 都行；纯类型包带 peer 会强迫每个用户装 zod。
3. **发版节奏不同**。spec 由 V2/V3/V4 驱动（大版本），utils 由 bugfix 驱动（`5.0.82` 已 82 个 patch，`4.0.39` 是 39 个）。changesets 按包独立发版。
4. **体积敏感度不同**。`provider` 的 2.3M 全是编译期就消失的 `.d.ts`；`provider-utils` 的 3.4M 是真 JS，会进 bundle。

额外收益：**utils 的依赖面反而更宽**（79 > 71）。`vue` / `svelte` / `angular` 适配包、`harness-*`、`sandbox-*`、`valibot`、`tool-web-fetch` 这些只要工具不要 spec，共 10 个包只装 `provider-utils`。

`provider-utils` 里具体有什么，见 [`provider-utils-package.md`](./provider-utils-package.md)。

### 3.4 边界上的三个轶事

- `provider` 里仍有运行时代码（`errors/` 与 `json-value/is-json.ts`），但零外部依赖，所以不破坏叶子属性。
- `json-schema` 实际上只用到类型，却列在 `dependencies` 而不是 `devDependencies`——历史包袏。
- `provider-utils` 的 `schema.ts` 是**静态** `import { safeParseAsync } from 'zod/v4'`，所以用到它任何导出的场景都受 zod peer 约束，不能只拿一个小工具就跑。

## 4. 目录构成（按行数排序）

| 目录                          | 文件 | 行数 | 性质                               |
| ----------------------------- | ---: | ---: | ---------------------------------- |
| `language-model/`             |   67 | 3691 | **核心**，v2/v3/v4 三代并存        |
| `realtime-model/`             |   13 |  949 | 实时语音/WS 会话                   |
| `video-model/`                |   15 |  877 | 异步任务式（start/status/webhook） |
| `errors/`                     |   21 |  792 | **唯一成规模的运行时代码**         |
| `speech-model/`               |   18 |  792 | TTS                                |
| `transcription-model/`        |   15 |  784 | ASR                                |
| `image-model/`                |   16 |  726 | 图像生成                           |
| `embedding-model/`            |   14 |  404 | 向量                               |
| `files/`                      |   11 |  390 | 文件上传                           |
| `shared/`                     |   18 |  376 | 跨模型共享的基础类型               |
| `speech-translation-model/`   |    7 |  331 | 语音翻译                           |
| `batch/`                      |    6 |  292 | 批处理                             |
| `reranking-model/`            |    8 |  275 | 重排                               |
| `provider/`                   |    7 |  258 | `ProviderV2/V3/V4` 门面            |
| `language-model-middleware/`  |    7 |  256 | LM 中间件契约                      |
| `decision-model/`             |    6 |  197 | 实验性决策                         |
| `extraction-model/`           |    5 |  192 | 实验性抽取                         |
| `image-model-middleware/`     |    5 |  144 |                                    |
| `embedding-model-middleware/` |    5 |  142 |                                    |
| `skills/`                     |    5 |  112 |                                    |
| `json-value/`                 |    3 |   59 | `JSONValue` + `isJSONValue()`      |
| `model-capabilities.ts`       |    1 |  164 | 能力声明契约                       |
| `index.ts`                    |    1 |   31 | 汇总导出                           |

**运行时 vs 类型**：`grep '^export \(class\|function\|const\)'` 只命中 24 处 —— 19 个错误类 + `getErrorMessage` + `isJSONValue` / `isJSONArray` / `isJSONObject` + 1 个实验性别名。也就是说除错误处理和 JSON 断言外，**整个包编译后能被 `import` 调用的东西极少**——绝大部分 `import` 会被类型擦除。

构建产物印证这一点：`dist/` 里 **277 个 `.d.ts`，只有 1 个 `.js`**（tsdown 把入口打包成单文件），2.3M 全是类型声明。

## 5. 核心接口：`LanguageModelV4`

`src/language-model/v4/language-model-v4.ts` 全文 61 行，是四个属性 + 两个方法：

```ts
readonly specificationVersion: 'v4';   // 版本判别用，字面量类型
readonly provider: string;
readonly modelId: string;
readonly supportedUrls: PromiseLike<Record<string, RegExp[]>> | Record<string, RegExp[]>;

doGenerate(options: LanguageModelV4CallOptions): PromiseLike<LanguageModelV4GenerateResult>;
doStream(options: LanguageModelV4CallOptions): PromiseLike<LanguageModelV4StreamResult>;
```

两个方法名都带 `do` 前缀，注释写明原因：**防止用户绕过 AI SDK 直接调用**。

`supportedUrls` 是给多模态 URL 用的白名单：`{'*/*': [/^https:\/\/.../]}` 命中则把 URL 原样交给模型而不是先下载再 base64。匹配对象是**小写化后的 URL**。

### 5.1 一次调用的输入输出

| 类型                                     | 字段                                                                                                                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LanguageModelV4CallOptions`（139 行）   | `prompt`、`maxOutputTokens`、`temperature`、`topP`、`topK`、`stopSequences`、`presencePenalty`、`frequencyPenalty`、`responseFormat`、`seed`、`tools`、`toolChoice`、`includeRawChunks`、`abortSignal`、`headers`、`reasoning`、`providerOptions` |
| `LanguageModelV4GenerateResult`（76 行） | `content`（10 类 part）、`structuredOutputText`、`finishReason`、`usage`、`providerMetadata`、`request`、`response`、`warnings`                                                                                                                   |
| `LanguageModelV4StreamResult`            | `stream: ReadableStream<LanguageModelV4StreamPart>`、`request?`、`response?`                                                                                                                                                                      |
| `LanguageModelV4StreamPart`（124 行）    | 15 种：`text-start/delta/end`、`reasoning-start/delta/end`、`tool-input-start/delta/end`、`stream-start`、`response-metadata`、`finish`、`ping`、`raw`、`error`                                                                                   |
| `LanguageModelV4Content`                 | `Text`、`Reasoning`、`ReasoningFile`、`CustomContent`、`File`、`ToolApprovalRequest`、`Source`、`ToolCall`、`ToolResult`、`Citation`                                                                                                              |
| `LanguageModelV4FinishReason`            | `stop`｜`length`｜`content-filter`｜`tool-calls`｜`error`｜`interrupted`｜`other`                                                                                                                                                                 |
| `LanguageModelV4Usage`                   | `inputTokens` / `outputTokens` / `raw?`                                                                                                                                                                                                           |

两条值得注意的设计取舍：

1. **流式结构是「start/delta/end」三件套**，不是扁平的 delta。好处是并行文本块（多工具并行、推理与正文交织）能各自开合、互不串流。代价是消费侧必须维护配对状态——这正是 [`core/questions.md`](../core/questions.md) 第一条问题的来源。
2. **`stream-start` / `response-metadata` / `finish` 属于「元信息 part」**，不是内容。所以 `fullStream` 与「用户看到的 token」并非一一对应。

## 6. 多版本怎么共存

同名接口有三代，靠目录隔离 + `specificationVersion` 字面量判别：

```
language-model/v2/language-model-v2.ts   → specificationVersion: 'v2'
language-model/v3/language-model-v3.ts   → 'v3'
language-model/v4/language-model-v4.ts   → 'v4'
```

`src/**/index.ts` 三代全导出，因此类型名必须不同（`LanguageModelV2`/`V3`/`V4`）。各模型类型迁移进度并不一致：

| 已有 v4                                                                                                                       | 只有 v3 + v4（无 v2）                                                                    | v2 + v3 + v4 三代并存                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `batch`、`files`、`skills`、`realtime-model`、`decision-model`、`extraction-model`、`speech-translation-model`（**只有 v4**） | `reranking-model`、`video-model`、`image-model-middleware`、`embedding-model-middleware` | `language-model`、`image-model`、`embedding-model`、`speech-model`、`transcription-model`、`provider`、`shared`、`language-model-middleware` |

**本包不做版本适配**。把 v2/v3 模型包装成 v4 的适配器在上层：`packages/ai/src/model/as-language-model-v4.ts`、`as-provider-v4.ts`。这一点常被误解——provider 包只负责「声明三代并行存在」。

## 7. 为什么要分 v2/v3/v4

是，但不只是「改出了不兼容变更」，而是**两个约束碰到一起**：

1. 规范确实每代都在破兼容（见下表）；
2. `@ai-sdk/provider` 被 71 个包依赖，一改类型就要求所有 provider 在同一天发版——做不到。

所以做法是：**开一个新目录当新槽位，老版本原地冻结**。

### 7.1 版本号是「先复制、后演进」的槽位

V4 引入那次提交（`835961299d` _start v7 pre-release cycle_）的说明写得很清楚：

> Create `LanguageModelV4` spec skeleton in `@ai-sdk/provider` (copy of V3 with renamed types)
>
> The V4 spec skeleton is an exact copy of V3 with type names updated to V4 and `specificationVersion: 'v4'`.

即：**刚出生时 V4 与 V3 完全等价**，一个字段都没改。之后 v7 周期里的破坏性改动全落在 V4 上，而 V3 保持不动——这样已发布的 provider 包（锁着旧 semver）不会被新类型洗掉。

### 7.2 各代实际破了什么

| 代际    | 破坏性变更（`packages/provider/CHANGELOG.md` 的 Major Changes + 类型 diff）                                                                                                                                                                                                                                              |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1 → v2 | `specificationVersion` 字段 v1 就有（值 `'v1'`），所以不是它引进的；真影响用户的是 **流式 part 重排**：v1 是扁平 `{type:'text-delta', textDelta}` / `{type:'reasoning', textDelta}`，v2 改成 `text-start/delta/end`、`reasoning-start/delta/end` 配对式，part 也从 `language-model-v1.ts` 内联定义拆成独立文件           |
| v2 → v3 | `usage` 从扁平数值改成嵌套对象（`inputTokens: number` → `{total, noCache, cacheRead, cacheWrite}`）；`finishReason` 去掉 `'unknown'`；返回值从内联类型提取为 `LanguageModelV3GenerateResult` / `StreamResult`；warning 从 `LanguageModelV2CallWarning` 移到版本无关的 `shared/`，并扩成 4 种；新增 tool approval request |
| v3 → v4 | 文件 `data` 加类型标签、删除 image part 类型；新增 `custom` content、`reasoning-file`、`citation`、`ping` stream part、顶层 `reasoning` 参数、provider references / 文件与技能上传；`finishReason` 加 `'interrupted'`；tool result 输出里的 file part 与消息级 file part 对齐                                            |

（`usage` 的嵌套改造最隐蔽：类型检查能拦住，但一旦某个 provider 声明 v4 却按旧形状填 `inputTokens: number`，聚合出来的 token 统计会变成 `NaN` 而不报错。适配器里有一对 `convertV2UsageToV3` 替声明 v2 的老 provider 做转换，但它只认 `specificationVersion`，对「声明 v4 却填错形状」无能为力。）

另外，**v1 已于 2025-06 整体删除**（`0d06df684b` _remove v1 providers_），目录不复存在。所以现在是「三代并存」，而更早的 v1 是真正被淘汰掉的——传入 v1 模型会直接抛 `UnsupportedModelVersionError`。版本目录不只是并存手段，也是**报废时的切杀线**。

### 7.3 多版本目录真正的用途：运行时升版

不是类型存档。`resolveLanguageModel` 只白名单 `['v4','v3','v2']`，然后把任何老版本交给适配器：

```ts
// packages/ai/src/model/as-language-model-v4.ts
export function asLanguageModelV4(
  model: LanguageModelV2 | V3 | V4,
): LanguageModelV4 {
  if (model.specificationVersion === 'v4') return model;
  const v3Model =
    model.specificationVersion === 'v2' ? asLanguageModelV3(model) : model;
  return new Proxy(v3Model, {
    /* specificationVersion → 'v4'，边调用边转换 prompt / stream part */
  });
}
```

v2 → v3 → v4 链式上转，逐层把 prompt、content、stream part 翻译成新形态。于是：**用户升级 `ai` 到 v7，手里一个 2025 年的 provider 包仍然能跑**，只是走 Proxy 转换路径（有额外开销，且拿不到 V4 新能力）。

> **关键限定**：出口永远是当前版本——`resolveLanguageModel` 的返回类型恒为 `LanguageModelV4`，`LanguageModel` 也是 `V2 | V3 | V4` 三代的联合类型。所以这套设计**不消除破坏性变更**，只是把「谁来付账」从 71 个 provider 作者（编译期、必须同日发版）移给 `ai` 的适配层（运行时、永久维护）。买到的是「升级顺序解耦」，不是「升级没问题」。

### 7.4 适配层并不天然可靠：v2 → v3 的真实履历

V3 那次迁移的足迹很能说明问题：

| 时间       | 提交                                     | 发生了什么                                                                                                                                                                                   |
| ---------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-09-26 | `8dac8958bf` feat(spec): LanguageModelV3 | `resolveLanguageModel` 白名单收了 v3 与 v2，但对 v2 只是 `return model`——**零转换的类型断言**                                                                                                |
| 2025-10-27 | `0c3b58ba9c`                             | 才有 `as-language-model-v3.ts`，而它只用 Proxy 改写 `specificationVersion`，注释直白地写着：`TODO this could break, we need to properly map v2 to v3 and support all relevant v3 properties` |
| 2025-12-09 | `3bd2689175` feat: extended token usage  | `convertV2UsageToV3` 才落地——而且它是跟着新功能进来的，不是为了修兼容                                                                                                                        |

也就是说，**V3 上线后的头两个半月里，「v2 模型也能跑」是靠形状碰巧对得上撑过来的**；`usage` 从扁平到嵌套这种无报错的变更，当时根本没人转。这正是一个反例：版本目录只是给适配层留了**可写的位置**，能不能写对是另一回事。

### 7.5 代价

- 体积：`dist/` 2.3M，277 个 `.d.ts`——三代类型全在。
- 心智：类型名带版本后缀，搜 `LanguageModelV2` 会搜到一堆不该再用的东西。
- 但**运行时开销为零**：类型全部擦除，`dist/index.js` 只有一个文件，多版本目录不增加任何 bundle 成本。这就是「类型层可以奢侈地保留三代」的原因。
- 适配层不是免费的：走 Proxy 的模型不能享受 V4 新特性（`citation`、`custom content`、`ping` 等），只能被降维表达；漏转的字段不会报错，只会静默变成 `undefined` / `NaN`。
- 仓库内并**不**存在“渐进迁移”：引入 V3 的同一个 commit 就把 71 个 provider 包全改完了（changeset 里全部标 `patch`）。渐进性只对**已发布的旧包**和**第三方 provider** 有意义。

## 8. 其他模型面的方法名

按能力各有约定，并不统一叫 `doGenerate`：

| 目录                                                   | v4 方法                                                                                                         |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `embedding-model`                                      | `doEmbed`                                                                                                       |
| `image-model` / `speech-model` / `transcription-model` | `doGenerate`（speech 另有 `doStream`）                                                                          |
| `reranking-model`                                      | `doRerank`                                                                                                      |
| `batch`                                                | `doStartBatch` / `doGetBatchStatus` / `doGetBatchResults`                                                       |
| `files` / `skills`                                     | `uploadFile` / `uploadSkill`                                                                                    |
| `video-model`                                          | `doGenerate?` / `doStart?` / `doStatus?` + `handleWebhookOption`（异步任务模式）                                |
| `realtime-model`                                       | `parseServerEvent` / `serializeClientEvent` / `buildSessionConfig` / `doCreateClientSecret?` … 事件协议翻译为主 |

后三个（video / realtime / batch）是**状态机型**而非请求-响应型：provider 要交出「怎么发起、怎么查状态、怎么翻译事件」，AI SDK 负责编排。

## 9. 三块支撑件

**`errors/`**（792 行，唯一有真实逻辑的地方）

19 个错误类（`errors/` 共 21 个文件，余下是 `index.ts` 和 `getErrorMessage`），全部继承 `AISDKError`。后者有两个关键设计，且都不是 `extends Error` 本身：

```ts
const symbol = Symbol.for('vercel.ai.error'); // 全局注册表，跨包实例共享
```

因此 `isInstance` 判断跨包版本也成立——多个包各自打包一份 `@ai-sdk/provider` 时，`instanceof` 会失效，`Symbol.for` 不会。这是 monorepo 多副本场景的经典解法。

`APICallError` 是 provider 适配器最常抛的：携带 `url` / `requestBodyValues` / `statusCode` / `responseBody` / `isRetryable`，其中 `isRetryable` 直接决定 AI SDK 要不要重试。

**`shared/`**（376 行）

跨模型复用的四个概念：`ProviderOptions`（`providerOptions.deepseek.xxx` 的类型入口）、`ProviderMetadata`（provider 回传的私有数据）、`Warning`（4 种：`unsupported` / `compatibility` / `deprecated` / `other`）、`AudioFormat` / `FileData`。

**`model-capabilities.ts`**（164 行）

能力声明契约，注意它的自我限定：`ModelCapability = boolean | 'unknown' | {condition: string}`，`unknown` 与「不支持」是两回事，`condition` 只是**文档字符串，不是可执行表达式**。这段类型不参与校验、不改变请求行为——它服务于生成的文档和 provider 目录。

## 10. 构建与发布

- `tsdown` + 仓库内共享配置（`@vercel/ai-tsdown-config`），**纯 ESM**（`"type": "module"`，`exports` 里没有 CJS 分支）。
- `"files"` 白名单收得很紧：`dist/**`、`src`（去掉测试与 fixture）、`CHANGELOG.md`、`README.md`。
- `engines.node >= 22`，`publishConfig.provenance: true`。
- 测试极薄：`src/` 下只有 1 个 `.test.ts` 和 2 个 `.test-d.ts`（类型测试）。这个包的「正确性」主要靠全仓 71 个下游包的类型检查间接保证。

## 11. 怎么读它

1. `src/language-model/v4/language-model-v4.ts`（61 行）——先看接口形状。
2. `language-model-v4-call-options.ts` + `-stream-part.ts`——输入输出词汇表，处处被引用。
3. `provider/v4/provider-v4.ts`——Provider 门面，看「一个 provider 包必须交出哪几个模型」。
4. 挑一个真实适配器对照读：`packages/deepseek/src/chat/deepseek-chat-language-model.ts`（见 [`../core/stream-text-walkthrough.md`](../core/stream-text-walkthrough.md) 第 5 站）。
5. 只有排错时才进 `errors/`。

`src/` 里剩下的 `realtime-model` / `video-model` / `decision-model` / `extraction-model` 属于「用到再看」——它们各自 200~950 行，彼此独立，不构成理解主链路的必要知识。
