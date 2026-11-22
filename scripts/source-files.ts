import { readdirSync } from "node:fs";
import { posix, resolve, sep } from "node:path";

export function isSource(file: string): boolean {
  return /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file);
}

/**
 * A path with forward slashes, the form git prints and `TESTED_ROOTS` uses.
 * On Windows, `path.join` and a typed argument both give backslashes, which
 * match no prefix, and the run reports "Nothing to mutate".
 */
export function toPosix(file: string): string {
  return file.split(sep).join("/");
}

/** Every source file below a directory, as a path from the repository root. */
export function walk(repoRoot: string, dir: string): string[] {
  const absolute = resolve(repoRoot, dir);
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = posix.join(toPosix(dir), entry.name);
    if (entry.isDirectory()) return walk(repoRoot, child);
    return isSource(child) ? [child] : [];
  });
}
