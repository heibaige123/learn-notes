# 为什么有好几个 draft 目录

> 对象：`json-schema` —— kriszyp 的老版 `json-schema` npm 包（v0.4.0，README 自述 "finished"）

## 1. 一句话结论

`draft-0*` 目录**不是代码模块**，是每一版 JSON Schema 规范的 **meta-schema 快照**，纯存档。运行时一行都不读：

- `grep -r "draft-" lib/` 无命中
- `package.json` 的 `files: ["lib"]` 把它们排除在发布包之外

## 2. 每个 draft 目录里是什么

四份自描述的 schema（用 schema 描述 schema 本身）：

| 文件           | 作用                                                                            |
| -------------- | ------------------------------------------------------------------------------- |
| `schema`       | 核心校验关键字（type / properties / items / …）的元 schema                      |
| `hyper-schema` | 在 core 上叠加超媒体：`links`、`readonly`、`pathStart`                          |
| `links`        | Link Description Object 的 schema（href / rel / method / …）                    |
| `json-ref`     | 独立的 JSON Reference 规范；draft-00~03 有，draft-04 并入 core 的 `$ref` 后删除 |

另外：

- `draft-03/examples/` — 5 个手写示例（address / calendar / card / geo / interfaces），对应规范附录
- 根目录 `draft-zyp-json-schema-03.xml` / `-04.xml` — **规范正文**（IETF Internet-Draft 的 XML 源，Kris Zyp 署名 draft-zyp）

## 3. 版本演进（按 `schema` 的关键字集合做逐版 diff）

### 3.1 draft-00 → draft-01：只改 URI

字节级只差 URL 命名空间（commit `8c1e8af` _"Schema URIs are now namespace versioned"_）。

即 draft-01 的全部意义就是「URI 带版本号」，语义零变化 —— 所以打开这两份文件会觉得完全重复。别误判成仓库冗余。

### 3.2 draft-01 → draft-02

```
+ uniqueItems
+ divisibleBy
- maxDecimal
```

### 3.3 draft-02 → draft-03：最大的语义断裂

现代 JSON Schema 的骨架到这里才成型。

| 变化              | 细节                                                                            |
| ----------------- | ------------------------------------------------------------------------------- |
| `required` 改形态 | 从布尔 `{"required": true}` → 字符串数组 `{"required": ["a","b"]}`              |
| 删除              | `optional`、`requires`、`minimumCanEqual`、`maximumCanEqual`                    |
| 换成              | `exclusiveMinimum`、`exclusiveMaximum`                                          |
| 新增              | `$ref`、`$schema`、`id`、`patternProperties`、`additionalItems`、`dependencies` |

### 3.4 draft-03 → draft-04

```
+ minProperties
+ maxProperties
```

- `id`：从 `{"type":"string","format":"uri"}` 降级成裸 `{"type":"string"}`
- `type`：抽出 `#simple-type` 定义（枚举里加入 `"any"`），items 改为 `$ref` 到它

## 4. 代码只实现到 draft-02/03 的子集

`lib/validate.js`（271 行）仍是老式实现，`checkProp` 里读的是**布尔版** `schema.required`，以及 `schema.extends`、`schema.disallow`、`maxDecimal` —— 全是 draft-03 之前的关键字。

draft-03 的新关键字**一个都没实现**（grep 无命中）：

`divisibleBy`、`uniqueItems`、`patternProperties`、`dependencies`、`additionalItems`、`exclusiveMinimum/Maximum`

`test/tests.js:9` 虽然写着 `var revision = 'draft-03'`，测的也是这套老关键字，字样和实现并不对应。

> **为什么这个包能在 npm 上活那么久**：恰恰因为它**不追规范**。README 明说为了「依赖它的无数包的行为与体积稳定」而冻结在原始实现上。

## 5. 两个坑

1. **本仓库的 `draft-04/schema` 是不完整副本**：里面**没有 `format` 关键字**（真实 draft-04 规范有）。别拿它当 draft-04 权威参考 —— 要查规范用 `draft-zyp-json-schema-04.xml` 或 json-schema.org。
2. **draft-00 / draft-01 内容几乎完全相同**，只是历史 URI 兼容层，不是冗余文件。

## 6. 阅读路径

| 想知道                         | 看哪里                                                                 |
| ------------------------------ | ---------------------------------------------------------------------- |
| 规范说了什么                   | `draft-03/schema` + `draft-zyp-json-schema-03.xml`                     |
| 校验器最小实现长什么样         | `lib/validate.js` —— `checkProp` / `checkObj` 两个闭包函数就是全部     |
| hyper-schema 的 links 怎么落地 | `lib/links.js` —— `getLink` 从 schema 的 `links` 里按 rel 取 href 模板 |

## 7. 关键提交

| commit                 | 内容                                                         |
| ---------------------- | ------------------------------------------------------------ |
| `8c1e8af` (2010-11-11) | URI 命名空间版本化，一次性加入 draft-00/01/02/03 全部 schema |
| `e22117f` (2011-11-15) | 初版 draft-04 schema，规范正文加入 JSON Pointer              |
