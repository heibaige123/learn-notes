import type { Config } from "../config.ts";
import { aheadBehind, changes, currentBranch, hasBranch, isRepo, lastCommit } from "../git.ts";
import type { StatusRow } from "../types.ts";

/** 只读巡检；差距基于本地缓存的 origin/<base>，要最新数据先跑 sync */
export async function status(config: Config): Promise<StatusRow[]> {
  const rows: StatusRow[] = [];

  for (const lib of config.libs) {
    if (!(await isRepo(lib.dir))) {
      rows.push({ name: lib.name, missing: true });
      continue;
    }

    const branch = await currentBranch(lib.dir);
    const diff = await aheadBehind(lib.dir, `origin/${lib.baseBranch}`);
    const { tracked, untracked } = await changes(lib.dir);

    rows.push({
      name: lib.name,
      missing: false,
      branch,
      onLearn: branch === config.learnBranch,
      hasLearn: await hasBranch(lib.dir, config.learnBranch),
      ahead: diff?.ahead,
      behind: diff?.behind,
      changes: tracked.length + untracked.length,
      lastCommit: await lastCommit(lib.dir),
    });
  }

  return rows;
}
