import { stat } from "node:fs/promises";
import { execa } from "execa";

/** 所有 git 调用都禁掉交互式凭据提示，避免无人值守时挂住 */
const env = { GIT_TERMINAL_PROMPT: "0" };

/** git 包装：非零退出不抛错，由调用方判 exitCode */
export function git(cwd: string, args: string[]) {
  return execa("git", args, { cwd, reject: false, env });
}

export async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function isRepo(dir: string): Promise<boolean> {
  return (await exists(dir)) && (await git(dir, ["rev-parse", "--git-dir"])).exitCode === 0;
}

/** 当前分支；detached HEAD 返回 null */
export async function currentBranch(dir: string): Promise<string | null> {
  const result = await git(dir, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

export async function hasBranch(dir: string, name: string): Promise<boolean> {
  const result = await git(dir, [
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/heads/${name}^{commit}`,
  ]);
  return result.exitCode === 0;
}

interface Changes {
  tracked: string[];
  untracked: string[];
}

/** `git status --porcelain` 每行是 `XY path`，固定前三个字符 */
const pathOf = (line: string) => line.slice(3).trim();

export async function changes(dir: string): Promise<Changes> {
  const result = await git(dir, ["status", "--porcelain"]);
  const lines = result.exitCode === 0 ? result.stdout.split("\n").filter(Boolean) : [];
  return {
    tracked: lines.filter((line) => !line.startsWith("??")).map(pathOf),
    untracked: lines.filter((line) => line.startsWith("??")).map(pathOf),
  };
}

/** `HEAD` 相对 ref 的领先/落后；ref 不存在返回 null */
export async function aheadBehind(
  dir: string,
  ref: string,
): Promise<{ ahead: number; behind: number } | null> {
  const result = await git(dir, ["rev-list", "--left-right", "--count", `HEAD...${ref}`]);
  if (result.exitCode !== 0) return null;
  const [ahead = 0, behind = 0] = result.stdout.trim().split(/\s+/).map(Number);
  return { ahead, behind };
}

export async function originUrl(dir: string): Promise<string | null> {
  const result = await git(dir, ["remote", "get-url", "origin"]);
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

/** 已有 origin 就改地址，没有就新增 */
export async function setOrigin(dir: string, url: string) {
  const current = await originUrl(dir);
  return git(
    dir,
    current ? ["remote", "set-url", "origin", url] : ["remote", "add", "origin", url],
  );
}

export async function lastCommit(dir: string): Promise<string> {
  const result = await git(dir, ["log", "-1", "--format=%h %s"]);
  return result.exitCode === 0 ? result.stdout.trim() : "";
}

/** 从 git 输出里挑最有用的一行 */
export function reason(result: { stdout: string; stderr: string }): string {
  const lines = `${result.stderr}\n${result.stdout}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? "未知错误";
}
