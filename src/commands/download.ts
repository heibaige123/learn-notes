import type { Config } from "../config.ts";
import { exists, git, isRepo, originUrl, reason, setOrigin } from "../git.ts";
import { result, type Options, type Result } from "../types.ts";

/** 克隆缺失的库；已存在的只把 origin 校正成配置里的 url */
export async function download(config: Config, options: Options): Promise<Result[]> {
  const results: Result[] = [];

  for (const lib of config.libs) {
    if (await isRepo(lib.dir)) {
      const current = await originUrl(lib.dir);
      if (current === lib.url) {
        results.push(result(lib, "skip", "已存在"));
        continue;
      }
      if (options.dryRun) {
        results.push(result(lib, "info", `将把 origin 改成 ${lib.url}`));
        continue;
      }
      const changed = await setOrigin(lib.dir, lib.url);
      results.push(
        changed.exitCode === 0
          ? result(lib, "ok", `origin ${current ?? "(无)"} → ${lib.url}`)
          : result(lib, "error", `改 origin 失败：${reason(changed)}`),
      );
      continue;
    }

    if (await exists(lib.dir)) {
      results.push(result(lib, "error", "目录已存在但不是 git 仓库"));
      continue;
    }
    if (options.dryRun) {
      results.push(result(lib, "info", `将克隆 ${lib.url}`));
      continue;
    }

    const cloned = await git(config.root, ["clone", lib.url, lib.dir]);
    results.push(
      cloned.exitCode === 0
        ? result(lib, "ok", `已克隆 ${lib.url}`)
        : result(lib, "error", `克隆失败：${reason(cloned)}`),
    );
  }

  return results;
}
