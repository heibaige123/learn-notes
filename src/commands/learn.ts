import type { Config } from "../config.ts";
import { currentBranch, git, hasBranch, isRepo, reason } from "../git.ts";
import { result, type Options, type Result } from "../types.ts";

/** 全部切到 learn：已有就切，没有就从当前 HEAD 新建 */
export async function learn(config: Config, options: Options): Promise<Result[]> {
  const results: Result[] = [];
  const target = config.learnBranch;

  for (const lib of config.libs) {
    if (!(await isRepo(lib.dir))) {
      results.push(result(lib, "error", "尚未下载，先跑 pnpm libs:download"));
      continue;
    }

    const current = await currentBranch(lib.dir);
    if (current === target) {
      results.push(result(lib, "skip", `已在 ${target}`));
      continue;
    }

    const exists = await hasBranch(lib.dir, target);
    if (options.dryRun) {
      results.push(
        result(
          lib,
          "info",
          exists ? `将切到已有 ${target}` : `将从 ${current ?? "HEAD"} 新建 ${target}`,
        ),
      );
      continue;
    }

    const switched = exists
      ? await git(lib.dir, ["switch", target])
      : await git(lib.dir, ["switch", "--create", target]);
    results.push(
      switched.exitCode === 0
        ? result(
            lib,
            "ok",
            exists ? `切到已有 ${target}` : `从 ${current ?? "HEAD"} 新建 ${target}`,
          )
        : result(lib, "error", `切分支失败：${reason(switched)}`),
    );
  }

  return results;
}
