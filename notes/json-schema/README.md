# json-schema 笔记

[origin](https://github.com/kriszyp/json-schema) · npm `json-schema@0.4.0` · 上游 README 自述 "finished"

这个仓库真正能跑的只有 335 行：一个校验器 `validate.js`（271 行）加一个链接解析器 `links.js`（64 行），其余全是规范快照。

## 怎么读

| 顺序 | 文档                                       | 读完能回答                                     |
| ---- | ------------------------------------------ | ---------------------------------------------- |
| 1    | [仓库导览](overview.md)                    | 这仓库是什么、为什么一直不更新、哪里值得看     |
| 2    | [跟着 validate.js 走一遍](validate-walkthrough.md) | 一次 `validate()` 调用从头到尾发生了什么 |
| 3    | [会咬人的地方](quirks.md)                  | 为什么它对某些写法完全没反应                   |
| 4    | [draft 目录在讲什么](draft-versions.md)    | 五份快照差在哪，以及实现停在哪一代             |

想边看边试，开个 node 就行：

```bash
cd projects/json-schema
node -e 'console.log(require("./lib/validate.js").validate({a: 1}, {properties: {a: {type: "string"}}}))'
```
