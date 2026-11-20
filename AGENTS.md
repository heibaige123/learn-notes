# learn-notes

学习笔记仓库。上游源码克隆在 `projects/<repo>/`（`ai`、`json-schema`、`eventsource-encoder` …），笔记在 `notes/<project>/`（`notes/` 整体是一个 Obsidian vault，`.obsidian/` 已 gitignore）。笔记只作学习材料，不参与构建、发布和 CI。

改笔记前先读下面的规则。

`projects/` 下的克隆由根目录 TypeScript 工具管理（`tsx` 直接跑源码，无需构建）：库清单在 `libraries.config.json`，代码在 `src/`，不要手写 clone；新增库只改配置。

| 命令 | 作用 |
| --- | --- |
| `pnpm libs:download` | 克隆清单里缺失的库 |
| `pnpm libs:learn` | 全部切到 `learn` 分支 |
| `pnpm libs:sync` | 拉取远端主干最新提交并合进 `learn` |
| `pnpm libs:status` | 巡检分支 / 落后 / 脏文件 |

改代码后跑 `pnpm check`（typecheck + oxlint + oxfmt）；单文件不超过 200 行，`projects/` 和 `notes/` 不参与 lint/format。

查上游源码符号用 codegraph，别 grep：`projects/` 下每个库各有独立索引（`<repo>/.codegraph/`，`codegraph init --local-only` 建的，不进 git）。在库目录里跑 `codegraph explore "<符号或问题>"`，或在会话里用 `codegraph_explore` 带上 `projectPath`；改完源码（`pnpm libs:sync` 之后）跑 `codegraph sync`。仓库根和 `notes/` 没有索引——那是笔记，不是代码。

## 1. 引用

1. **不写 `projects/` 前缀**：引用本仓库里的文件或整仓，一律从项目目录名写起。
   - 写 `eventsource-encoder/src/encode.ts`，不写 `projects/eventsource-encoder/src/encode.ts`
   - 写 `ai/`、`json-schema`，不写 `projects/ai/`、`projects/json-schema`
   - 理由：`projects/` 只是放上游克隆的容器目录，读者要的是「哪个项目 + 项目内哪个文件」；跨项目靠项目名已足够消歧。
2. **路径一律相对**：文档之间用相对链接（`../core/...`），不写绝对路径。
3. **每条结论带证据**：路径跟第 1 条一样，从项目目录名写起，锚在符号名上。
   - 写 `ai/packages/ai/src/generate-text/stream-text.ts` 的 `streamText`，或 `eventsource-encoder/src/encode.ts` 的 `encodeData`
   - 不写 `packages/.../file.ts:123`：`packages/` 只是 `ai` 仓库内部目录，其它项目没有这一层
   - 行号可附（`:123`），但会随上游漂移；对不上时按函数名搜，不以行号为准

## 2. 结构

1. **不维护 `templates/`**：不再有模板文件。新增问题时格式照抄已有条目 —— `## Q：…` 加「背景 / 我的假设 / 验证方式 / 结论 / 证据 / 相关」六段。
2. **有内容才建文件，不预建空壳**：主题文档放已确认的机制，`questions.md` 放还没查清的问题；问题查清后把结论回填主题文档，并从清单删掉。
3. **标题带序列号**：h2 写 `## 1. 标题`，h3 写 `### 1.1 标题`（跟 `architecture/ai-sdk-architecture.md` 一致），每个文件从 1 起、不跨文件连号；`## Q：` 条目不加序号（那是条目不是章节）；前置速览类可用 `## 0.`（如 `stream-text-walkthrough.md` 的全局速览）。

## 3. 可读

1. **多画图，先图后文**：流程、分层、状态机、多步调用、字段怎么变，先给一张图再写正文。人扫一眼要能跟上，不要用三段文字代替一张图。
   - **图一律用 Mermaid**：分层、依赖、调用链、状态机、分支判定、时序 → `flowchart` / `stateDiagram-v2` / `classDiagram` / `sequenceDiagram`；目录树、文件清单、字段清单也一样（一个条目一个节点，行数和注释塞进 label）。跟 `vercel-ai/core/stream-text-walkthrough.md` 的全局速览同一风格。
   - ASCII 只给原始报文、日志、逐字节走位这类「必须逐字符对齐」的内容，不进图。
   - 用 `flowchart` 不用老的 `graph`；label 含 `[]{}()<>|&` 或引号时整个 label 加双引号并转义（`&lt;` `&gt;` `&quot;`）；`<br/>` 换行。
   - 图上标文件名和关键函数，箭头旁写这一步做了什么。一张图只讲一件事。
   - 纯清单、单点事实、`## Q：` 条目不用画。
2. 中文正文，代码标识符保留原文。
