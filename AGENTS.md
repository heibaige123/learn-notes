# learn-notes

学习笔记仓库。上游源码克隆在 `projects/<repo>/`（`ai`、`json-schema`、`eventsource-encoder` …），笔记在 `notes/<project>/`（`notes/` 整体是一个 Obsidian vault，`.obsidian/` 已 gitignore）。笔记只作学习材料，不参与构建、发布和 CI。

## 文档规则（改笔记前先读）

1. **不写 `projects/` 前缀**：引用本仓库里的文件或整仓，一律从项目目录名写起。
   - 写 `eventsource-encoder/src/encode.ts`，不写 `projects/eventsource-encoder/src/encode.ts`
   - 写 `ai/`、`json-schema`，不写 `projects/ai/`、`projects/json-schema`
   - 理由：`projects/` 只是放上游克隆的容器目录，读者要的是「哪个项目 + 项目内哪个文件」；跨项目靠项目名已足够消歧。
2. **不维护 `templates/`**：不再有模板文件。新增问题时格式照抄已有条目 —— `## Q：…` 加「背景 / 我的假设 / 验证方式 / 结论 / 证据 / 相关」六段。
3. **有内容才建文件，不预建空壳**：主题文档放已确认的机制，`questions.md` 放还没查清的问题；问题查清后把结论回填主题文档，并从清单删掉。
4. **路径一律相对**：文档之间用相对链接（`../core/...`），不写绝对路径。
5. **每条结论带证据**：源码引用写成 `packages/.../file.ts:123`；行号会随上游演进漂移，失效时按函数名搜而不是按行号。
6. **标题带序列号**：h2 写 `## 1. 标题`，h3 写 `### 1.1 标题`（跟 `architecture/ai-sdk-architecture.md` 一致），每个文件从 1 起、不跨文件连号；`## Q：` 条目不加序号（那是条目不是章节）；前置速览类可用 `## 0.`（如 `stream-text-walkthrough.md` 的全局速览）。
7. 中文正文，代码标识符保留原文。