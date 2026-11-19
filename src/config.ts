import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Lib {
  /** 库名：projects/ 下的目录名，也是 --only 的取值 */
  name: string;
  url: string;
  /** 远端主干分支 */
  baseBranch: string;
  /** 本地绝对路径 */
  dir: string;
}

export interface Config {
  root: string;
  learnBranch: string;
  libs: Lib[];
}

class ConfigError extends Error {
  override name = "ConfigError";
}

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_CONFIG = "libraries.config.json";

export async function loadConfig(
  options: { configPath?: string; root?: string } = {},
): Promise<Config> {
  const file = resolve(PROJECT_ROOT, options.configPath ?? DEFAULT_CONFIG);
  const source = await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    throw new ConfigError(
      error.code === "ENOENT" ? `找不到配置文件：${file}` : `读不了配置文件：${error.message}`,
    );
  });

  const data = parse(source, file);
  if (!Array.isArray(data.libs) || data.libs.length === 0) {
    throw new ConfigError("配置需要非空的 libs 数组");
  }

  const root = resolve(dirname(file), options.root ?? str(data.root) ?? "projects");
  const learnBranch = branchName(str(data.learnBranch) ?? "learn", "learnBranch");
  const seen = new Set<string>();

  const libs = data.libs.map((raw, index): Lib => {
    const where = `libs[${index}]`;
    if (!isRecord(raw)) throw new ConfigError(`${where} 必须是对象`);

    const name = str(raw.name);
    if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
      throw new ConfigError(`${where}.name 缺失或含非法字符（只允许字母、数字、. _ -）`);
    }
    if (seen.has(name)) throw new ConfigError(`重复的库名：${name}`);
    seen.add(name);

    const url = str(raw.url);
    if (!url) throw new ConfigError(`${where}.url 不能为空（${name}）`);

    return {
      name,
      url,
      baseBranch: branchName(str(raw.baseBranch) ?? "main", `${where}.baseBranch`),
      dir: resolve(root, name),
    };
  });

  return { root, learnBranch, libs };
}

/** `--only ai,genkit` 过滤；出现未知库名直接报错，避免静默漏跑 */
export function selectLibs(libs: Lib[], only: string | undefined): Lib[] {
  const names = (only ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) return libs;

  const unknown = names.filter((name) => !libs.some((lib) => lib.name === name));
  if (unknown.length > 0) throw new ConfigError(`--only 里有未知的库：${unknown.join(", ")}`);

  return libs.filter((lib) => names.includes(lib.name));
}

function parse(source: string, file: string): Record<string, unknown> {
  try {
    const data: unknown = JSON.parse(source);
    if (!isRecord(data)) throw new Error("顶层必须是对象");
    return data;
  } catch (error) {
    throw new ConfigError(`配置文件不合法（${file}）：${(error as Error).message}`);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

function branchName(value: string, field: string): string {
  if (/[\s~^:?*[\\]/.test(value)) throw new ConfigError(`${field} 不是合法分支名：${value}`);
  return value;
}
