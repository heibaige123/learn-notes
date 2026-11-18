# 仓库简述

> 对象：`json-schema` —— npm 包 `json-schema` 的上游仓库（作者 Kris Zyp）

## 1. 一句话

一个 **271 行的同步 JSON 校验器**，加一堆**规范历史快照**。仓库的重心在「别动」，不在「做新东西」。

## 2. 定位与状态

- 版本 `0.4.0`，README 开篇自称 **"This package is considered finished"**，并把最新规范的归属指向 [json-schema.org](https://json-schema.org/) 和 [json-schema-spec](https://github.com/json-schema-org/json-schema-spec)。
- **零运行时依赖**：`dependencies` 为空，`devDependencies` 只有一个 `vows`（测试框架）。
- 双许可证：`AFL-2.1 OR BSD-3-Clause`。
- 目录结构：

```
lib/           ← 唯一被发布的内容（package.json 的 files: ["lib"]）
test/          ← vows 写的自校验测试
draft-00..04/  ← 规范历史快照，不进 npm 包
*.xml ×2       ← IETF Internet-Draft 规范正文（draft-03 / draft-04）
```

## 3. 代码构成（共 335 行）

两个文件，都是 UMD 包装（AMD / CommonJS / 浏览器全局三用）。

### 3.1 `lib/validate.js`（271 行）— 主入口

`package.json` 的 `main` 指向它。导出：

| 导出                                           | 说明                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------ |
| `validate(instance, schema)`                   | 返回 `{valid: boolean, errors: [{property, message}]}`                         |
| `checkPropertyChange(value, schema, property)` | 校验「值能否合法地放进某属性」；比 `validate` 多一条——遇到 `readonly` 直接报错 |
| `mustBeValid(result)`                          | 结果不合法时抛 `TypeError`，把错误拼成可读文本                                 |
| `Integer`                                      | 语法糖，等于 `{type: "integer"}`                                               |

实现上只有两个闭包函数：`checkProp`（单个值）和 `checkObj`（对象），递归互调，全部同步。

行为细节：

- **错误路径是拼接出来的字符串**：`user.tags[0]` 这种形态，用 `path += ...` 逐层拼。
- **支持自校验**：实例上带 `$schema` 字段时会额外拿它校验一遍（`validate.js:247`、`256`）。
- **`type` 可以传 JS 构造函数**（`primitiveConstructors` 里有 `String`/`Number`/`Object`/`Array`/`Date`），走 `instanceof` 判断；否则按字符串类型名比较。
- 选项藏在内部 `options`：`coerce`（写回强转值）、`existingOnly`（跳过未定义属性）、`filter`（删掉多余属性而非报错）。`validate` 只暴露 `changing: false` 的默认路径。

实测输出（`node -e` 跑的）：

```js
validate(
  { name: 1, age: 'x' },
  {
    type: 'object',
    properties: {
      name: { type: 'string' },
      age: { type: 'integer', minimum: 0 },
    },
  },
);
// → {"valid":false,"errors":[
//      {"property":"name","message":"1 - number value found, but a string is required"},
//      {"property":"age","message":"x - string value found, but a integer is required"}]}
```

（注意最后那句 `a integer` —— 消息模板是 `"a " + type` 硬拼的，语法小坑，用它的错误文本做断言时会被这个绊到。）

### 3.2 `lib/links.js`（64 行）— hyper-schema 的 links

与校验无关，纯粹读 schema 里的 `links` 数组：

| 导出                                  | 说明                                        |
| ------------------------------------- | ------------------------------------------- |
| `getLink(relation, instance, schema)` | 按 `rel` 找链接，再用实例值填充 `href` 模板 |
| `substitute(template, instance)`      | `{prop}` 占位符替换（本质是模板字符串渲染） |
| `cacheLinks`                          | 开关，缓存解析后的 link 集合                |

## 4. 测试实际在做什么

`test/tests.js`（153 行）并不测业务用例，而是**用校验器去校验 draft-03 的四份 schema 本身**：

```js
var revision = 'draft-03';
var schemaNames = ['schema', 'hyper-schema', 'links', 'json-ref'];
```

每个文件加载两次 —— 一次原样，一次删掉 `$schema` 再校验（`tests.js:20` 那段 `n = name+'-nsd'`）。这是 `draft-0*` 目录在本仓库里**唯一的实际用途**：不是运行时读取，是测试拿来自我验证。

## 5. 和规范的关系

本仓库实现停在 **draft-02 之前的关键字**（布尔版 `required`、`extends`、`disallow`、`maxDecimal`），draft-03 引入的 `$ref` / `patternProperties` / `dependencies` / `uniqueItems` / `exclusiveMinimum` 一个都没实现。`$ref` 在校验器眼里只是普通属性，**不会解引用**。

所以：**这不是一个能跑现代 JSON Schema 的库**。它能活十几年，靠的正是冻结——README 明说为了「依赖它的无数包的行为与体积稳定」而不追规范。

各版本之间的具体演进见 [draft-versions.md](draft-versions.md)。

## 6. 一句话使用建议

- 要在新项目里校验 JSON Schema → 用 `ajv`，别用这个。
- 想读「校验器最小可行实现」或「早期规范长什么样」→ 这是很好的样本，335 行能一次读完。
- 遇到老项目 `require('json-schema')` 报错行为奇怪 → 先确认它只支持 draft-02 时代的关键字。
