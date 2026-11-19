import type { Config } from "../config.ts";
import { aheadBehind, changes, currentBranch, git, isRepo, reason } from "../git.ts";
import { result, type Options, type Result } from "../types.ts";

/**
 * 拉取远端主干并合进 learn。
 * 只做 fast-forward 或干净合并；冲突一律 merge --abort 回滚，批量跑完不留半合并状态。
 */
export async function sync(config: Config, options: Options): Promise<Result[]> {
  const results: Result[] = [];
  const learn = config.learnBranch;

  for (const lib of config.libs) {
    if (!(await isRepo(lib.dir))) {
      results.push(result(lib, "error", "尚未下载，先跑 pnpm libs:download"));
      continue;
    }

    const branch = await currentBranch(lib.dir);
    if (branch !== learn) {
      results.push(
        result(lib, "warn", `当前在 ${branch ?? "detached HEAD"}，先跑 pnpm libs:learn`),
      );
      continue;
    }

    const remote = `origin/${lib.baseBranch}`;
    if (options.dryRun) {
      results.push(result(lib, "info", `将 fetch ${remote} 并合进 ${learn}`));
      continue;
    }

    const fetched = await git(lib.dir, ["fetch", "origin", lib.baseBranch]);
    if (fetched.exitCode !== 0) {
      results.push(result(lib, "error", `fetch ${remote} 失败：${reason(fetched)}`));
      continue;
    }

    const diff = await aheadBehind(lib.dir, remote);
    if (!diff) {
      results.push(result(lib, "error", `本地没有 ${remote}，检查配置里的 baseBranch`));
      continue;
    }
    if (diff.behind === 0) {
      results.push(
        result(lib, "skip", diff.ahead > 0 ? `已最新（本地领先 ${diff.ahead} 个提交）` : "已最新"),
      );
      continue;
    }

    const { tracked } = await changes(lib.dir);
    if (tracked.length > 0 && !options.stash) {
      results.push(
        result(
          lib,
          "warn",
          `有 ${tracked.length} 个已跟踪改动，跳过合并（落后 ${diff.behind} 个）；加 --stash 自动暂存`,
          tracked,
        ),
      );
      continue;
    }

    const stashed = tracked.length > 0;
    if (stashed) {
      const stash = await git(lib.dir, ["stash", "push", "--quiet", "-m", "internal-libs: sync"]);
      if (stash.exitCode !== 0) {
        results.push(result(lib, "error", `git stash 失败：${reason(stash)}`));
        continue;
      }
    }

    const restore = async (): Promise<{ message: string; detail: string[] } | null> => {
      if (!stashed) return null;
      const popped = await git(lib.dir, ["stash", "pop", "--quiet"]);
      if (popped.exitCode === 0) return null;
      const conflicts = await git(lib.dir, ["diff", "--name-only", "--diff-filter=U"]);
      return {
        message: "改动恢复有冲突，内容仍在 git stash 里，工作区需手动解决",
        detail: conflicts.stdout.split("\n").filter(Boolean),
      };
    };

    const finish = async (message: string): Promise<Result> => {
      const issue = await restore();
      return issue
        ? result(lib, "warn", `${message}；${issue.message}`, issue.detail)
        : result(lib, "ok", message);
    };

    const fastForward = await git(lib.dir, ["merge", "--ff-only", remote]);
    if (fastForward.exitCode === 0) {
      results.push(await finish(`快进 ${diff.behind} 个提交到 ${remote}`));
      continue;
    }

    const merged = await git(lib.dir, ["merge", "--no-edit", "--no-verify", remote]);
    if (merged.exitCode === 0) {
      results.push(await finish(`合并 ${remote}（${diff.behind} 个提交）`));
      continue;
    }

    const conflicts = await git(lib.dir, ["diff", "--name-only", "--diff-filter=U"]);
    await git(lib.dir, ["merge", "--abort"]);
    await restore();
    results.push(
      result(
        lib,
        "error",
        "合并冲突，已 git merge --abort 回滚",
        conflicts.stdout.split("\n").filter(Boolean),
      ),
    );
  }

  return results;
}
