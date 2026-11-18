# 仓库简述

> 对象：`eventsource-encoder` —— npm 包 `eventsource-encoder` 的上游仓库（作者 rexxars / Espen Hovlandsdal）
> 版本：`1.0.2`（2026-04-27），MIT

## 1. 一句话

把「一个事件对象」变成**合法的 `text/event-stream` 字节**的工具。源码一共 146 行，所有复杂度集中在两件事上：**换行**和**防注入**。

## 2. 定位与状态

- **零运行时依赖**：`package.json` 没有 `dependencies`，只有 devDependencies（`@sanity/pkg-utils`、vitest、eslint、semantic-release）。
- **只做编码**：不出 HTTP 服务、不设响应头、不管连接管理/背压/保活/重连，也**不做数据序列化**——传对象前要自己 `JSON.stringify`。
- `type: "module"`，`exports` 同时提供 `source` / `import` / `require` / `default` 四个条件，用 `@sanity/pkg-utils` 构建出 `dist/index.js`（ESM）和 `dist/index.cjs`。
- `engines.node >= 18`；CI 三个 job 分别跑 Node、Bun、Deno（`npm test` / `test:bun` / `test:deno`）。
- 目录里没有运行时业务逻辑，只有 3 个源文件：

| 文件                                | 行数 | 作用                                                 |
| ----------------------------------- | ---- | ---------------------------------------------------- |
| `eventsource-encoder/src/encode.ts` | 88   | 全部实现：`encode` / `encodeData` / `encodeComment`  |
| `eventsource-encoder/src/types.ts`  | 56   | 4 个类型：消息、注释、chunk 联合、字段文档注释       |
| `eventsource-encoder/src/index.ts`  | 2    | 纯 re-export                                         |
| `eventsource-encoder/test/`         | 99   | 22 个 vitest 用例，几乎全是「输入 → 精确字符串」对照 |

## 3. API

只有三个函数，全部同步、纯函数、无状态：

| 导出                     | 签名                                    | 作用                                                       |
| ------------------------ | --------------------------------------- | ---------------------------------------------------------- |
| `encode(chunk)`          | `(EventSourceChunk) => string`          | 主入口：消息或注释，二选一（`encode.ts:12`）               |
| `encodeData(text)`       | `(string) => string`                    | 只编码 data 段，逐行加 `data: ` 前缀（`encode.ts:24`）     |
| `encodeComment(comment)` | `(string) => string`                    | 只编码注释，逐行加 `: ` 前缀（`encode.ts:49`）             |
| `EventSourceMessage`     | `{data, event?, id?, retry?}`           | 消息结构（`types.ts:6`），`data` 是唯一必填字段            |
| `EventSourceComment`     | `{comment}`                             | 注释结构（`types.ts:38`）                                  |
| `EventSourceChunk`       | `Message \| {id} \| {retry} \| Comment` | 联合类型（`types.ts:52`），允许「只发 id」或「只发 retry」 |

`encode` 在运行时只做一次判别：`'comment' in chunk ? 注释 : 消息`（`encode.ts:13`）。所以如果同时传了 `comment` 和 `data`，**注释分支赢，data 被静默丢弃**。

## 4. 输出长什么样

字段顺序是写死的：**`event` → `retry` → `id` → `data`**（`encode.ts:55-77`）。规范不要求顺序（同一个块里都算同一条消息），固定顺序只是为了输出可预测、便于测试。

```js
encode({ data: 'foo' }); // 'data: foo\n\n'
encode({ event: 'foo', data: 'bar', retry: 15000, id: 1337 });
// 'event: foo\nretry: 15000\nid: 1337\ndata: bar\n\n'
```

### 4.1 关于 `retry` 和 `id`

- `retry` 只在 `typeof === 'number' && Number.isFinite()` 时输出（`encode.ts:60`）。所以 `retry: 0` **会**输出（0ms 重连，虽然不现实），而 `NaN` / `Infinity` 被静默跳过。
- `id` 接受 `string | number`（`encode.ts:64`）；数字直接插值，字符串要先过注入检查。
- 注意规范只接受**整数**毫秒的 retry：`encode({retry: 1.5})` 会老老实实输出 `retry: 1.5`，但客户端解析器会忽略它（实测 `eventsource-parser@4.1.3` 丢弃，见下方往返验证）。库不做这个校验。

## 5. 真正在处理的五件事

### 5.1 换行归一：`\r\n` / `\r` / `\n` 一律变 `\n`

`const NEWLINES_RE = /(\r\n|\r|\n)/g`（`encode.ts:3`）。`encodeData` 先 `` `${text}`.replace(NEWLINES_RE, '\n') ``（`encode.ts:25`），`encodeComment` 同理（`encode.ts:50`）。

这是**必要**的：`\r\n` 在事件流里是行结束符，如果把用户数据里的 `\r\n` 原样写出去，一个 `data` 值就会被拆成两行、在客户端被当成两个 data 行拼接（拼出来是 `\n` 而不是 `\r\n`），跨平台行为不一致。归一之后，无论用户给的是 `\n`、`\r\n` 还是老式 `\r`，客户端拿到的都是 `\n`。

**代价**：`\r` 信息丢失，无法往返还原。作者在 JSDoc 里明说了（`encode.ts:20-22`）。

### 5.2 多行 data 逐行加前缀，最后补空行

```ts
for (let i = 0, numLines = lines.length; i < numLines; ++i) {
  line = lines[i] || '';
  output += `data: ${line}`;
  output += i + 1 === numLines ? '\n\n' : '\n';
}
```

（`encode.ts:32-42`）

- 每行都以 `data: ` 开头（冒号后一个空格），这是规范里会被客户端剥掉的那一个空格。
- 只有最后一行补 `\n\n`（尾随空行 = 消息结束）。
- `lines[i] || ''` 兜住 `undefined`，所以以 `\n` 结尾的字符串会产生一个空的 `data: ` 行——**尾随空行被保留**，不是被吞掉：

```js
encodeData('what\n\nto\ndo\n\n');
// 'data: what\ndata: \ndata: to\ndata: do\ndata: \ndata: \n\n'
```

这点很关键：如果编码器「聪明地」裁掉尾随空行，那么 `data` 里的原文就被改了。

### 5.3 空字符串 data 也要发出去（1.0.1 的修复）

`encode({data: ''})` → `'data: \n\n'`。看似没意义，但按规范这正是**「派发一个 data 为空串的事件」**：客户端 data buffer 先变成 `\n`（非空），再在空行处裁掉最后一个 LF → 派发 `data: ''`。若改成不输出任何字符，客户端就永远收不到这个事件。对应 issue #1 的修复（`CHANGELOG.md` 1.0.1）。

判断条件用的是 `typeof message.data === 'string'`（`encode.ts:71`），所以**只有字符串才会被输出**；`encode({data: 42})` 返回空串 `''`（实测），不是 `data: 42`。类型层面挡得住，JS 里挡不住——这是这个库最容易被踩的坑，和 `encodeData` 的行为也不一致（后者用模板字符串强转，`encodeData(null)` → `'data: null\n\n'`）。

### 5.4 注释（心跳）

```js
encodeComment('nei\r\ndette'); // ': nei\n: dette\n\n'
```

`comment.replace(NEWLINES_RE, '\n: ')`——多行注释每行都带 `: `，保证不会被客户端误读成字段（`encode.ts:50`）。注释客户端读不到，用途是调试和**保活**（长连接防超时断开）。

### 5.5 防注入：`data` / `comment` 靠结构转义，`event` / `id` 靠直接拒绝

SSE 是行协议（`field: value`，换行分隔字段、空行分隔消息），所以**能带换行的未过滤文本一旦进了单行字段，就等于能往流里写新字段，甚至新消息**。1.0.1 及以前 `event` 就是这么被捅穿的（当时 `encode.ts:55` 只有一句 `output +=`）：

```js
// 攻击者控制事件名
encode({ event: 'message\ndata: pwned', data: 'hi' });
// 旧版本实际写出的字节：
event: message;
data: pwned;

event: fake;
data: hi;
```

一个「事件名」就能凭空捏造一整条 `{event: 'fake', data: 'hi'}`，可以冒充业务事件类型、绕前端的白名单。1.0.2 补的就是这个洞（`CHANGELOG.md`：「disallow newlines in event/id fields」）。

#### A. `data` / `comment`：结构性转义（不需要过滤，因为注入被吸收）

这两个字段没有「单行」假设：`encodeData` 先归一换行，再**逐行重新加前缀**（`encode.ts:25, 32-42`），`encodeComment` 同理（`encode.ts:50`）。攻击者塞进来的 `\n` 落地后只能是「同一字段的下一行」：

```js
encode({ data: 'ok\n\nevent: fake\ndata: pwned' });
// 'data: ok\ndata: \ndata: event: fake\ndata: data: pwned\n\n'
//  伪造的 event: / data: 都还是 data 的内容，客户端拼接后得到原文

encode({ comment: 'ok\nevent: fake\ndata: pwned' });
// ': ok\n: event: fake\n: data: pwned\n\n'   ← 全在注释里，客户端整段丢弃
```

这是**逃逸**而不是**过滤**：行的边界由编码器自己重写，不需要预判攻击长什么样。但前提是归一必须彻底——`NEWLINES_RE` 要把 `CRLF` / `CR` / `LF` 三种行结束符全收口（`encode.ts:3`），漏一个就又开了口子（见上文 §1）。

#### B. `event` / `id`：直接拒绝（没有「加前缀」的机会）

```ts
function assertSingleLine(field: 'event' | 'id', value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new TypeError(
      `EventSource \`${field}\` field must not contain newline characters (CR/LF)`,
    );
  }
}
```

（`encode.ts:82-87`）调用点只有两处：

| 位置           | 字段    | 条件                          |
| -------------- | ------- | ----------------------------- |
| `encode.ts:56` | `event` | 任何非空字符串                |
| `encode.ts:66` | `id`    | 仅当 `typeof id === 'string'` |

数字 id 天然安全（`String(1337)` 不可能含换行），跳过检查；`retry` 也不检查，`typeof === 'number' && Number.isFinite()` 已经排除了非数字字符（`encode.ts:60`）。

设计取向是**抛错，不做静默清洗**：删掉换行会改变语义（id 被改写 → 客户端 `Last-Event-ID` 对不上 → 断点续传错位），所以把决定权交给调用方。代价是这是**运行时异常**：若发生在响应头已发出之后，就没法再返 500，只能中断流。

#### 残留缺口

| 输入                                 | 结果                                      | 判断                                          |
| ------------------------------------ | ----------------------------------------- | --------------------------------------------- |
| `id: 'a\u0000b'`                     | 原样输出；客户端按规范忽略该 id，事件照发 | 无害                                          |
| `id: 'a\u2028b'`                     | 原样输出为同一行（SSE 只认 CR/LF）        | 无害                                          |
| `event: ''`                          | 被 `if (message.event)` 跳过              | 行为正确                                      |
| `event` 名字符任意（空格/大写/超长） | 原样输出，客户端接受任意字符串            | 不校验                                        |
| 用户可控内容进 `event` / `id`        | `TypeError` 冒到调用方                    | 调用方自己降级：白名单 / 兜底名 / `try-catch` |

两层缺一不可：`data` 的归一没做全，`event` 拒绝再严也没用（`data` 里漏出的 `\r` 同样能造行）；`event` 不拒绝，`data` 转义得再漂亮也会被一个事件名绕过。

## 6. 如果 `\r` 有意义：只能应用层编码

先把术语理顺。`\r` 是**转义写法**，代表码位 U+000D / `0x0D` 的字符 **CR**（Carriage Return，回车），和 `\n`（LF，U+000A）是两回事：

| 写法   | 字符 | 码位   | 字节    | 出处                          |
| ------ | ---- | ------ | ------- | ----------------------------- |
| `\n`   | LF   | U+000A | `0A`    | Unix / JSON / 网络传输默认    |
| `\r`   | CR   | U+000D | `0D`    | 老式 Mac OS（≤9）             |
| `\r\n` | CRLF | —      | `0D 0A` | Windows 文本 / HTTP 头 / SMTP |

`'\r'.length === 1`（**一个**控制字符），而 `JSON.stringify` 词出的 `\\r` 是**两个**可打印字符（反斜杠 + 字母 r）——这正是「想保留 CR 就只能转义」的根据。

### 6.1 为什么改库解决不了

规范把 `CRLF` / `LF` / `CR` **三者都定义为行结束符**，所以 `data:` 的值里出现裸 CR，客户端一定在那里断行：

| 写出的字节                 | 客户端解出        | 说明                                   |
| -------------------------- | ----------------- | -------------------------------------- |
| `data: a\rb\n\n`           | `{"data":"a"}`    | `b` **直接丢失**（成了无冒号的字段名） |
| `data: a\r\nb\n\n`         | `{"data":"a"}`    | 同上                                   |
| `data: a\nb\n\n`           | `{"data":"a\nb"}` | 唯一能保住结构的形式                   |
| `encode({data: 'a\r\nb'})` | `{"data":"a\nb"}` | 本库归一后的结果——已是最不坏的结果     |

也就是说：不归一时 `\r` 不仅保不住，还会**吃掉后面的内容**；归一后至少行结构还在（`\r` → `\n`）。所以 `encode.ts:20-22` 那句「carriage returns are lost」不是实现偷懒，而是协议上无解。

### 6.2 三种可用做法

1. **`JSON.stringify` 包一层（默认选择）**。`\r` 会变成两个字符 `\\r`，报文里没有任何裸 CR/LF，既还原得了原文、又天然免疫注入，还避开下文「前导空格」的坑：

   ```js
   const text = 'row1\r\nrow2\rcell\n end ';
   res.write(encode({ event: 'row', data: JSON.stringify({ text }) }));
   // 'data: {"text":"row1\\r\\nrow2\\rcell\\n end "}\n\n'

   const { text: back } = JSON.parse(ev.data);
   back === text; // true —— CR、CRLF、LF 逐字节还原（实测）
   ```

2. **base64**。有二进制/非 UTF-8 需求时用（`Buffer.from(bytes).toString('base64')`），输出只含 `[A-Za-z0-9+/=]`。
3. **契约里干脆不传 CR**。分隔符定死为 `\n`，不依赖 CRLF；代价是不能把用户上传的原始文本（可能带 CRLF）直接塞进 `data`。

若要「必须裸发 `\r` 且客户端已固定」，那就不是 SSE 能解决的问题，得换通道（自定义 header / JSON body 接口）。

### 6.3 两个相邻的坑

- **`data:` 后的第一个空格会被剥掉**：`data:  x`（两个空格）→ 客户端拿到 `" x"`（实测）。以空格开头的纯文本 payload 会丢一个字符；JSON / base64 都不以空格开头，天然规避。
- **只有 CR/LF 是行结束符**：`\0`、`U+2028`、`U+2029`、`\t` 都能原样穿过（实测 `data: a\u2028b` 解出 `"a\u2028b"`）。真需要特殊照顾的只有 `\r`，不必为它重写归一逻辑。

## 7. 边界行为（实测）

用 Node 24 直跑 `src/encode.ts` 得到：

| 调用                   | 输出                 | 说明                                     |
| ---------------------- | -------------------- | ---------------------------------------- |
| `encode({})`           | `''`                 | 什么都不发，返回空串（合法但无意义）     |
| `encode({data: ''})`   | `'data: \n\n'`       | 空事件，见上文 1.0.1                     |
| `encode({data: 42})`   | `''`                 | 非字符串 data 静默丢弃（`encode.ts:71`） |
| `encode({id: 'x'})`    | `'id: x\n\n\n'`      | 只发 id：会更新客户端 last event id      |
| `encode({retry: 0})`   | `'retry: 0\n\n\n'`   | 只发 retry：`0` 也输出                   |
| `encode({retry: NaN})` | `''`                 | `Number.isFinite` 过滤                   |
| `encode({retry: 1.5})` | `'retry: 1.5\n\n\n'` | 库不校验整数，客户端会忽略               |
| `encode({id: 0})`      | `'id: 0\n\n\n'`      | 数字 id 走插值                           |

注意「无 data 的 chunk」输出的是 **三个** 换行（`retry: 0\n` + `\n\n`，见 `encode.ts:73-76`）：严格说多了一个空行，协议里连续空行只是重复的「无事可派发」，解析器直接忽略，没有副作用——但不完全「well-formed 的最小输出」。

## 8. 和协议的对齐程度

| 层面                  | 本库                           | 谁负责                     |
| --------------------- | ------------------------------ | -------------------------- |
| 字段行格式、换行归一  | ✅                             | 本库                       |
| 消息结尾空行          | ✅                             | 本库                       |
| `event`/`id` 注入     | ✅（1.0.2 起）                 | 本库                       |
| `retry` 整数校验      | ❌ 只过滤 NaN/Infinity         | 调用方 / 客户端            |
| `data` 序列化         | ❌ 只接受 string               | 调用方（`JSON.stringify`） |
| `Content-Type` 等头部 | ❌                             | 调用方                     |
| 分块/flush/背压       | ❌ 返回字符串，写入自己来      | 调用方                     |
| 心跳/重连策略         | ❌ 只提供 `encodeComment` 原料 | 调用方                     |

一句话：它是**字节层**的库，从「一条消息对象」到「一段可以 `res.write()` 的字符串」，两端都不管。

## 9. 往返验证（和 `eventsource-parser` 对跑）

`eventsource-parser`（同作者的解码器，v4.1.3）直接 import `src/`，喂进编码器输出：

```js
parser.feed(
  encode({ id: 1, event: 'greet', data: 'hello\nworld' }) +
    encodeComment('keepalive') +
    encode({ data: '' }) +
    encode({ id: 2, data: 'multi\r\nline' }) +
    encode({ retry: 0 }) +
    encode({ retry: 1.5 }),
);
```

实测 `onEvent` 收到：

```json
[
  { "id": "1", "event": "greet", "data": "hello\nworld" },
  { "data": "" },
  { "id": "2", "data": "multi\nline" }
]
```

对齐结论：

- 多行 data 拼回 `\n`，`\r\n` 已被归一 → 原文 `\r\n` 不可还原（设计取舍，非 bug）。
- 注释、`retry`-only、`id`-only 都**不派发事件**，符合规范（注释纯丢弃；无 data 的消息按规范 abort dispatch）。
- `id` 在客户端侧变字符串。
- `retry: 0` 确实触发重连回调（实测 `onRetry(0)`），`retry: 1.5` 被解析器丢弃（非整数）。

## 10. 用法

最小可用的 Node 服务：

```js
import { createServer } from 'node:http';
import { encode, encodeComment } from 'eventsource-encoder';

createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const timer = setInterval(() => {
    res.write(
      encode({ id: Date.now(), event: 'tick', data: new Date().toISOString() }),
    );
  }, 1000);

  const heartbeat = setInterval(() => res.write(encodeComment('ping')), 15000);
  req.on('close', () => {
    clearInterval(timer);
    clearInterval(heartbeat);
  });
}).listen(3000);
```

实践建议（**不是库提供的**，是自己要补的）：

- 关掉压缩/缓冲（如 nginx 的 `X-Accel-Buffering: no`、`proxy_buffering off`），否则消息会被攒批。
- 结构化数据自己 `JSON.stringify`，并且**只发字符串**——传对象会静默变成空串。
- 客户端接管重连时，用 `id` 让浏览器发 `Last-Event-ID`，服务端自己实现断点续传。
- 有用户可控内容进 `event` / `id`（比如把请求参数当事件名）时，要么先做字符白名单，要么接住 `TypeError`——它不会自动降级。

## 11. 为什么 `EventSourceChunk` 是那个形状

```ts
export type EventSourceChunk =
  | EventSourceMessage
  | Pick<Required<EventSourceMessage>, 'id'>
  | Pick<Required<EventSourceMessage>, 'retry'>
  | EventSourceComment;
```

（`types.ts:52-56`）

`EventSourceMessage` 本身要求 `data`，所以两个 `Pick` 单独把「只发 id」和「只发 retry」放出来——这两个是协议里真正有意义的无 data 块：只发 id 会在多数客户端更新 last event id（类型注释里也写了，`types.ts:18-21`），只发 retry 用来调重连间隔。

**没有 `Pick<..., 'event'>`**：只带 `event`、不带 `data` 的消息会被客户端丢弃（data buffer 为空 → abort），所以类型层面干脆不允许。这种「用类型表达规范语义」的取舍在这个体量的库里算很克制。

## 12. 版本历史

| 版本  | 日期       | 变化                                                 |
| ----- | ---------- | ---------------------------------------------------- |
| 1.0.2 | 2026-04-27 | `event` / `id` 含 CR/LF 抛 `TypeError`（修字段注入） |
| 1.0.1 | 2025-02-12 | 空字符串 data 也输出 `data: \n\n`（#1）              |
| 1.0.0 | 2024-10-09 | 初始版本                                             |

仓库用 semantic-release（`.releaserc.json` + `@sanity/semantic-release-preset`），`CHANGELOG.md` 自动生成，发布走 npm trusted publishing / OIDC。

## 13. 同目录的相关库

- `eventsource-parser` —— 反方向：把字节流切成事件（同作者）。本库输出的对照方，做往返验证最方便。
- `eventsource` —— 浏览器/Node 客户端（EventSource 实现），消费端。
- `sse-channel` —— 另一套「服务端 SSE 通道」库，把连接管理、心跳、广播一起封装了；本库刻意不做这些。

选型上：只要「对象 → 字符串」这一步用本库；需要连接池/频道广播看 `sse-channel`；解析入站流用 `eventsource-parser`。
