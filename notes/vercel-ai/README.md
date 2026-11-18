[origin](https://github.com/vercel/ai)

# AI SDK 源码笔记

记录阅读 `vercel/ai` 源码过程中的疑问、结论与心得。这里只放学习材料，不参与构建、发布和 CI。源码克隆在 `ai/`，笔记独立在本仓库的 `notes/vercel-ai/`。

## 1. 文件分两类

| 类型     | 位置                                             | 作用                                       |
| -------- | ------------------------------------------------ | ------------------------------------------ |
| 主题文档 | `architecture/`、`core/`                         | 已经查清的机制，按主题成文，可直接当参考读 |
| 问题清单 | `architecture/questions.md`、`core/questions.md` | 还没查清的疑问，一条一个 Q                 |

## 2. 已有文档

| 文件                                                                                 | 内容                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [`architecture/ai-sdk-architecture.md`](./architecture/ai-sdk-architecture.md)       | 静态地图：仓库布局、分层、有哪些机制                                       |
| [`core/stream-text-walkthrough.md`](./core/stream-text-walkthrough.md)               | 动态走位：一次 `streamText()` 调用按什么顺序穿过哪些文件                   |
| [`core/examples-reading-path.md`](./core/examples-reading-path.md)                   | `examples/` 怎么读：6 层示例路线、每层对照的源码、其它 demo 目录用途       |
| [`architecture/provider-package.md`](./architecture/provider-package.md)             | `@ai-sdk/provider` 单包简述：规范层接口、多版本共存、目录构成              |
| [`architecture/provider-utils-package.md`](./architecture/provider-utils-package.md) | `@ai-sdk/provider-utils` 单包简述：HTTP/响应解析/schema/媒体识别/安全/流式 |
| [`architecture/questions.md`](./architecture/questions.md)                           | 架构层未决问题（停止条件、重试、v3/v4 适配、UI 消息流）                    |
| [`core/questions.md`](./core/questions.md)                                           | `packages/ai` 未决问题（part 缓冲时序、低内存模式）                        |

主题文档与问题清单的分工：**能确认的并进主题文档，查不清的留在 questions**；问题解决后把结论回填，并从清单里删掉。

**从哪开始**：先跑示例、把 API 形状钉死 —— 按 [`core/examples-reading-path.md`](./core/examples-reading-path.md) 从第 0 层往上走；再按 [`architecture/ai-sdk-architecture.md`](./architecture/ai-sdk-architecture.md) §6 读源码；中间想看清一次 `streamText()` 的走位，就读 [`core/stream-text-walkthrough.md`](./core/stream-text-walkthrough.md)。

## 3. 写作要求

- **每条结论带证据**：写成 `packages/.../file.ts:123`。行号会随源码演进漂移，失效时按函数名搜。
- **路径相对**：文档之间用相对链接（`../core/...`），不写绝对路径。
- **未确认的别伪装成结论**：写进 `questions.md`，按「背景 / 我的假设 / 验证方式 / 结论 / 证据 / 相关」六段填；结论留空就是待办。不再维护 `templates/`，格式直接照抄已有条目。
- 中文正文，代码标识符保留原文。

## 4. Obsidian

`notes/` 整体是一个 vault，`.obsidian/` 在 vault 根目录，已在 [`../.gitignore`](../.gitignore) 中排除（主题 CSS 上万行，会让格式化检查失败）。

笔记已移出 `ai/`（那是上游克隆，改动会被 `git clean`/切换分支带走），因此不再受该仓库 `pnpm check` 的 oxfmt 规则约束——Markdown 手工保持格式一致即可。
