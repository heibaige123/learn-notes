import type { Lib } from "./config.ts";

export type Level = "ok" | "skip" | "warn" | "error" | "info";

export interface Result {
  name: string;
  level: Level;
  message: string;
  detail?: string[];
}

export interface Options {
  dryRun: boolean;
  stash: boolean;
}

export interface StatusRow {
  name: string;
  missing: boolean;
  branch?: string | null;
  hasLearn?: boolean;
  onLearn?: boolean;
  ahead?: number;
  behind?: number;
  changes?: number;
  lastCommit?: string;
}

export const result = (lib: Lib, level: Level, message: string, detail?: string[]): Result => ({
  name: lib.name,
  level,
  message,
  ...(detail?.length ? { detail } : {}),
});
