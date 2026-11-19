import { Command } from "commander";
import { createColors } from "picocolors";
import stringWidth from "string-width";

import { loadConfig, selectLibs, type Config } from "./config.ts";
import { download } from "./commands/download.ts";
import { learn } from "./commands/learn.ts";
import { status } from "./commands/status.ts";
import { sync } from "./commands/sync.ts";
import type { Level, Options, Result, StatusRow } from "./types.ts";
import pkg from "../package.json" with { type: "json" };

type Palette = ReturnType<typeof createColors>;

interface GlobalOptions extends Partial<Options> {
  only?: string;
  config?: string;
  root?: string;
  json?: boolean;
  color: boolean;
}

interface Context {
  json: boolean;
  color: boolean;
  config: Config;
}

const program = new Command("internal-libs")
  .description("learn-notes 内部库：下载 / 切 learn / 同步上游主干")
  .version(pkg.version)
  .showHelpAfterError()
  .option("--only <names>", "只处理指定库，逗号分隔")
  .option("--config <path>", "配置文件（默认 libraries.config.json）")
  .option("--root <dir>", "覆盖库根目录（默认取配置 root）")
  .option("--dry-run", "只打印将要执行的动作")
  .option("--json", "输出 JSON")
  .option("--no-color", "关闭颜色");

program
  .command("download")
  .description("克隆缺失的库；已存在的只校正 origin")
  .alias("clone")
  .action(wrap("download", download, printResults));

program
  .command("learn")
  .description("全部切到 learn 分支（没有就从当前 HEAD 新建）")
  .alias("switch")
  .action(wrap("learn", learn, printResults));

program
  .command("sync")
  .description("拉取远端主干最新提交并合进 learn")
  .alias("update")
  .option("--stash", "合并前 git stash 已跟踪改动，合并后自动 pop")
  .action(wrap("sync", sync, printResults));

program
  .command("status")
  .description("巡检分支、领先/落后、改动与最新提交")
  .alias("st")
  .action(wrap("status", status, printStatus));

function wrap<T>(
  name: string,
  run: (config: Config, options: Options) => Promise<T>,
  print: (value: T, context: Context) => void,
) {
  return async (_raw: unknown, command: Command) => {
    const options = command.optsWithGlobals<GlobalOptions>();
    const palette = createColors(options.color);
    try {
      const loaded = await loadConfig({ configPath: options.config, root: options.root });
      const config: Config = { ...loaded, libs: selectLibs(loaded.libs, options.only) };
      const context: Context = { json: Boolean(options.json), color: options.color, config };

      if (!context.json) {
        console.log(
          palette.bold(`${name} · ${config.libs.length} 个库 · learn 分支 ${config.learnBranch}`),
        );
      }

      const value = await run(config, {
        dryRun: Boolean(options.dryRun),
        stash: Boolean(options.stash),
      });
      print(value, context);

      if (Array.isArray(value) && value.some((item) => (item as Result).level === "error")) {
        process.exitCode = 1;
      }
    } catch (error) {
      process.stderr.write(
        `${palette.red(error instanceof Error ? error.message : String(error))}\n`,
      );
      process.exitCode = 1;
    }
  };
}

const GLYPH: Record<Level, (palette: Palette) => string> = {
  ok: (palette) => palette.green("✔"),
  skip: (palette) => palette.gray("·"),
  warn: (palette) => palette.yellow("!"),
  error: (palette) => palette.red("✖"),
  info: (palette) => palette.cyan("›"),
};

function printResults(results: Result[], { json, color }: Context): void {
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  const palette = createColors(color);
  for (const item of results) {
    console.log(
      `${GLYPH[item.level](palette)} ${palette.bold(item.name.padEnd(20))} ${item.message}`,
    );
    for (const line of item.detail ?? []) console.log(`  ${palette.dim(`└ ${line}`)}`);
  }

  const count = (level: Level) => results.filter((item) => item.level === level).length;
  console.log(
    `\n完成：${count("ok")} 成功 · ${count("skip")} 跳过 · ${count("warn")} 警告 · ${count("error")} 失败`,
  );
}

function printStatus(rows: StatusRow[], { json, config }: Context): void {
  if (json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const header = ["lib", "branch", "learn", "ahead", "behind", "changes", "last commit"];
  const cells = rows.map((row) =>
    row.missing
      ? [row.name, "（未下载）", "—", "—", "—", "—", ""]
      : [
          row.name,
          row.branch ?? "detached",
          row.onLearn ? "● 当前" : row.hasLearn ? "◐ 有" : "○ 无",
          String(row.ahead ?? "?"),
          String(row.behind ?? "?"),
          String(row.changes ?? 0),
          row.lastCommit ?? "",
        ],
  );

  console.log(table(header, cells));

  const missing = rows.filter((row) => row.missing).length;
  const offLearn = rows.filter((row) => !row.missing && !row.onLearn).length;
  console.log(`\nlearn 分支：${config.learnBranch}　未下载：${missing}　不在 learn：${offLearn}`);
  console.log("ahead/behind 基于本地缓存的 origin/<base>，跑 pnpm libs:sync 拉最新后再看。");
}

/** 等宽表格；CJK 用 string-width 计宽度 */
function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, index) =>
    Math.max(stringWidth(cell), ...rows.map((row) => stringWidth(row[index] ?? ""))),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, index) =>
        index === cells.length - 1 ? cell : cell + " ".repeat(widths[index]! - stringWidth(cell)),
      )
      .join("  ")
      .trimEnd();
  return [header, ...rows].map(line).join("\n");
}

// 放在文件末尾：action 里用到的 GLYPH/表格函数必须先初始化
if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  await program.parseAsync();
}
