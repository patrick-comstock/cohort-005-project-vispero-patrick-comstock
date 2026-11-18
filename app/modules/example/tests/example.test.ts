import { describe, expect, it } from "vitest";

import { greet } from "../index";

describe("greet", () => {
  it("greets by name", () => {
    expect(greet("Ada")).toBe("Hello, Ada!");
  });

  it("falls back to world for a blank name", () => {
    expect(greet("  ")).toBe("Hello, world!");
  });
});
