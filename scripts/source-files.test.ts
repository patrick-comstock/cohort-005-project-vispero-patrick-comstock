import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walk } from "./source-files";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

describe("walk", () => {
  // mutate-diff.ts filters on "app/modules/"-style prefixes. On Windows a
  // path built with backslashes matches none of them, and a run reports
  // "Nothing to mutate".
  it("returns paths from the repository root with forward slashes", () => {
    const files = walk(repoRoot, "scripts");

    expect(files).toContain("scripts/mutate-diff.ts");
    expect(files).not.toContain("scripts/source-files.test.ts");
  });
});
